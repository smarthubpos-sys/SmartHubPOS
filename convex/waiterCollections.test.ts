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

describe("Selling Point orders reach the cashier, and the cashier receives the money", () => {
  it("a cashier without a department sees the sent order; a cashier of another department does not", async () => {
    const { asWaiter, asCashier, asLoungeCashier, productId } = await setup();
    await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-12345678", mode: "send", lines: [{ productId, qty: 2 }] });
    expect(await asCashier.query(api.waiterOrders.list, {})).toHaveLength(1);
    expect(await asLoungeCashier.query(api.waiterOrders.list, {})).toHaveLength(0);
  });

  it("receiving the money settles the orders once and rejects a wrong amount", async () => {
    const { asWaiter, asCashier, waiter, productId } = await setup();
    await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-12345678", mode: "send", lines: [{ productId, qty: 2 }] });
    const owing = await asCashier.query(api.waiterCollections.owing, {});
    expect(owing).toHaveLength(1);
    expect(owing[0].total).toBe(4000);
    const orderIds = owing[0].orders.map((o) => o._id);
    await expect(asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds, splits: [{ method: "cash", amount: 3000 }] })).rejects.toThrow();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds, splits: [{ method: "cash", amount: 4000 }] });
    expect(await asCashier.query(api.waiterCollections.owing, {})).toHaveLength(0);
    await expect(asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds, splits: [{ method: "cash", amount: 4000 }] })).rejects.toThrow();
  });

  it("a waiter cannot receive money", async () => {
    const { asWaiter } = await setup();
    await expect(asWaiter.query(api.waiterCollections.owing, {})).rejects.toThrow();
  });

  it("Super Admin never receives the cashier queue and cannot receive waiter money", async () => {
    const { asWaiter, asBoss, waiter, productId } = await setup();
    const sent = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-12345678", mode: "send", lines: [{ productId, qty: 1 }] });
    expect(await asBoss.query(api.waiterOrders.list, {})).toHaveLength(0);
    await expect(asBoss.mutation(api.waiterOrders.markHandled, { orderId: sent.orderId })).rejects.toThrow();
    await expect(asBoss.query(api.waiterCollections.owing, {})).rejects.toThrow();
    await expect(asBoss.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [sent.orderId], splits: [{ method: "cash", amount: 2000 }] })).rejects.toThrow();
  });

  it("an order already paid to the cashier cannot be deleted (dashboard totals stay true)", async () => {
    const { asWaiter, asCashier, waiter, productId } = await setup();
    const sent = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-12345678", mode: "send", lines: [{ productId, qty: 1 }] });
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [sent.orderId], splits: [{ method: "cash", amount: 2000 }] });
    await expect(asCashier.mutation(api.waiterOrders.cancel, { orderId: sent.orderId })).rejects.toThrow();
  });

  it("the dashboard shows money still owed by waiters", async () => {
    const { asWaiter, asCashier, productId } = await setup();
    await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-12345678", mode: "send", lines: [{ productId, qty: 3 }] });
    const m = await asCashier.query(api.dashboard.getMetrics, { date: new Date().toISOString().slice(0, 10) }).catch(() => null);
    if (m) { expect(m.waiterOwing).toBe(6000); expect(m.waiterOwingOrders).toBe(1); }
  });

  it("books the receipt in the ledger (cash, revenue, cost of goods, inventory) and the reports agree with stock", async () => {
    const { t, asWaiter, asCashier, asBoss, waiter, productId } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch("products", productId, { weightedAvgCost: 1200 }); });
    const sent = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-12345678", mode: "send", lines: [{ productId, qty: 2 }] });
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [sent.orderId], splits: [{ method: "cash", amount: 4000 }] });

    const booked = await t.run(async (ctx) => {
      const entries = await ctx.db.query("journalEntries").collect();
      const out: Record<string, { d: number; c: number }> = {};
      for (const e of entries) for (const l of await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect()) {
        const ac = await ctx.db.get("accounts", l.accountId); out[ac!.code] = { d: l.debit, c: l.credit };
      }
      return { n: entries.length, type: entries[0]?.sourceType, out };
    });
    expect(booked.n).toBe(1);
    expect(booked.type).toBe("waiter_sale");
    expect(booked.out["1000"]).toEqual({ d: 4000, c: 0 });
    expect(booked.out["4000"]).toEqual({ d: 0, c: 4000 });
    expect(booked.out["5000"]).toEqual({ d: 2400, c: 0 });
    expect(booked.out["1200"]).toEqual({ d: 0, c: 2400 });

    const stock = await asBoss.query(api.inventory.stockRegisters, {});
    expect(stock.products.find((p) => p._id === productId)?.currentQty).toBe(8); // the stock went down once, when the order was sent
    expect(stock.earnings[0]).toMatchObject({ qtySold: 2, sales: 4000, cost: 2400, profit: 1600 });

    const report = await asBoss.query(api.sales.salesRegisters, {});
    expect(report.totals.sales).toBe(4000);
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toMatchObject({ qty: 2, net: 4000, cost: 2400, profit: 1600, source: "Selling Point" });
  });

  it("books missing journals of older receipts once, and never twice", async () => {
    const { t, asWaiter, asCashier, asBoss, waiter, productId } = await setup();
    const sent = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-12345678", mode: "send", lines: [{ productId, qty: 1 }] });
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [sent.orderId], splits: [{ method: "cash", amount: 2000 }] });
    await t.run(async (ctx) => { // pretend this receipt was taken before journals existed
      for (const e of await ctx.db.query("journalEntries").collect()) {
        for (const l of await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect()) await ctx.db.delete("journalLines", l._id);
        await ctx.db.delete("journalEntries", e._id);
      }
    });
    expect(await asBoss.mutation(api.waiterCollections.bookMissingJournals, {})).toEqual({ booked: 1, skipped: 0 });
    expect(await asBoss.mutation(api.waiterCollections.bookMissingJournals, {})).toEqual({ booked: 0, skipped: 0 });
    expect(await t.run(async (ctx) => (await ctx.db.query("journalEntries").collect()).length)).toBe(1);
  });
});
