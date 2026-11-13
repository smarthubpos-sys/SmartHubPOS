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
    await ctx.db.insert("tenantSettings", { tenantId, traIntegrationEnabled: false, stockControlEnabled: false, defaultCurrency: "TZS", waiterEnabled: true, waitressEnabled: true, waiterOrdersEnabled: true, waiterOrderMode: "cashier" });
    const waiter = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "waiter", tenantId, branchId: bar, isActive: true });
    const cashier = await ctx.db.insert("users", { name: "Neema", username: "neema", role: "cashier", tenantId, isActive: true });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", tenantId, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, branchId: bar, itemCode: "P1", name: "Bia", sellingPrice: 2000, openingQty: 20, currentQty: 20, isActive: true });
    return { tenantId, waiter, cashier, boss, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asWaiter: as(ids.waiter, 1), asCashier: as(ids.cashier, 2), asBoss: as(ids.boss, 4) };
}

const eat = (ms: number) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
const DAY = 86400000;

/** A bill sold at 01:30 EAT today (bar still open after midnight) = really last night's business. */
async function afterMidnightBill(key: string) {
  const s = await setup();
  const sent = await s.asWaiter.mutation(api.waiterOrders.submit, { clientKey: key, mode: "send", lines: [{ productId: s.productId, qty: 2 }] });
  const today = eat(Date.now());
  const early = new Date(Date.parse(`${today}T01:30:00Z`) - 3 * 3600000).toISOString();
  await s.t.run(async (ctx) => { await ctx.db.patch("waiterOrders", sent.orderId, { createdAt: early }); });
  return { ...s, orderId: sent.orderId, today, yesterday: eat(Date.now() - DAY) };
}

describe("night sales move back to the previous business day together with their cash", () => {
  it("a paid bill moves: sales AND received money are counted yesterday, today shows nothing", async () => {
    const { t, asCashier, asBoss, waiter, orderId, today, yesterday } = await afterMidnightBill("key-move-00001");
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }] });
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals).toMatchObject({ sales: 4000, paid: 4000 });

    const res = await asCashier.mutation(api.waiterDayMove.moveToDay, { orderIds: [orderId], day: yesterday });
    expect(res).toMatchObject({ day: yesterday, orders: 1, receipts: 1, money: 4000 });

    const y = await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday });
    expect(y.totals).toMatchObject({ sales: 4000, paid: 4000, received: 4000 });
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals).toMatchObject({ sales: 0, paid: 0, received: 0 });
    expect(await asCashier.query(api.waiterCollections.receipts, { date: yesterday })).toHaveLength(1);
    expect(await asCashier.query(api.waiterCollections.receipts, { date: today })).toHaveLength(0);

    // the ledger follows: the cash journal is dated yesterday
    const dates = await t.run(async (ctx) => (await ctx.db.query("journalEntries").collect()).filter((e) => e.sourceType === "waiter_sale").map((e) => e.entryDate));
    expect(dates).toEqual([yesterday]);
  });

  it("an unpaid bill moves too; receiving it afterwards counts the cash on the new day by default", async () => {
    const { asCashier, asBoss, waiter, orderId, today, yesterday } = await afterMidnightBill("key-move-00002");
    await asCashier.mutation(api.waiterDayMove.moveToDay, { orderIds: [orderId], day: yesterday });
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday })).totals).toMatchObject({ sales: 4000, paid: 0 });
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }] });
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday })).totals).toMatchObject({ sales: 4000, paid: 4000, received: 4000 });
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals).toMatchObject({ sales: 0, received: 0 });
  });

  it("refuses a future day and a receipt that also paid bills that were not chosen; nothing changes", async () => {
    const { t, asCashier, asWaiter, waiter, productId, orderId, today, yesterday } = await afterMidnightBill("key-move-00003");
    const tomorrow = eat(Date.now() + DAY);
    await expect(asCashier.mutation(api.waiterDayMove.moveToDay, { orderIds: [orderId], day: tomorrow })).rejects.toThrow();

    const second = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-move-00004", mode: "send", lines: [{ productId, qty: 1 }] });
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId, second.orderId], splits: [{ method: "cash", amount: 6000 }], paymentDate: today });
    await expect(asCashier.mutation(api.waiterDayMove.moveToDay, { orderIds: [orderId], day: yesterday })).rejects.toThrow();
    const stillToday = await t.run(async (ctx) => (await ctx.db.query("waiterCollections").collect()).map((c) => c.date));
    expect(stillToday).toEqual([today]);
  });

  it("a waiter cannot move days", async () => {
    const { asWaiter, orderId, yesterday } = await afterMidnightBill("key-move-00005");
    await expect(asWaiter.mutation(api.waiterDayMove.moveToDay, { orderIds: [orderId], day: yesterday })).rejects.toThrow();
  });
});
