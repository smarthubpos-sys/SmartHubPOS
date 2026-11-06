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
  it("without a date the money counts today (unchanged behaviour)", async () => {
    const { asCashier, asBoss, waiter, orderId, today } = await nightOrder();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }] });
    expect(await asCashier.query(api.waiterCollections.receipts, { date: today })).toHaveLength(1);
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals.sales).toBe(4000);
  });

  it("paid next morning but dated to the night of the sale: counts on the sale day, not today", async () => {
    const { asCashier, asBoss, waiter, orderId, yesterday, today } = await nightOrder();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 4000 }], paymentDate: yesterday });
    expect(await asCashier.query(api.waiterCollections.receipts, { date: yesterday })).toHaveLength(1);
    expect(await asCashier.query(api.waiterCollections.receipts, { date: today })).toHaveLength(0);
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday })).totals.sales).toBe(4000);
    expect((await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today })).totals.sales).toBe(0);
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
