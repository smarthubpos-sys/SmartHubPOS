import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const bar = await ctx.db.insert("branches", { tenantId, name: "Bar", code: "B1", isActive: true, createdAt: now });
    const lounge = await ctx.db.insert("branches", { tenantId, name: "Lounge", code: "L1", isActive: true, createdAt: now });
    await ctx.db.insert("tenantSettings", { tenantId, traIntegrationEnabled: false, stockControlEnabled: false, defaultCurrency: "TZS", waiterEnabled: true, waitressEnabled: true, waiterOrdersEnabled: true, waiterOrderMode: "cashier" });
    const waiter = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "waiter", tenantId, branchId: bar, isActive: true });
    const cashier = await ctx.db.insert("users", { name: "Neema", username: "neema", role: "cashier", tenantId, isActive: true }); // no department picked
    const loungeCashier = await ctx.db.insert("users", { name: "Zawadi", username: "zawadi", role: "cashier", tenantId, branchId: lounge, isActive: true });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", tenantId, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, branchId: bar, itemCode: "P1", name: "Bia", sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    return { tenantId, waiter, cashier, loungeCashier, boss, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asWaiter: as(ids.waiter, 1), asCashier: as(ids.cashier, 2), asLoungeCashier: as(ids.loungeCashier, 3), asBoss: as(ids.boss, 4) };
}

const eat = (ms: number) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
const DAY = 86400000;

/** Sells 2 x Bia (4000) and moves the order to "last night 22:30 EAT", as if it was sold yesterday night. */
async function nightOrder() {
  const s = await setup();
  const sent = await s.asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-night-0001", mode: "send", lines: [{ productId: s.productId, qty: 2 }] });
  const yesterday = eat(Date.now() - DAY);
  const lastNight = new Date(Date.parse(`${yesterday}T22:30:00Z`) - 3 * 3600000).toISOString(); // 22:30 EAT yesterday
  await s.t.run(async (ctx) => { await ctx.db.patch("waiterOrders", sent.orderId, { createdAt: lastNight }); });
  return { ...s, orderId: sent.orderId, yesterday, today: eat(Date.now()) };
}

describe("cashier chooses the day the waiter's money belongs to", () => {
  it("without a date the money goes to the day the goods were sold, not the day the cashier receives it", async () => {
    const { asCashier, asBoss, waiter, orderId, yesterday, today } = await nightOrder();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }] });
    expect(await asCashier.query(api.waiterCollections.receipts, { date: yesterday })).toHaveLength(1);
    expect(await asCashier.query(api.waiterCollections.receipts, { date: today })).toHaveLength(0);
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday })).totals).toMatchObject({ sales: 4000, paid: 4000 });
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals).toMatchObject({ sales: 0, paid: 0 });
  });

  it("the cashier may choose today on purpose: the sale stays on its day, the money is today's", async () => {
    const { asCashier, asBoss, waiter, orderId, yesterday, today } = await nightOrder();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }], paymentDate: today });
    const sold = await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday });
    const rec = await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today });
    expect(sold.totals.sales).toBe(4000);
    expect(rec.totals.sales).toBe(0);
    expect(rec.totals.paid).toBe(4000);
  });

  it("paid next morning but dated to the night of the sale: counts on the sale day, not today", async () => {
    const { asCashier, asBoss, waiter, orderId, yesterday, today } = await nightOrder();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }], paymentDate: yesterday });
    expect(await asCashier.query(api.waiterCollections.receipts, { date: yesterday })).toHaveLength(1);
    expect(await asCashier.query(api.waiterCollections.receipts, { date: today })).toHaveLength(0);
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday })).totals).toMatchObject({ sales: 4000, paid: 4000 });
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals).toMatchObject({ sales: 0, paid: 0 });
  });

  it("a bill nobody has paid yet is still a sale of its day: credit or cash, it shows in the report", async () => {
    const { asBoss, orderId, yesterday, today } = await nightOrder();
    const day = await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday });
    expect(day.totals).toMatchObject({ sales: 4000, paid: 0, invoices: 1, waiterDebt: 4000 });
    expect(day.invoices).toHaveLength(1);
    expect(day.invoices[0]).toMatchObject({ _id: orderId, date: yesterday, total: 4000, amountPaid: 0, outstanding: 4000, paymentStatus: "unpaid", source: "Selling Point" });
    expect(day.lines.reduce((n, l) => n + l.net, 0)).toBe(4000);
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals).toMatchObject({ sales: 0, invoices: 0 });
  });

  it("a bill sold at 01:30 at night belongs to that calendar day in East Africa, and a cancelled bill is not a sale", async () => {
    const { t, asBoss, asWaiter, productId, orderId, today } = await nightOrder();
    const early = new Date(Date.parse(`${today}T01:30:00Z`) - 3 * 3600000).toISOString(); // 01:30 EAT today (still yesterday in UTC)
    await t.run(async (ctx) => { await ctx.db.patch("waiterOrders", orderId, { createdAt: early }); });
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals.sales).toBe(4000);
    const second = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-night-0002", mode: "send", lines: [{ productId, qty: 1 }] });
    await asBoss.mutation(api.waiterOrders.cancelBillFromFinder, { orderId: second.orderId, reason: "Imerudi" }); // the boss cancels an unpaid sent bill (a cashier has no right to void)
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals).toMatchObject({ sales: 4000, invoices: 1 });
  });

  it("refuses a future date, a date before the order, and a malformed date; nothing is saved", async () => {
    const { t, asCashier, waiter, orderId, today } = await nightOrder();
    const tomorrow = eat(Date.now() + DAY);
    const twoDaysAgo = eat(Date.now() - 2 * DAY);
    for (const paymentDate of [tomorrow, twoDaysAgo, "2026-13-45", "yesterday"]) {
      await expect(asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }], paymentDate })).rejects.toThrow();
    }
    expect(await t.run(async (ctx) => (await ctx.db.query("waiterCollections").collect()).length)).toBe(0);
    expect(await asCashier.query(api.waiterCollections.owing, {})).toHaveLength(1); // still owed
    expect(today).toBe(eat(Date.now()));
  });
});
