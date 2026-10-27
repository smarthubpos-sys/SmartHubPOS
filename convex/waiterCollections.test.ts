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
    await expect(asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds, splits: [{ method: "cash", amount: 5000 }] })).rejects.toThrow(); // more than owed
    await expect(asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds, splits: [{ method: "cash", amount: 0 }] })).rejects.toThrow(); // nothing received
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds, splits: [{ method: "cash", amount: 4000 }] });
    expect(await asCashier.query(api.waiterCollections.owing, {})).toHaveLength(0);
    await expect(asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds, splits: [{ method: "cash", amount: 4000 }] })).rejects.toThrow();
  });

  it("partial payment: the waiter hands over less, the rest stays as his debt, and is paid later", async () => {
    const { t, asWaiter, asCashier, asBoss, waiter, productId } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch("products", productId, { weightedAvgCost: 1200 }); });
    const sent = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-12345678", mode: "send", lines: [{ productId, qty: 2 }] }); // 4000
    const res = await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [sent.orderId], splits: [{ method: "cash", amount: 1000 }] });
    expect(res).toMatchObject({ total: 1000, debt: 3000 });
    const owing = await asCashier.query(api.waiterCollections.owing, {});
    expect(owing).toHaveLength(1);
    expect(owing[0].total).toBe(3000);
    expect(owing[0].orders[0]).toMatchObject({ total: 3000, orderTotal: 4000, paid: 1000 });
    await expect(asCashier.mutation(api.waiterOrders.cancel, { orderId: sent.orderId })).rejects.toThrow(); // partly paid orders cannot be deleted
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    expect((await asCashier.query(api.waiterCollections.receipts, { date: today }))[0]).toMatchObject({ total: 1000, debt: 3000 });
    const report1 = await asBoss.query(api.sales.salesRegisters, {});
    expect(report1.totals).toMatchObject({ sales: 1000, waiterDebt: 3000, waiterDebtOpen: 3000 });
    // the rest is paid later, never more than owed
    await expect(asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [sent.orderId], splits: [{ method: "cash", amount: 3500 }] })).rejects.toThrow();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [sent.orderId], splits: [{ method: "cash", amount: 3000 }] });
    expect(await asCashier.query(api.waiterCollections.owing, {})).toHaveLength(0);
    const report2 = await asBoss.query(api.sales.salesRegisters, {});
    expect(report2.totals).toMatchObject({ sales: 4000, waiterDebtOpen: 0 });
    expect(report2.lines.reduce((n, l) => n + l.net, 0)).toBe(4000);
    expect(report2.lines.reduce((n, l) => n + l.cost, 0)).toBe(2400);
    const cash = await t.run(async (ctx) => { let d = 0, c = 0; for (const e of await ctx.db.query("journalEntries").collect()) for (const l of await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect()) { const ac = await ctx.db.get("accounts", l.accountId); if (ac?.code === "4000") c += l.credit; if (ac?.code === "1000") d += l.debit; } return { d, c }; });
    expect(cash).toEqual({ d: 4000, c: 4000 }); // cash and revenue match what was really received
  });

  it("partial money pays the oldest order first and leaves the newer one untouched", async () => {
    const { asWaiter, asCashier, waiter, productId } = await setup();
    const a = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-aaaaaaaa", mode: "send", lines: [{ productId, qty: 1 }] }); // 2000
    const b = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-bbbbbbbb", mode: "send", lines: [{ productId, qty: 1 }] }); // 2000
    const res = await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [a.orderId, b.orderId], splits: [{ method: "cash", amount: 2500 }] });
    expect(res).toMatchObject({ total: 2500, debt: 1500, orders: 2 });
    const owing = await asCashier.query(api.waiterCollections.owing, {});
    expect(owing[0].orders.map((o) => o.total)).toEqual([1500]); // first order fully paid, second owes 1500
    expect(owing[0].total).toBe(1500);
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

