import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { activeDepartments, allowedBranchIds, canAccessRecord, getCompanySettings, isOwnDataOnly, requireActiveUser, roleHasPermission, scopedRows, requirePermission } from "./access";
import type { UserLike } from "./access";

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MAX_INVOICES = 50;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** A user allowed to combine bills across departments sees the whole business (for bills only), not just one department. */
async function crossAccess(ctx: QueryCtx, user: UserLike) {
  // Not for a user limited to a few departments: this view is business-wide, so it would show departments he was not given.
  const allowed = !!user.tenantId && !isOwnDataOnly(user) && !allowedBranchIds(user) && (await roleHasPermission(ctx, user, "bills.all_departments"));
  return { allowed, wide: allowed ? { ...user, branchId: undefined } : user };
}
/** Same customer in another department = same code or same name (customers are kept per department). */
const sameCustomer = (a: Pick<Doc<"clients">, "_id" | "name" | "code">, b: Pick<Doc<"clients">, "_id" | "name" | "code">) => String(a._id) === String(b._id) || norm(a.name) === norm(b.name) || (!!a.code && norm(a.code) === norm(b.code));

/** What the signed-in user may do on the Bills screen. */
export const access = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "bills");
    const { allowed } = await crossAccess(ctx, user);
    const departments = allowed ? (await activeDepartments(ctx, user.tenantId)).map((b) => ({ _id: b._id, name: b.name })) : [];
    return { allDepartments: allowed && departments.length > 1, departments };
  },
});

/**
 * Customer BILLS = what a customer is shown/charged for the sales invoices he picked.
 * Bills are built from Sales invoices (nothing is stored twice). General running costs such as rent,
 * electricity and water are NOT bills any more — they live in Accounts > Expense Payments.
 */

/** Invoices of one customer (newest first) so the cashier can tick the ones to put on the bill. */
export const invoicesForClient = query({
  args: { clientId: v.id("clients"), onlyOpen: v.optional(v.boolean()), allDepartments: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "bills");
    const client = await ctx.db.get("clients", a.clientId);
    if (!client || !canAccessRecord(user, client)) return [];
    const { allowed, wide } = await crossAccess(ctx, user);
    const cross = allowed && !!a.allDepartments;
    const clients = cross ? (await scopedRows(ctx, wide, "clients")).filter((c) => sameCustomer(client, c)).slice(0, 20) : [client];
    const names = new Map((await ctx.db.query("branches").withIndex("by_tenant", (q) => q.eq("tenantId", user.tenantId!)).collect()).map((b) => [String(b._id), b.name]));
    const out = [];
    for (const c of clients) {
      const rows = await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", c._id)).order("desc").take(300);
      for (const i of rows) {
        if (i.status !== "posted" || !canAccessRecord(cross ? wide : user, i) || (a.onlyOpen && i.outstanding <= 0)) continue;
        if (isOwnDataOnly(user) && i.createdBy !== user._id) continue; // staff: own sales only
        out.push({ _id: i._id, invoiceNo: i.invoiceNo, date: i.invoiceDate, total: i.total, amountPaid: i.amountPaid, outstanding: i.outstanding, paymentStatus: i.paymentStatus, department: i.branchId ? names.get(String(i.branchId)) ?? "" : "", _t: i._creationTime });
      }
    }
    return out.sort((x, y) => y.date.localeCompare(x.date) || y._t - x._t).map(({ _t, ...rest }) => rest);
  },
});

