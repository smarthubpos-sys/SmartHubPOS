import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

/** The cards on the Purchasing page: what we owe suppliers, what is overdue, what was bought and paid this month. */
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Shop", code: "SHOP", isActive: true, createdByToken: "t", createdAt: now });
    const other = await ctx.db.insert("tenants", { name: "Other", code: "OTH", isActive: true, createdByToken: "t", createdAt: now });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId, isActive: true });
    const cashier = await ctx.db.insert("users", { name: "Cash", username: "cash", role: "cashier", tenantId, isActive: true });
    await ctx.db.insert("companySettings", { tenantId, companyName: "Shop Ltd", currency: "TZS", currencySymbol: "TSh", decimalPlaces: 0 });
    const acme = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Acme", openingBalance: 1000, paymentTermsDays: 30, isActive: true });
    const beta = await ctx.db.insert("suppliers", { tenantId, code: "S2", name: "Beta", openingBalance: 0, paymentTermsDays: 0, isActive: true });
    const paidUp = await ctx.db.insert("suppliers", { tenantId, code: "S3", name: "PaidUp", openingBalance: 0, isActive: true });
    const foreign = await ctx.db.insert("suppliers", { tenantId: other, code: "S9", name: "Foreign", openingBalance: 99999, isActive: true });
    const mk = (supplierId: typeof acme, purchaseDate: string, ref: string, total: number, amountPaid: number, status = "posted") =>
      ctx.db.insert("purchases", { tenantId, supplierId, subtotal: 0, discount: 0, additionalCharges: 0, taxAmount: 0, createdBy: mgr, purchaseDate, internalRef: ref, invoiceNo: ref, total, amountPaid, outstanding: total - amountPaid, paymentStatus: amountPaid >= total ? "paid" : amountPaid > 0 ? "partial" : "unpaid", status });
    await mk(acme, "2026-08-01", "A1", 5000, 1000); // due 2026-08-31 -> overdue
    await mk(acme, "2026-10-05", "A2", 2000, 0); // due 2026-11-04
    await mk(acme, "2026-10-06", "A3", 999, 0, "cancelled"); // ignored
    await mk(beta, "2026-10-10", "B1", 300, 0); // no terms: due the same day
    await mk(paidUp, "2026-10-02", "C1", 400, 400);
    const pay = (supplierId: typeof acme, paymentDate: string, amount: number) => ctx.db.insert("supplierPayments", { tenantId, paymentDate, supplierId, amount, paymentMethod: "cash", createdBy: mgr });
    await pay(acme, "2026-09-01", 1000);
    await pay(paidUp, "2026-10-03", 400);
    await pay(beta, "2026-10-12", 100);
    return { mgr, cashier };
  });
  const as = (id: typeof ids.mgr) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
  return { as, ...ids };
}

describe("supplier cards", () => {
  it("adds up what we owe, what is overdue, and this month's purchases and payments", async () => {
    const s = await setup();
    const d = await s.as(s.mgr).query(api.purchaseReports.supplierSummary, { today: "2026-10-20", monthStart: "2026-10-01" });
    // Acme: 1000 opening + 5000 + 2000 - 1000 = 7000. Beta: 300 - 100 = 200. PaidUp: 0.
    expect(d.payable).toBe(7200);
    expect(d.owedCount).toBe(2);
    expect(d.topOwed.map((x) => [x.name, x.balance])).toEqual([["Acme", 7000], ["Beta", 200]]);
    // Overdue today: Acme's August invoice (4000 open) and Beta's invoice (due the day it was written, 300 open); Acme's October invoice is not due until 4 Nov.
    expect(d.overdue).toBe(4300);
    expect(d.overdueCount).toBe(2);
    // October: purchases 2000 + 300 + 400, payments 400 + 100.
    expect(d.boughtMonth).toBe(2700);
    expect(d.paidMonth).toBe(500);
    expect(d.paidCount).toBe(2);
    expect(d.recentPayments.map((p) => [p.supplierName, p.amount, p.date])).toEqual([["Beta", 100, "2026-10-12"], ["PaidUp", 400, "2026-10-03"], ["Acme", 1000, "2026-09-01"]]);
    expect(d.header.currencySymbol).toBe("TSh");
  });

  it("agrees with the Supplier Balances report", async () => {
    const s = await setup();
    const d = await s.as(s.mgr).query(api.purchaseReports.supplierSummary, { today: "2026-10-20", monthStart: "2026-10-01" });
    const b = await s.as(s.mgr).query(api.purchaseReports.supplierBalances, { startDate: "2026-10-01", endDate: "2026-10-20" });
    expect(d.payable).toBe(b.rows.filter((r) => r.closing > 0).reduce((n, r) => n + r.closing, 0));
    expect(d.paidMonth).toBe(b.rows.reduce((n, r) => n + r.payments, 0));
    expect(d.boughtMonth).toBe(b.rows.reduce((n, r) => n + r.purchases, 0));
  });

  it("ignores anything after today, and never shows another business", async () => {
    const s = await setup();
    const d = await s.as(s.mgr).query(api.purchaseReports.supplierSummary, { today: "2026-09-15", monthStart: "2026-09-01" });
    expect(d.payable).toBe(5000); // Acme: 1000 + 5000 - 1000; the October invoices do not exist yet
    expect(d.boughtMonth).toBe(0);
    expect(d.paidMonth).toBe(1000);
    expect(JSON.stringify(d)).not.toContain("Foreign");
  });

  it("is only for people who may view purchase reports", async () => {
    const s = await setup();
    await expect(s.as(s.cashier).query(api.purchaseReports.supplierSummary, { today: "2026-10-20", monthStart: "2026-10-01" })).rejects.toThrow();
  });
});
