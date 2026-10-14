import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { businessRows, canAccessRecord, filterBusiness, filterScoped, getCompanySettings, requireActiveUser, scopedRows } from "./access";

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY = 86400000;
const toDay = (iso: string) => Math.floor(new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() / DAY);
const addDays = (iso: string, days: number) => new Date((toDay(iso) + days) * DAY).toISOString().slice(0, 10);

/** Days a supplier gives us to pay (from the supplier card). */
function termsDays(s: { paymentTermsDays?: number; paymentTerms?: string } | null | undefined): number {
  if (!s) return 0;
  if (typeof s.paymentTermsDays === "number" && s.paymentTermsDays >= 0) return s.paymentTermsDays;
  const m = String(s.paymentTerms ?? "").match(/^(\d+)days$/);
  return m ? Number(m[1]) : 0;
}

/** Letterhead used by every professional purchasing document/report. */
async function letterhead(ctx: QueryCtx, u: Awaited<ReturnType<typeof requireActiveUser>>) {
  const company = await getCompanySettings(ctx, u);
  const dept = u.branchId ? await ctx.db.get("branches", u.branchId) : null;
  return {
    name: company?.companyName ?? "", address: company?.address ?? "", phone: company?.phone ?? "", email: company?.email ?? "",
    taxId: company?.taxId ?? "", website: company?.website ?? "", logoUrl: company?.logoUrl ?? "",
    currencySymbol: company?.currencySymbol ?? "TSh", decimalPlaces: company?.decimalPlaces ?? 0,
    department: dept?.name ?? "", preparedBy: u.name ?? u.username ?? u.email ?? "",
  };
}

export const reportHeader = query({
  args: {},
  handler: async (ctx) => letterhead(ctx, await requireActiveUser(ctx, "purchasing")),
});

/** Everything needed to print ONE purchase invoice as a formal document (with its payment receipts). */
export const purchaseDocument = query({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, a) => {
    const u = await requireActiveUser(ctx, "purchasing");
    const purchase = await ctx.db.get("purchases", a.purchaseId);
    if (!purchase || !canAccessRecord(u, purchase)) throw new Error("Purchase invoice haipatikani.");
    const supplier: any = await ctx.db.get("suppliers", purchase.supplierId);
    const lines = [];
    for (const l of await ctx.db.query("purchaseLines").withIndex("by_purchase", (q) => q.eq("purchaseId", purchase._id)).collect()) {
      const product: any = await ctx.db.get("products", l.productId);
      const unit: any = product?.unitId ? await ctx.db.get("unitsOfMeasure", product.unitId) : null;
      lines.push({ name: product?.name ?? "Product", itemCode: product?.itemCode ?? "", unit: unit?.name ?? "", qty: l.qty, unitCost: l.unitCost, discount: l.discount, total: l.lineTotal });
    }
    const payments = (await ctx.db.query("supplierPayments").withIndex("by_purchase", (q) => q.eq("purchaseId", purchase._id)).collect())
      .sort((x, y) => x.paymentDate.localeCompare(y.paymentDate))
      .map((p) => ({ date: p.paymentDate, method: p.paymentMethod, reference: p.reference ?? "", amount: p.amount }));
    const creator: any = await ctx.db.get("users", purchase.createdBy);
    const dueDate = addDays(purchase.purchaseDate, termsDays(supplier));
    return {
      header: await letterhead(ctx, u),
      purchase: {
        _id: purchase._id, invoiceNo: purchase.invoiceNo ?? purchase.internalRef, internalRef: purchase.internalRef, supplierInvoiceNo: purchase.supplierInvoiceNo ?? "",
        date: purchase.purchaseDate, dueDate, subtotal: purchase.subtotal, discount: purchase.discount, additionalCharges: purchase.additionalCharges, taxAmount: purchase.taxAmount,
        total: purchase.total, amountPaid: purchase.amountPaid, outstanding: purchase.outstanding, paymentStatus: purchase.paymentStatus, status: purchase.status, notes: purchase.notes ?? "",
        createdBy: creator?.name ?? creator?.username ?? "",
      },
      supplier: supplier ? { name: supplier.name, code: supplier.code, phone: supplier.phone ?? "", email: supplier.email ?? "", address: supplier.address ?? "", taxId: supplier.taxId ?? "", contactPerson: supplier.contactPerson ?? "" } : null,
      lines, payments,
    };
  },
});

/** Open (unpaid) purchase invoices of the whole business as at a date, with due dates and days overdue, for ageing. */
export const payablesAgeing = query({
  args: { asOf: v.string() },
  handler: async (ctx, a) => {
    const u = await requireActiveUser(ctx, "purchasing");
    const purchases = filterScoped(u, await scopedRows(ctx, u, "purchases")).filter((p) => p.status === "posted" && p.outstanding > 0.004 && p.purchaseDate <= a.asOf);
    const suppliers = new Map(filterBusiness(u, await businessRows(ctx, u, "suppliers")).map((s) => [String(s._id), s]));
    const rows = purchases.map((p) => {
      const s: any = suppliers.get(String(p.supplierId));
      const dueDate = addDays(p.purchaseDate, termsDays(s));
      return { purchaseId: p._id, invoiceNo: p.invoiceNo ?? p.internalRef, supplierId: p.supplierId, supplierName: s?.name ?? "Supplier", purchaseDate: p.purchaseDate, dueDate, daysOverdue: toDay(a.asOf) - toDay(dueDate), total: p.total, paid: p.amountPaid, outstanding: p.outstanding };
    }).sort((x, y) => y.daysOverdue - x.daysOverdue);
    return { asOf: a.asOf, header: await letterhead(ctx, u), rows };
  },
});

