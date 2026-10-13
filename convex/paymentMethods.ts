import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireActiveUser, requireManager, canAccessRecord, filterScoped, resolveWriteScope, scopedRows, logAudit } from "./access";
import { isMoneyAccount, methodAccount } from "./ledger";

export const KINDS = ["cash", "bank", "mobile", "cheque", "card", "other"] as const;
const DEFAULTS: Array<{ name: string; kind: string }> = [{ name: "Cash", kind: "cash" }, { name: "Bank", kind: "bank" }, { name: "Mobile Money", kind: "mobile" }];

/** All payment methods of the user's business/department, in the order the business chose. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    const rows = filterScoped(user, await scopedRows(ctx, user, "paymentMethods"));
    return rows.sort((a, b) => a.sortOrder - b.sortOrder || a._creationTime - b._creationTime);
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("paymentMethods")),
    name: v.string(),
    kind: v.string(),
    accountNo: v.optional(v.string()),
    accountName: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx);
    const scope = await resolveWriteScope(ctx, user);
    const name = a.name.trim();
    if (!name) throw new Error("Weka jina la njia ya malipo.");
    if (name.length > 60) throw new Error("Jina ni refu sana (herufi 60 upeo).");
    if (!(KINDS as readonly string[]).includes(a.kind)) throw new Error("Aina ya njia ya malipo si sahihi.");
    const rows = filterScoped(user, await scopedRows(ctx, user, "paymentMethods"));
    if (rows.some((r) => r._id !== a.id && r.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`Njia ya malipo "${name}" tayari ipo.`);
    const data = { name, kind: a.kind, accountNo: a.accountNo?.trim() || undefined, accountName: a.accountName?.trim() || undefined, isActive: a.isActive };
    if (a.id) {
      const row = await ctx.db.get(a.id);
      if (!canAccessRecord(user, row)) throw new Error("Njia hii ya malipo haipo kwenye biashara yako.");
      await ctx.db.patch(a.id, data);
      if (row?.accountId && row.name !== name) await ctx.db.patch(row.accountId, { name, description: `Account of payment method: ${name}` }); // the account follows the method's name
      await logAudit(ctx, user, { action: "update_payment_method", module: "maintenance", referenceId: String(a.id), referenceType: "paymentMethod", details: name });
      return a.id;
    }
    const sortOrder = rows.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1;
    const id = await ctx.db.insert("paymentMethods", { ...scope, ...data, sortOrder });
    await logAudit(ctx, user, { action: "create_payment_method", module: "maintenance", referenceId: String(id), referenceType: "paymentMethod", details: name });
    return id;
  },
});

/** Move a method one place up (-1) or down (+1) so the most used ones appear first. */
export const move = mutation({
  args: { id: v.id("paymentMethods"), direction: v.number() },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx);
    const rows = filterScoped(user, await scopedRows(ctx, user, "paymentMethods")).sort((x, y) => x.sortOrder - y.sortOrder || x._creationTime - y._creationTime);
    const i = rows.findIndex((r) => r._id === a.id); const j = i + (a.direction < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= rows.length) return;
    const reordered = rows.slice(); [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    for (let k = 0; k < reordered.length; k++) if (reordered[k].sortOrder !== k + 1) await ctx.db.patch(reordered[k]._id, { sortOrder: k + 1 });
  },
});

/** Deleting is safe: every payment stores the method's name, so old receipts and reports are unchanged. */
export const remove = mutation({
  args: { id: v.id("paymentMethods") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx);
    const row = await ctx.db.get(a.id);
    if (!canAccessRecord(user, row)) throw new Error("Njia hii ya malipo haipo kwenye biashara yako.");
    await ctx.db.delete(a.id);
    await logAudit(ctx, user, { action: "delete_payment_method", module: "maintenance", referenceId: String(a.id), referenceType: "paymentMethod", details: row?.name });
  },
});

/** First-time setup: Cash, Bank and Mobile Money (the business then edits / adds its own). */
export const seedDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireManager(ctx);
    const scope = await resolveWriteScope(ctx, user);
    const rows = filterScoped(user, await scopedRows(ctx, user, "paymentMethods"));
    if (rows.length) return 0;
    for (let i = 0; i < DEFAULTS.length; i++) await ctx.db.insert("paymentMethods", { ...scope, ...DEFAULTS[i], isActive: true, sortOrder: i + 1 });
    return DEFAULTS.length;
  },
});

