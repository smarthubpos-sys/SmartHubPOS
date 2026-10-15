import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
/** Shared idempotent ledger posting helpers for business workflows. */
const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
type Scope = { tenantId?: Id<"tenants">; branchId?: Id<"branches"> };

export async function getSystemAccount(ctx: MutationCtx, scope: Scope, code: string, name: string, type: string) {
  const accounts = await ctx.db.query("accounts").withIndex("by_tenant_code", (q) => q.eq("tenantId", scope.tenantId).eq("code", code)).collect();
  const account = accounts.find((a) => a.branchId === scope.branchId && a.isActive);
  if (account) return account._id;
  return await ctx.db.insert("accounts", { ...scope, code, name, type, subtype: "system", balance: 0, isActive: true, isSystem: true, description: "System account created for automatic posting" });
}

/** Old, fixed method names -> the three generic money accounts (kept so payments recorded without a method list still land in the right place). */
const LEGACY_METHOD_ACCOUNT: Record<string, [string, string]> = {
  cash: ["1000", "Cash and equivalents"],
  bank: ["1010", "Bank"],
  mobile: ["1020", "Mobile money"],
};

/** An account that holds money: Cash / Bank / Mobile money or the account of one payment method. */
export const isMoneyAccount = (a: Doc<"accounts"> | null | undefined) => !!a && a.type === "asset" && (["1000", "1010", "1020"].includes(a.code) || a.subtype === "payment_method");

/**
 * The ledger account a payment must be posted to.
 *  - a payment method of kind "cash"  -> Cash and equivalents (1000)
 *  - any other payment method         -> its OWN account (M-Pesa 5551234, CRDB, NMB ...), created on first use (codes 1300+) and remembered on the method
 *  - no method id (old fixed names)   -> Cash 1000 / Bank 1010 / Mobile money 1020
 * Renaming a method renames its account (see paymentMethods.upsert), so the account always follows the method.
 */
export async function methodAccount(ctx: MutationCtx, scope: Scope, pay: { methodId?: Id<"paymentMethods">; method?: string }) {
  if (pay.methodId) {
    const row = await ctx.db.get("paymentMethods", pay.methodId);
    if (row) {
      if (row.kind === "cash") return await getSystemAccount(ctx, scope, "1000", "Cash and equivalents", "asset");
      const own = row.accountId ? await ctx.db.get("accounts", row.accountId) : null;
      if (own && own.isActive && own.tenantId === scope.tenantId && own.branchId === scope.branchId) return own._id;
      const used = new Set((await ctx.db.query("accounts").withIndex("by_scope", (q) => q.eq("tenantId", scope.tenantId)).collect()).filter((a) => a.branchId === scope.branchId).map((a) => a.code));
      let n = 1300; while (used.has(String(n))) n++;
      const id = await ctx.db.insert("accounts", { ...scope, code: String(n), name: row.name, type: "asset", subtype: "payment_method", balance: 0, isActive: true, isSystem: true, description: `Account of payment method: ${row.name}` });
      await ctx.db.patch("paymentMethods", row._id, { accountId: id });
      return id;
    }
  }
  const [code, name] = LEGACY_METHOD_ACCOUNT[(pay.method ?? "cash").trim().toLowerCase()] ?? LEGACY_METHOD_ACCOUNT.cash;
  return await getSystemAccount(ctx, scope, code, name, "asset");
}

/**
 * A closed / locked financial period (Maintenance > Periods) must not receive new postings: every sale, payment, purchase,
 * bill and payroll goes through postSystemJournal, so checking here protects all of them. A period without a branch covers the whole business.
 */
export async function assertPeriodOpen(ctx: MutationCtx, scope: Scope, date: string) {
  if (!scope?.tenantId || !date) return;
  const periods = await ctx.db.query("financialPeriods").withIndex("by_scope", (q) => q.eq("tenantId", scope.tenantId)).collect();
  const shut = periods.find((p) => p.status !== "open" && p.startDate <= date && date <= p.endDate && (!p.branchId || p.branchId === scope.branchId));
  if (shut) throw new Error(`Kipindi cha hesabu "${shut.name}" kimefungwa (${shut.startDate} hadi ${shut.endDate}); huwezi kuweka miamala ya tarehe ${date}. Mwombe meneja afungue kipindi kwanza.`);
}

export async function postSystemJournal(ctx: MutationCtx, input: { scope: Scope; userId: Id<"users">; date: string; reference: string; description: string; sourceType: string; sourceId: string; lines: Array<{ accountId: Id<"accounts">; debit: number; credit: number; description?: string }> }) {
  const existing = (await ctx.db.query("journalEntries").withIndex("by_tenant_ref", (q) => q.eq("tenantId", input.scope.tenantId).eq("reference", input.reference)).collect())
    .find((e) => e.branchId === input.scope.branchId && e.sourceId === input.sourceId && e.status === "posted");
  if (existing) return existing._id;
  await assertPeriodOpen(ctx, input.scope, input.date);
  const lines = input.lines.filter((l) => roundMoney(l.debit) !== 0 || roundMoney(l.credit) !== 0);
  const debit = roundMoney(lines.reduce((n, l) => n + l.debit, 0));
  const credit = roundMoney(lines.reduce((n, l) => n + l.credit, 0));
  if (lines.length < 2 || Math.abs(debit - credit) > 0.009) throw new Error(`Automatic journal is not balanced (${debit} != ${credit}).`);
  const id = await ctx.db.insert("journalEntries", { ...input.scope, entryDate: input.date, reference: input.reference, description: input.description, status: "posted", sourceType: input.sourceType, sourceId: input.sourceId, totalDebit: debit, totalCredit: credit, createdBy: input.userId, postedAt: new Date().toISOString() });
  for (const line of lines) await ctx.db.insert("journalLines", { ...input.scope, entryId: id, ...line, debit: roundMoney(line.debit), credit: roundMoney(line.credit) });
  return id;
}

/** A date must be a real calendar day written YYYY-MM-DD (garbage dates would otherwise reach the ledger and break sorting / closed-period checks). */
export function assertDate(value: string | undefined, label = "Tarehe"): string {
  const d = String(value ?? "");
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!ok) throw new Error(`${label} si sahihi (tumia mwaka-mwezi-siku, mfano 2026-10-15).`);
  return d;
}

/** Optional money / rate values must be real finite numbers: NaN and Infinity slip through plain `<`, `>` comparisons. */
export function assertFinite(value: number | undefined, label: string): number {
  const n = value ?? 0;
  if (!Number.isFinite(n)) throw new Error(`${label} si sahihi.`);
  return n;
}

export { roundMoney };
