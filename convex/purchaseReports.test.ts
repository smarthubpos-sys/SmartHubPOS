import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Shop", code: "SHOP", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const other = await ctx.db.insert("tenants", { name: "Other", code: "OTH", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const userId = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId, isActive: true });
    await ctx.db.insert("companySettings", { tenantId, companyName: "Shop Ltd", currency: "TZS", currencySymbol: "TSh", decimalPlaces: 0, address: "Dar", phone: "0700" });
    const supplierId = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Acme", openingBalance: 1000, paymentTermsDays: 30, isActive: true });
    const foreignSupplier = await ctx.db.insert("suppliers", { tenantId: other, code: "S9", name: "Foreign", openingBalance: 0, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Sugar", openingQty: 0, currentQty: 0, sellingPrice: 1, isActive: true });
    const base = { tenantId, supplierId, subtotal: 0, discount: 0, additionalCharges: 0, taxAmount: 0, createdBy: userId };
    const p1 = await ctx.db.insert("purchases", { ...base, purchaseDate: "2026-08-01", internalRef: "PUR-1", invoiceNo: "1", total: 5000, amountPaid: 1000, outstanding: 4000, paymentStatus: "partial", status: "posted" });
    const p2 = await ctx.db.insert("purchases", { ...base, purchaseDate: "2026-10-05", internalRef: "PUR-2", invoiceNo: "2", total: 2000, amountPaid: 0, outstanding: 2000, paymentStatus: "unpaid", status: "posted" });
    await ctx.db.insert("purchases", { ...base, purchaseDate: "2026-10-06", internalRef: "PUR-3", invoiceNo: "3", total: 999, amountPaid: 0, outstanding: 999, paymentStatus: "unpaid", status: "cancelled" });
    await ctx.db.insert("purchaseLines", { purchaseId: p1, productId, qty: 10, qtyStr: "10", unitCost: 500, unitCostStr: "500", lineTotal: 5000, lineTotalStr: "5000", discount: 0, receivedQty: 10 });
    await ctx.db.insert("supplierPayments", { tenantId, paymentDate: "2026-09-01", supplierId, purchaseId: p1, amount: 1000, paymentMethod: "cash", createdBy: userId });
    return { tenantId, userId, supplierId, foreignSupplier, p1, p2 };
  });
  return { t, as: t.withIdentity({ subject: ids.userId, tokenIdentifier: "x|1" }), ...ids };
}

describe("professional purchasing reports", () => {
  it("supplier ledger carries the balance brought forward and a running balance", async () => {
    const { as, supplierId } = await setup();
    const l = await as.query(api.purchaseReports.supplierLedger, { supplierId, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(l.opening).toBe(5000); // 1000 opening + 5000 purchase - 1000 payment, all before October
    expect(l.rows.map((r) => [r.reference, r.balance])).toEqual([["2", 7000]]); // cancelled invoice ignored
    expect(l.closing).toBe(7000);
    expect(l.header.name).toBe("Shop Ltd");
  });

  it("supplier balances agree with the ledger", async () => {
    const { as } = await setup();
    const b = await as.query(api.purchaseReports.supplierBalances, { startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(b.rows).toHaveLength(1); // the other business's supplier is not visible
    expect(b.rows[0]).toMatchObject({ name: "Acme", opening: 5000, purchases: 2000, payments: 0, closing: 7000 });
  });

  it("ageing uses the supplier's payment terms to find overdue days", async () => {
    const { as } = await setup();
    const a = await as.query(api.purchaseReports.payablesAgeing, { asOf: "2026-10-13" });
    const byNo = Object.fromEntries(a.rows.map((r) => [r.invoiceNo, r]));
    expect(byNo["1"].dueDate).toBe("2026-08-31");
    expect(byNo["1"].daysOverdue).toBe(43);
    expect(byNo["2"].daysOverdue).toBeLessThan(0);
    expect(a.rows).toHaveLength(2);
  });

  it("purchase document has supplier, items, totals and payments; other businesses are refused", async () => {
    const { as, p1, t } = await setup();
    const d = await as.query(api.purchaseReports.purchaseDocument, { purchaseId: p1 });
    expect(d.supplier?.name).toBe("Acme");
    expect(d.lines).toHaveLength(1);
    expect(d.payments.map((p) => p.amount)).toEqual([1000]);
    expect(d.purchase.dueDate).toBe("2026-08-31");
    const foreign = await t.run(async (ctx) => {
      const other = (await ctx.db.query("tenants").collect()).find((x) => x.code === "OTH")!;
      const u = (await ctx.db.query("users").collect())[0];
      const s = (await ctx.db.query("suppliers").collect()).find((x) => x.code === "S9")!;
      return await ctx.db.insert("purchases", { tenantId: other._id, supplierId: s._id, purchaseDate: "2026-10-01", internalRef: "X", subtotal: 1, discount: 0, additionalCharges: 0, taxAmount: 0, total: 1, amountPaid: 0, outstanding: 1, paymentStatus: "unpaid", status: "posted", createdBy: u._id });
    });
    await expect(as.query(api.purchaseReports.purchaseDocument, { purchaseId: foreign })).rejects.toThrow(/haipatikani/);
  });
});