export type PaymentSplitInput = { method: string; methodId?: Id<"paymentMethods">; amount: number; reference?: string };
export const splitValidator = v.object({ method: v.string(), methodId: v.optional(v.id("paymentMethods")), amount: v.number(), reference: v.optional(v.string()) });

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Validate and normalise the lines of ONE receipt (e.g. 10,000 phone + 10,000 bank + 10,000 cash). */
export async function normaliseSplits(ctx: any, user: any, splits: PaymentSplitInput[]) {
  if (!splits.length) throw new Error("Weka angalau njia moja ya malipo.");
  if (splits.length > 20) throw new Error("Njia za malipo zimezidi (upeo 20 kwa risiti moja).");
  const known = filterScoped(user, await scopedRows(ctx, user, "paymentMethods"));
  const out: Array<{ method: string; methodId?: Id<"paymentMethods">; amount: number; reference?: string }> = [];
  for (const s of splits) {
    if (!Number.isFinite(s.amount) || s.amount <= 0) throw new Error("Kila njia ya malipo lazima iwe na kiasi kikubwa kuliko sifuri.");
    let method = (s.method ?? "").trim(); let methodId: Id<"paymentMethods"> | undefined;
    if (s.methodId) {
      const row = known.find((k) => k._id === s.methodId);
      if (!row) throw new Error("Njia ya malipo haipo kwenye biashara yako.");
      if (!row.isActive) throw new Error(`Njia ya malipo "${row.name}" imezimwa.`);
      method = row.name; methodId = row._id;
    }
    if (!method) throw new Error("Chagua njia ya malipo.");
    out.push({ method, methodId, amount: r2(s.amount), reference: s.reference?.trim() || undefined });
  }
  return { splits: out, total: r2(out.reduce((n, s) => n + s.amount, 0)) };
}

const sumAccount = async (ctx: any, accountId: any) => {
  let bal = 0;
  for (const l of await ctx.db.query("journalLines").withIndex("by_account", (q: any) => q.eq("accountId", accountId)).collect()) bal += l.debit - l.credit;
  return r2(bal);
};

/** What each payment method holds right now (receipts in minus payments out), read from the ledger. Cash-kind methods share Cash 1000. */
export const balances = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    const rows = filterScoped(user, await scopedRows(ctx, user, "paymentMethods")).sort((a, b) => a.sortOrder - b.sortOrder || a._creationTime - b._creationTime);
    const out: Array<{ id: Id<"paymentMethods">; name: string; kind: string; isActive: boolean; accountId?: Id<"accounts">; balance: number }> = [];
    for (const m of rows) {
      let accountId: Id<"accounts"> | undefined = m.accountId;
      if (m.kind === "cash") {
        const cash = (await ctx.db.query("accounts").withIndex("by_tenant_code", (q: any) => q.eq("tenantId", m.tenantId).eq("code", "1000")).collect()).find((a: any) => a.branchId === m.branchId && a.isActive);
        accountId = cash?._id;
      }
      out.push({ id: m._id, name: m.name, kind: m.kind, isActive: m.isActive, accountId, balance: accountId ? await sumAccount(ctx, accountId) : 0 });
    }
    return out;
  },
});

/** Replace the money lines of one posted journal entry so they match `desired` (account -> amount). Returns true when something changed. */
async function reallocate(ctx: any, entry: any, side: "debit" | "credit", desired: Array<{ accountId: any; amount: number }>) {
  const lines = await ctx.db.query("journalLines").withIndex("by_entry", (q: any) => q.eq("entryId", entry._id)).collect();
  const money: any[] = [];
  for (const l of lines) if (l[side] > 0 && isMoneyAccount(await ctx.db.get(l.accountId))) money.push(l);
  if (!money.length) return false;
  const want = new Map<string, number>(); for (const d of desired) want.set(String(d.accountId), r2((want.get(String(d.accountId)) ?? 0) + d.amount));
  const have = new Map<string, number>(); for (const l of money) have.set(String(l.accountId), r2((have.get(String(l.accountId)) ?? 0) + l[side]));
  const sum = (m: Map<string, number>) => r2([...m.values()].reduce((n, x) => n + x, 0));
  if (Math.abs(sum(want) - sum(have)) > 0.009) return false; // the entry does not match the payments: leave it alone
  if (want.size === have.size && [...want].every(([k, x]) => Math.abs((have.get(k) ?? -1) - x) < 0.005)) return false;
  const desc = money[0].description;
  for (const l of money) await ctx.db.delete(l._id);
  for (const [accountId, amount] of want) await ctx.db.insert("journalLines", { tenantId: entry.tenantId, branchId: entry.branchId, entryId: entry._id, accountId, debit: side === "debit" ? amount : 0, credit: side === "credit" ? amount : 0, description: desc });
  return true;
}