/** Everything needed to print ONE bill that covers the selected invoices of the same customer. */
export const billData = query({
  args: { invoiceIds: v.array(v.id("invoices")) },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "bills");
    // A bill/receipt shows sales data: needs sales.view, or sales.manage (a waiter who may take orders can see what he sold).
    if (!(await roleHasPermission(ctx, user, "sales.view")) && !(await roleHasPermission(ctx, user, "sales.manage"))) throw new Error("Forbidden: permission \"sales.view\" required");
    if (a.invoiceIds.length === 0) throw new Error("Chagua angalau invoice moja.");
    if (a.invoiceIds.length > MAX_INVOICES) throw new Error("Bili moja isizidi invoice 50.");
    const unique = [...new Set(a.invoiceIds.map(String))];
    const { allowed, wide } = await crossAccess(ctx, user);
    const who = allowed ? wide : user;
    const invoices = [];
    for (const id of a.invoiceIds.filter((x, i, arr) => arr.findIndex((y) => String(y) === String(x)) === i)) {
      const inv = await ctx.db.get("invoices", id);
      if (!inv || !canAccessRecord(who, inv) || inv.status !== "posted" || (isOwnDataOnly(user) && inv.createdBy !== user._id)) throw new Error("Invoice haipatikani.");
      invoices.push(inv);
    }
    if (invoices.length !== unique.length) throw new Error("Invoice haipatikani.");
    const client = await ctx.db.get("clients", invoices[0].clientId);
    if (!client || !canAccessRecord(who, client)) throw new Error("Mteja hapatikani.");
    for (const inv of invoices) {
      if (inv.clientId === client._id) continue;
      const other = await ctx.db.get("clients", inv.clientId); // another department's record of the same customer
      if (!allowed || !other || !canAccessRecord(who, other) || !sameCustomer(client, other)) throw new Error("Invoice za bili moja lazima ziwe za mteja mmoja.");
    }
    invoices.sort((x, y) => x.invoiceDate.localeCompare(y.invoiceDate) || x._creationTime - y._creationTime);

    const company = await getCompanySettings(ctx, user);
    // Receipt footer is read from this business's tenant-wide system settings only.
    // Never fall back to another tenant or another branch's settings.
    const settingRows = await ctx.db.query("appSettings")
      .withIndex("by_scope", (q) => q.eq("tenantId", user.tenantId).eq("branchId", undefined))
      .collect();
    let receiptFooter = "Asante kwa kununua!";
    const systemSetting = settingRows.find((row) => row.key === "system");
    if (systemSetting) {
      try { receiptFooter = String(JSON.parse(systemSetting.value)?.receiptFooter ?? receiptFooter); } catch { /* use safe default */ }
    }
    const deptName = new Map<string, string>();
    for (const inv of invoices) if (inv.branchId && !deptName.has(String(inv.branchId))) deptName.set(String(inv.branchId), (await ctx.db.get("branches", inv.branchId))?.name ?? "");
    const department = deptName.size ? [...deptName.values()].filter(Boolean).join(" + ") : null;
    const productCache = new Map<string, { name: string; itemCode: string }>();
    const out: Array<{ _id: Id<"invoices">; invoiceNo: string; date: string; notes: string; subtotal: number; discount: number; taxAmount: number; total: number; amountPaid: number; outstanding: number; department: string; lines: Array<{ name: string; itemCode: string; qty: number; unitPrice: number; discount: number; lineTotal: number }> }> = [];
    for (const inv of invoices) {
      const lines: (typeof out)[number]["lines"] = [];
      for (const l of await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id)).collect()) {
        let p = productCache.get(String(l.productId));
        if (!p) { const doc = await ctx.db.get("products", l.productId); p = { name: doc?.name ?? "Bidhaa", itemCode: doc?.itemCode ?? "" }; productCache.set(String(l.productId), p); }
        lines.push({ name: p.name, itemCode: p.itemCode, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal });
      }
      out.push({ _id: inv._id, invoiceNo: inv.invoiceNo, date: inv.invoiceDate, notes: inv.notes ?? "", subtotal: inv.subtotal, discount: inv.discount, taxAmount: inv.taxAmount, total: inv.total, amountPaid: inv.amountPaid, outstanding: inv.outstanding, department: inv.branchId ? deptName.get(String(inv.branchId)) ?? "" : "", lines });
    }
    // Receipt extras: who served the customer, when the sale was saved, and how it was paid (read from this business's own records only).
    const cashierNames = new Set<string>(); const methods = new Set<string>();
    for (const inv of invoices) {
      const by = await ctx.db.get("users", inv.createdBy); if (by) cashierNames.add(by.name ?? by.username ?? "");
      for (const pay of await ctx.db.query("customerPayments").withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id)).collect()) if (pay.tenantId === inv.tenantId) methods.add(pay.paymentMethod);
    }
    const savedAt = invoices.length ? new Date(Math.min(...invoices.map((x) => x._creationTime))).toISOString() : null;
    const sum = (k: "subtotal" | "discount" | "taxAmount" | "total" | "amountPaid" | "outstanding") => money(out.reduce((n, i) => n + i[k], 0));
    return {
      company: { name: company?.companyName ?? "", address: company?.address ?? "", phone: company?.phone ?? "", email: company?.email ?? "", taxId: company?.taxId ?? "", currencySymbol: company?.currencySymbol ?? "TSh", decimalPlaces: company?.decimalPlaces ?? 0 },
      receiptFooter,
      department,
      cashier: [...cashierNames].filter(Boolean).join(", "),
      paymentMethods: [...methods].filter(Boolean),
      savedAt,
      client: { code: client.code, name: client.name, phone: client.phone ?? "", address: client.address ?? "" },
      invoices: out,
      totals: { subtotal: sum("subtotal"), discount: sum("discount"), tax: sum("taxAmount"), total: sum("total"), paid: sum("amountPaid"), outstanding: sum("outstanding") },
    };
  },
});