type Movement = { date: string; type: "purchase" | "payment" | "return"; reference: string; description: string; charge: number; credit: number; purchaseId?: any };

async function movementsOf(ctx: QueryCtx, u: any) {
  const [purchases, payments, returns, suppliers] = await Promise.all([
    scopedRows(ctx, u, "purchases"), scopedRows(ctx, u, "supplierPayments"), scopedRows(ctx, u, "purchaseReturns"), businessRows(ctx, u, "suppliers"),
  ]);
  const by = new Map<string, Movement[]>();
  const push = (id: any, m: Movement) => { const k = String(id); const list = by.get(k) ?? []; list.push(m); by.set(k, list); };
  for (const p of filterScoped(u, purchases).filter((x: any) => x.status === "posted")) push(p.supplierId, { date: p.purchaseDate, type: "purchase", reference: p.invoiceNo ?? p.internalRef, description: p.supplierInvoiceNo && p.supplierInvoiceNo !== p.invoiceNo ? `Supplier inv. ${p.supplierInvoiceNo}` : "Purchase invoice", charge: p.total, credit: 0, purchaseId: p._id });
  for (const p of filterScoped(u, payments)) push(p.supplierId, { date: p.paymentDate, type: "payment", reference: p.reference ?? `PAY-${String(p._id).slice(-6)}`, description: p.notes ?? `Payment (${p.paymentMethod})`, charge: 0, credit: p.amount });
  for (const r of filterScoped(u, returns).filter((x: any) => x.status === "posted")) push(r.supplierId, { date: r.returnDate, type: "return", reference: r.returnRef, description: r.reason ?? "Purchase return", charge: 0, credit: r.total });
  return { by, suppliers: filterBusiness(u, suppliers) as any[] };
}

/** Per supplier: balance brought forward at the start date, movements in the period and closing balance (positive = we owe). */
export const supplierBalances = query({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, a) => {
    const u = await requireActiveUser(ctx, "purchasing");
    const { by, suppliers } = await movementsOf(ctx, u);
    const rows = suppliers.map((s) => {
      const list = by.get(String(s._id)) ?? [];
      let opening = s.openingBalance ?? 0, purchases = 0, payments = 0, returns = 0;
      for (const m of list) {
        if (m.date < a.startDate) opening += m.charge - m.credit;
        else if (m.date <= a.endDate) { if (m.type === "purchase") purchases += m.charge; else if (m.type === "payment") payments += m.credit; else returns += m.credit; }
      }
      return { supplierId: s._id, name: s.name, code: s.code, phone: s.phone ?? "", opening: round(opening), purchases: round(purchases), payments: round(payments), returns: round(returns), closing: round(opening + purchases - payments - returns) };
    }).filter((r) => r.opening || r.purchases || r.payments || r.returns || r.closing).sort((x, y) => y.closing - x.closing);
    return { header: await letterhead(ctx, u), rows };
  },
});

/** One supplier's statement: opening balance, every movement with a running balance, closing balance. */
export const supplierLedger = query({
  args: { supplierId: v.id("suppliers"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, a) => {
    const u = await requireActiveUser(ctx, "purchasing");
    const supplier: any = await ctx.db.get("suppliers", a.supplierId);
    if (!supplier || !canAccessRecord(u, supplier)) throw new Error("Supplier hayupo kwenye scope yako.");
    const { by } = await movementsOf(ctx, u);
    const list = (by.get(String(a.supplierId)) ?? []).sort((x, y) => x.date.localeCompare(y.date) || x.type.localeCompare(y.type));
    let opening = supplier.openingBalance ?? 0;
    for (const m of list) if (m.date < a.startDate) opening += m.charge - m.credit;
    let balance = opening;
    const rows = list.filter((m) => m.date >= a.startDate && m.date <= a.endDate).map((m) => { balance = round(balance + m.charge - m.credit); return { ...m, balance }; });
    return {
      header: await letterhead(ctx, u),
      supplier: { name: supplier.name, code: supplier.code, phone: supplier.phone ?? "", email: supplier.email ?? "", address: supplier.address ?? "", taxId: supplier.taxId ?? "", paymentTerms: supplier.paymentTerms ?? "", creditLimit: supplier.creditLimit ?? 0 },
      opening: round(opening), rows, closing: round(balance),
      totals: { charges: round(rows.reduce((n, r) => n + r.charge, 0)), credits: round(rows.reduce((n, r) => n + r.credit, 0)) },
    };
  },
});
