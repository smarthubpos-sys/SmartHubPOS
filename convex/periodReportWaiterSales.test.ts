import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";
import { statementOf, summarize, sumSections, type Row } from "./reportCore";

/**
 * The Generate (day) report must agree with the Sales report for Selling Point sales:
 *  - a bill counts as a SALE on the day it was sold, paid or not;
 *  - money received later for an OPEN day goes back to the sale day (cash included);
 *  - money received later for a CLOSED day is a REPAYMENT, counted on the day it is received.
 */
const DAY = 86400000;
const eat = (ms: number) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const bar = await ctx.db.insert("branches", { tenantId, name: "Bar", code: "B1", isActive: true, createdAt: now });
    await ctx.db.insert("tenantSettings", { tenantId, traIntegrationEnabled: false, stockControlEnabled: false, defaultCurrency: "TZS", waiterEnabled: true, waitressEnabled: true, waiterOrdersEnabled: true, waiterOrderMode: "cashier" });
    const waiter = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "waiter", tenantId, branchId: bar, isActive: true });
    const cashier = await ctx.db.insert("users", { name: "Neema", username: "neema", role: "cashier", tenantId, isActive: true });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", tenantId, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, branchId: bar, itemCode: "P1", name: "Bia", sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    return { tenantId, waiter, cashier, boss, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asWaiter: as(ids.waiter, 1), asCashier: as(ids.cashier, 2), asBoss: as(ids.boss, 4) };
}

/** Sells 2 x Bia (4000) and moves the bill to "yesterday 22:30 EAT". */
async function yesterdayOrder() {
  const s = await setup();
  const sent = await s.asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-report-0001", mode: "send", lines: [{ productId: s.productId, qty: 2 }] });
  const yesterday = eat(Date.now() - DAY), today = eat(Date.now());
  const lastNight = new Date(Date.parse(`${yesterday}T22:30:00Z`) - 3 * 3600000).toISOString();
  await s.t.run(async (ctx) => { await ctx.db.patch("waiterOrders", sent.orderId, { createdAt: lastNight }); });
  return { ...s, orderId: sent.orderId, yesterday, today };
}

/** What the Generate screen builds for one day. */
async function dayReport(asBoss: Awaited<ReturnType<typeof setup>>["asBoss"], day: string) {
  const ch = await asBoss.query(api.periodReport.chunk, { from: day, to: day, scope: "all" });
  const dres = await asBoss.query(api.periodReport.debts, { from: day, to: day, scope: "all" });
  const summary = summarize(sumSections(ch.sections.map((x) => x.rows as Row[])));
  const debts = { waiters: dres.waiters, customers: dres.customers, waiterSales: dres.waiterSales, repaid: dres.repaid };
  return { summary, debts, st: statementOf(summary, debts), dres };
}

describe("Generate report = Sales report for Selling Point sales", () => {
  it("a bill nobody paid yet is a sale of its day and a debt", async () => {
    const { asBoss, yesterday } = await yesterdayOrder();
    const r = await dayReport(asBoss, yesterday);
    expect(r.st).toMatchObject({ sales: 4000, debts: 4000 });
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday })).totals.sales).toBe(4000);
  });

  it("cash received today for an OPEN day goes back to the day of the sale (sales and cash)", async () => {
    const { asBoss, asCashier, waiter, orderId, yesterday, today } = await yesterdayOrder();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }] });
    const y = await dayReport(asBoss, yesterday), t = await dayReport(asBoss, today);
    expect(y.st).toMatchObject({ sales: 4000, debts: 0 });
    expect(y.summary.channels).toMatchObject({ cash: 4000, total: 4000 });
    expect(t.st.sales).toBe(0);
    expect(t.summary.channels.total).toBe(0);
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday })).totals).toMatchObject({ sales: 4000, paid: 4000 });
  });

  it("even when the cashier picks today as the money day, the SALE stays on its day (never lost from the day report)", async () => {
    const { asBoss, asCashier, waiter, orderId, yesterday, today } = await yesterdayOrder();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }], paymentDate: today });
    const y = await dayReport(asBoss, yesterday), t = await dayReport(asBoss, today);
    expect(y.st.sales).toBe(4000);
    expect(t.st.sales).toBe(0);
    expect(t.summary.channels.cash).toBe(4000); // the cash itself is today's money
  });

  it("closed day: the unpaid bill stays a debt of its day, and the money received later is a repayment of today", async () => {
    const { asBoss, asCashier, waiter, orderId, yesterday, today } = await yesterdayOrder();
    const before = await dayReport(asBoss, yesterday);
    await asBoss.mutation(api.periodReport.save, { period: "day", startDate: yesterday, endDate: yesterday, scope: "all", scopeLabel: "Idara zote", title: "Siku", sections: [], debts: before.debts });
    const closed = await asCashier.query(api.waiterCollections.closedOwing, {});
    expect(closed[0].orders).toHaveLength(1);
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }] });
    const y = await dayReport(asBoss, yesterday), t = await dayReport(asBoss, today);
    expect(y.st.sales).toBe(4000);                       // the closed day keeps its sale ...
    expect(y.summary.channels.total).toBe(0);            // ... and its cash does not change
    expect(t.st.sales).toBe(0);                          // today has no new sale
    expect(t.summary.channels).toMatchObject({ cash: 4000, total: 4000 }); // but today received the money
    expect(t.dres.repaid).toEqual([{ bk: expect.any(String), amount: 4000 }]);
  });
});

describe("Period report takes sales and payment methods from the Staff Sales figures", () => {
  it("counts non-cancelled bills as sales and received money by payment method (a cancelled bill is not a sale)", async () => {
    const { t, tenantId, waiter, cashier, productId, asBoss } = await setup();
    const day = eat(Date.now());
    const now = new Date().toISOString();
    await t.run(async (ctx) => {
      const mk = (total: number, extra: Record<string, unknown> = {}) => ctx.db.insert("waiterOrders", { tenantId, customerName: "Meza", waiterId: waiter, waiterName: "Juma", status: "printed", paidAmount: total, lines: [{ productId, productName: "Bia", qty: 1, unitPrice: total, lineTotal: total }], total, invoiceNo: `INV-${total}`, createdAt: now, updatedAt: now, ...extra } as never);
      const a = await mk(4000), b = await mk(6000);
      await mk(9000, { status: "pending", cancelledAt: now }); // cancelled bill: must NOT count
      await ctx.db.insert("waiterCollections", { tenantId, staffId: waiter, staffName: "Juma", cashierId: cashier, cashierName: "Neema", date: day, total: 10000, splits: [{ method: "Cash", amount: 6000 }, { method: "Mpesa", amount: 4000 }], orderIds: [a, b], createdAt: now });
    });
    const r = await asBoss.query(api.periodReport.staffSales, { from: day, to: day });
    expect(r.sales.reduce((n, x) => n + x.amount, 0)).toBe(10000);
    const by = Object.fromEntries(r.methods.map((m) => [m.method, m.amount]));
    expect(by).toEqual({ Cash: 6000, Mpesa: 4000 });
    expect(r.truncated).toBe(false);
  });
});
