import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const DAY = 86_400_000;
const eat = (offsetDays = 0) => new Date(Date.now() + 3 * 3_600_000 + offsetDays * DAY).toISOString().slice(0, 10);

/** One business with real records of today and yesterday, and (optionally) roll-ups that DISAGREE with them. */
async function setup(opts: { rollups: boolean }) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "manager", tenantId, isActive: true });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Walk-in", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const supplierId = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Supplier", openingBalance: 0, isActive: true });
    const inv = (invoiceNo: string, invoiceDate: string, total: number, status: string) =>
      ctx.db.insert("invoices", { tenantId, invoiceNo, invoiceDate, clientId, subtotal: total, discount: 0, taxAmount: 0, total, amountPaid: total, outstanding: 0, paymentStatus: "paid", status, createdBy: boss });
    await inv("INV-1", eat(0), 5000, "posted");
    await inv("INV-2", eat(0), 9999, "cancelled"); // never a sale
    await inv("INV-3", eat(-1), 1000, "posted");
    const pay = (amount: number, paymentDate: string, voided?: boolean) =>
      ctx.db.insert("customerPayments", { tenantId, paymentDate, clientId, amount, paymentMethod: "cash", createdBy: boss, voided });
    await pay(5000, eat(0));
    await pay(7000, eat(0), true); // refunded / voided: not cash received
    await pay(1000, eat(-1));
    await ctx.db.insert("waiterCollections", { tenantId, staffId: boss, staffName: "W", cashierId: boss, cashierName: "Boss", date: eat(0), total: 3000, splits: [], orderIds: [], settledCount: 2, createdAt: now });
    // Selling Point bills: a sale as soon as the waiter enters it, paid or not.
    const bill = (invoiceNo: string, total: number, status: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("waiterOrders", { tenantId, invoiceNo, customerName: "Mteja", waiterId: boss, waiterName: "W", status, stockDeducted: true, lines: [], total, createdAt: now, updatedAt: now, ...extra });
    await bill("SP-1", 3000, "accepted", { settledAt: now, paidAmount: 3000 }); // already paid to the cashier (the 3000 collection above)
    await bill("SP-2", 4000, "pending"); // sent, the waiter still owes it: STILL a sale today
    await bill("SP-3", 1500, "printed", { paidAmount: 500 }); // part paid
    await bill("SP-4", 1111, "cancelled", { cancelledAt: now }); // never a sale
    await bill("SP-5", 777, "placed"); // draft not sent yet: not a sale
    const buy = (internalRef: string, total: number, status: string) =>
      ctx.db.insert("purchases", { tenantId, purchaseDate: eat(0), supplierId, internalRef, subtotal: total, discount: 0, additionalCharges: 0, taxAmount: 0, total, amountPaid: 0, outstanding: total, paymentStatus: "unpaid", status, createdBy: boss });
    await buy("P-1", 2000, "posted");
    await buy("P-2", 4000, "cancelled");
    if (opts.rollups) {
      // Roll-ups that drifted: they say something completely different from the records above.
      await ctx.db.insert("statsTotals", { tenantId, receivable: 0, payable: 0, productCount: 0, lowStock: 0, outOfStock: 0, inventoryValue: 0, billsDue: 0, topD7: [], topD30: [], topD90: [], refreshedAt: Date.now() });
      await ctx.db.insert("statsDaily", { tenantId, date: eat(0), shard: 0, sales: 999_999, purchases: 888_888, collected: 777_777, invoices: 55 });
    }
    return { boss };
  });
  return { t, me: t.withIdentity({ subject: ids.boss, tokenIdentifier: "x|1" }) };
}

describe("dashboard cards come from the real records, not from drifted roll-ups", () => {
  it("Today's Sales / Cash Received / Purchases are exact even when the roll-up is wrong", async () => {
    const { me } = await setup({ rollups: true });
    const m = await me.query(api.dashboard.getMetrics, { date: eat(0) });
    expect(m.todaySales).toBe(13500); // 5000 invoice + Selling Point bills 3000 (paid) + 4000 (unpaid) + 1500 (part paid); cancelled invoice 9999, cancelled bill 1111 and the unsent draft 777 are not sales
    expect(m.todayCash).toBe(8000); // cash is still only what was actually received: 5000 payment + 3000 from waiters; the voided 7000 is not cash
    expect(m.todayPurchaseTotal).toBe(2000); // the cancelled purchase is left out
  });

  it("still shows today's figures for a business whose roll-ups were never built (it used to show nothing)", async () => {
    const { me } = await setup({ rollups: false });
    const m = await me.query(api.dashboard.getMetrics, { date: eat(0) });
    expect(m).toMatchObject({ ready: false, todaySales: 13500, todayCash: 8000, todayPurchaseTotal: 2000 });
  });

  it("the graph's newest days agree with the cards", async () => {
    const { me } = await setup({ rollups: true });
    const c = await me.query(api.dashboard.getCharts, { from: eat(-6), today: eat(0) });
    const today = c.daily.find((d) => d.date === eat(0));
    const yesterday = c.daily.find((d) => d.date === eat(-1));
    expect(today).toMatchObject({ sales: 13500, collected: 8000, purchases: 2000, invoices: 4 });
    expect(yesterday).toMatchObject({ sales: 1000, collected: 1000, purchases: 0, invoices: 1 });
    expect(c.daily).toHaveLength(7);
    expect(c.totals.sales).toBe(14500);
  });
});