/**
 * Repair for payments recorded before every method had its own account: they were all posted to Cash 1000.
 * Moves each payment's money line to the account of the method it was paid with. Safe to run again (the 2nd run moves 0).
 */
export const repairOldPayments = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireManager(ctx);
    const entryOf = async (scope: any, reference: string, sourceId: string) =>
      (await ctx.db.query("journalEntries").withIndex("by_tenant_ref", (q: any) => q.eq("tenantId", scope.tenantId).eq("reference", reference)).collect())
        .find((e: any) => e.branchId === scope.branchId && e.sourceId === sourceId && e.status === "posted");
    const scopeOf = (row: any) => ({ tenantId: row.tenantId, branchId: row.branchId });
    let moved = 0;
    const fix = async (scope: any, reference: string, sourceId: string, side: "debit" | "credit", desired: Array<{ accountId: any; amount: number }>) => {
      const entry = await entryOf(scope, reference, sourceId);
      if (entry && (await reallocate(ctx, entry, side, desired))) moved++;
    };
    const INITIAL = "Malipo ya awali ya invoice", ON_RECEIPT = "Malipo wakati wa kupokea bidhaa";

    // customer payments: one journal per payment, except the payment made while the invoice was created (inside the SALE journal)
    const initialByInvoice = new Map<string, any[]>();
    for (const p of await scopedRows(ctx, user, "customerPayments")) {
      if (p.notes === INITIAL && p.invoiceId) { const k = String(p.invoiceId); initialByInvoice.set(k, [...(initialByInvoice.get(k) ?? []), p]); continue; }
      const scope = scopeOf(p);
      await fix(scope, `PAY-${String(p._id)}`, String(p._id), "debit", [{ accountId: await methodAccount(ctx, scope, { methodId: p.paymentMethodId, method: p.paymentMethod }), amount: p.amount }]);
    }
    for (const [invoiceId, list] of initialByInvoice) {
      const invoice = await ctx.db.get(invoiceId as Id<"invoices">); if (!invoice) continue;
      const scope = scopeOf(invoice);
      await fix(scope, `SALE-${invoice.invoiceNo}`, invoiceId, "debit", await Promise.all(list.map(async (p) => ({ accountId: await methodAccount(ctx, scope, { methodId: p.paymentMethodId, method: p.paymentMethod }), amount: p.amount }))));
    }

    // supplier payments: same idea (payments made when goods were received sit inside the PUR journal)
    const onReceipt = new Map<string, any[]>();
    for (const p of await scopedRows(ctx, user, "supplierPayments")) {
      if (p.notes === ON_RECEIPT && p.purchaseId) { const k = String(p.purchaseId); onReceipt.set(k, [...(onReceipt.get(k) ?? []), p]); continue; }
      const scope = scopeOf(p);
      await fix(scope, `SUPPAY-${String(p._id)}`, String(p._id), "credit", [{ accountId: await methodAccount(ctx, scope, { methodId: p.paymentMethodId, method: p.paymentMethod }), amount: p.amount }]);
    }
    for (const [purchaseId, list] of onReceipt) {
      const purchase = await ctx.db.get(purchaseId as Id<"purchases">); if (!purchase) continue;
      const scope = scopeOf(purchase);
      await fix(scope, `PUR-${purchase.internalRef}`, purchaseId, "credit", await Promise.all(list.map(async (p) => ({ accountId: await methodAccount(ctx, scope, { methodId: p.paymentMethodId, method: p.paymentMethod }), amount: p.amount }))));
    }

    // bill payments and capital received
    for (const p of await scopedRows(ctx, user, "billPayments")) {
      const scope = scopeOf(p);
      await fix(scope, `BILLPAY-${String(p._id)}`, String(p._id), "credit", [{ accountId: await methodAccount(ctx, scope, { methodId: p.methodId, method: p.method }), amount: p.amount }]);
    }
    for (const c of await scopedRows(ctx, user, "capitalReceipts")) {
      const scope = scopeOf(c);
      await fix(scope, `CAP-${String(c._id)}`, String(c._id), "debit", [{ accountId: await methodAccount(ctx, scope, { methodId: c.depositMethodId, method: c.depositMethod }), amount: c.amount }]);
    }
    if (moved) await logAudit(ctx, user, { action: "repair_payment_accounts", module: "maintenance", referenceType: "paymentMethod", details: `${moved} entries` });
    return { moved };
  },
});