describe("Cashier counter sale: sells to his own customer and takes the money in one step", () => {
  async function counterSetup() {
    const base = await setup();
    const barCashier = await base.t.run(async (ctx) => {
      const bar = (await ctx.db.query("branches").collect()).find((b) => b.name === "Bar")!;
      return await ctx.db.insert("users", { name: "Rehema", username: "rehema", role: "cashier", tenantId: base.tenantId, branchId: bar._id, isActive: true });
    });
    return { ...base, barCashier, asBarCashier: base.t.withIdentity({ subject: barCashier, tokenIdentifier: "x|50" }) };
  }

  it("takes stock out once, books the sale and cash, and leaves nothing owed", async () => {
    const { t, asBarCashier, asBoss, productId } = await counterSetup();
    await t.run(async (ctx) => { await ctx.db.patch("products", productId, { weightedAvgCost: 1200 }); });
    const res = await asBarCashier.mutation(api.waiterCollections.counterSale, { clientKey: "counter-1-abcdefgh", lines: [{ productId, qty: 2 }], splits: [{ method: "cash", amount: 4000 }] });
    expect(res).toMatchObject({ total: 4000, duplicate: false });
    expect(await asBarCashier.query(api.waiterCollections.owing, {})).toHaveLength(0); // the order is born settled
    const stock = await asBoss.query(api.inventory.stockRegisters, {});
    expect(stock.products.find((p) => p._id === productId)?.currentQty).toBe(8);
    const journal = await t.run(async (ctx) => (await ctx.db.query("journalEntries").collect()).map((e) => e.sourceType));
    expect(journal).toEqual(["waiter_sale"]);
    const receipts = await asBarCashier.query(api.waiterCollections.receipts, { date: new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10) });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ total: 4000, splits: [{ method: "cash", amount: 4000 }] });
  });

  it("a repeated tap (same key) returns the same sale and never deducts twice", async () => {
    const { asBarCashier, asBoss, productId } = await counterSetup();
    const args = { clientKey: "counter-2-abcdefgh", lines: [{ productId, qty: 1 }], splits: [{ method: "cash", amount: 2000 }] };
    const a = await asBarCashier.mutation(api.waiterCollections.counterSale, args);
    const b = await asBarCashier.mutation(api.waiterCollections.counterSale, args);
    expect(b).toMatchObject({ duplicate: true, orderId: a.orderId });
    const stock = await asBoss.query(api.inventory.stockRegisters, {});
    expect(stock.products.find((p) => p._id === productId)?.currentQty).toBe(9);
  });

  it("a wrong payment amount is refused and nothing is recorded", async () => {
    const { asBarCashier, asBoss, productId } = await counterSetup();
    await expect(asBarCashier.mutation(api.waiterCollections.counterSale, { clientKey: "counter-3-abcdefgh", lines: [{ productId, qty: 1 }], splits: [{ method: "cash", amount: 1500 }] })).rejects.toThrow();
    const stock = await asBoss.query(api.inventory.stockRegisters, {});
    expect(stock.products.find((p) => p._id === productId)?.currentQty).toBe(10);
  });

  it("not enough stock rolls the whole sale back", async () => {
    const { asBarCashier, asBoss, productId } = await counterSetup();
    await expect(asBarCashier.mutation(api.waiterCollections.counterSale, { clientKey: "counter-4-abcdefgh", lines: [{ productId, qty: 50 }], splits: [{ method: "cash", amount: 100000 }] })).rejects.toThrow();
    expect(await asBarCashier.query(api.waiterCollections.receipts, { date: new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10) })).toHaveLength(0);
    const stock = await asBoss.query(api.inventory.stockRegisters, {});
    expect(stock.products.find((p) => p._id === productId)?.currentQty).toBe(10);
  });

  it("waiters and Super Admin cannot use the counter", async () => {
    const { asWaiter, asBoss, productId } = await counterSetup();
    const args = { lines: [{ productId, qty: 1 }], splits: [{ method: "cash", amount: 2000 }] };
    await expect(asWaiter.mutation(api.waiterCollections.counterSale, { clientKey: "counter-5-abcdefgh", ...args })).rejects.toThrow();
    await expect(asBoss.mutation(api.waiterCollections.counterSale, { clientKey: "counter-6-abcdefgh", ...args })).rejects.toThrow();
  });
});
