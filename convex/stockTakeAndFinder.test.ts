import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const DAY = "2026-11-05";
const NOW = `${DAY}T08:00:00.000Z`;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const T = await ctx.db.insert("tenants", { name: "Hotel", code: "H", isActive: true, createdByToken: "t", createdAt: NOW });
    const user = (name: string, role: string) => ctx.db.insert("users", { name, username: name.toLowerCase(), role, tenantId: T, isActive: true });
    const manager = await user("Meneja", "manager"), counter = await ctx.db.insert("users", { name: "Counter", username: "counter", role: "manager", tenantId: T, isActive: true, extraPermissions: ["stock.adjust"] }), cashier = await user("Cashier", "cashier"), waiter = await user("Asha", "waitress");
    const acc = (code: string, name: string, type: string) => ctx.db.insert("accounts", { tenantId: T, code, name, type, balance: 0, isActive: true, isSystem: false });
    await acc("1200", "Inventory", "asset"); await acc("5100", "Stock adjustment gain", "expense"); await acc("5200", "Stock shrinkage expense", "expense");
    const product = (code: string, name: string, qty: number, cost: number) => ctx.db.insert("products", { tenantId: T, itemCode: code, name, sellingPrice: cost * 2, openingQty: qty, currentQty: qty, weightedAvgCost: cost, isActive: true });
    const bia = await product("P1", "Bia", 10, 1000), soda = await product("P2", "Soda", 20, 500), maji = await product("P3", "Maji", 5, 200);
    // the waiter's bill: made but NOT sent to the cashier (no billSentAt)
    await ctx.db.insert("waiterOrders", { tenantId: T, customerName: "Meza 4", waiterId: waiter, waiterName: "Asha", status: "placed", paidAmount: 0, lines: [], total: 3000, invoiceNo: "INV-00077", createdAt: NOW, updatedAt: NOW } as never);
    return { manager, counter, cashier, waiter, bia, soda, maji };
  });
  const as = (id: typeof ids.manager) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
  return { t, ids, manager: as(ids.manager), counter: as(ids.counter), cashier: as(ids.cashier), waiter: as(ids.waiter) };
}

describe("Stock take of a past day compares with that day's stock", () => {
  it("shows yesterday's stock (not today's) and carries the difference to today's quantity", async () => {
    const { t, ids, counter } = await setup();
    const NEXT = "2026-11-06";
    // Bia: 10 now; 4 came in AFTER DAY -> on DAY the system had 6.
    await t.run(async (ctx) => {
      const p = await ctx.db.get("products", ids.bia);
      await ctx.db.insert("stockMovements", { tenantId: p!.tenantId, movementDate: NEXT, productId: ids.bia, movementType: "purchase", qtyIn: 4, qtyOut: 0, runningBalance: 10, createdBy: ids.counter });
    });
    const day = await counter.query(api.stockDaily.closingStock, { date: DAY });
    expect(day.rows.find((r) => r.productId === ids.bia)?.systemQty).toBe(6);
    const r = await counter.mutation(api.inventory.stockTake, { adjustmentDate: DAY, reason: "Stock take ya jana", lines: [{ productId: ids.bia, counted: 5 }] });
    expect(r).toMatchObject({ adjusted: 1, shortageValue: 1000 });
    expect((await t.run(async (ctx) => ctx.db.get("products", ids.bia)))?.currentQty).toBe(9); // 10 now - 1 missing on DAY
    const adj = await t.run(async (ctx) => ctx.db.query("stockAdjustments").collect());
    expect(adj[0]).toMatchObject({ qtyBefore: 6, qtyAfter: 5, adjustmentQty: -1 });
    // counting exactly what the system had that day changes nothing
    const same = await counter.mutation(api.inventory.stockTake, { adjustmentDate: DAY, reason: "Stock take", lines: [{ productId: ids.bia, counted: 5 }] });
    expect(same.unchanged).toBe(1);
  });
});

describe("Stock take: count many products, correct only the differences", () => {
  it("adjusts the products that differ, skips equal ones, shares one number and posts the value", async () => {
    const { t, ids, manager, counter } = await setup();
    const r = await counter.mutation(api.inventory.stockTake, { adjustmentDate: DAY, reason: "Stock take ya mwezi", lines: [
      { productId: ids.bia, counted: 8 },    // 2 missing  -> shortage 2000
      { productId: ids.soda, counted: 20 },  // same
      { productId: ids.maji, counted: 7 },   // 2 extra    -> overage 400
    ] });
    expect(r).toMatchObject({ adjusted: 2, unchanged: 1, shortageValue: 2000, overageValue: 400 });
    expect(r.reference).toMatch(/^ST-20261105-/);
    const qty = await t.run(async (ctx) => [(await ctx.db.get("products", ids.bia))?.currentQty, (await ctx.db.get("products", ids.soda))?.currentQty, (await ctx.db.get("products", ids.maji))?.currentQty]);
    expect(qty).toEqual([8, 20, 7]);
    const adj = await t.run(async (ctx) => ctx.db.query("stockAdjustments").collect());
    expect(adj).toHaveLength(2);
    expect(new Set(adj.map((x) => x.reference))).toEqual(new Set([r.reference]));
    const moves = await t.run(async (ctx) => ctx.db.query("stockMovements").collect());
    expect(moves.map((m) => [m.qtyIn, m.qtyOut]).sort()).toEqual([[0, 2], [2, 0]]);
    // the history report shows the stock take number
    const reg = await manager.query(api.inventory.stockRegisters, { startDate: DAY, endDate: DAY, light: true });
    expect(reg.adjustments.map((x) => x.reference)).toEqual([r.reference, r.reference]);
  });

  it("refuses the whole take (nothing saved) when a line is invalid, and refuses people without the stock right", async () => {
    const { t, ids, manager, counter, cashier } = await setup();
    await expect(counter.mutation(api.inventory.stockTake, { adjustmentDate: DAY, reason: "x", lines: [{ productId: ids.bia, counted: 5 }, { productId: ids.soda, counted: -1 }] })).rejects.toThrow();
    await expect(counter.mutation(api.inventory.stockTake, { adjustmentDate: DAY, reason: "  ", lines: [{ productId: ids.bia, counted: 5 }] })).rejects.toThrow();
    await expect(counter.mutation(api.inventory.stockTake, { adjustmentDate: DAY, reason: "x", lines: [{ productId: ids.bia, counted: 5 }, { productId: ids.bia, counted: 6 }] })).rejects.toThrow();
    await expect(manager.mutation(api.inventory.stockTake, { adjustmentDate: DAY, reason: "x", lines: [{ productId: ids.bia, counted: 5 }] })).rejects.toThrow(/stock.adjust/);
    await expect(cashier.mutation(api.inventory.stockTake, { adjustmentDate: DAY, reason: "x", lines: [{ productId: ids.bia, counted: 5 }] })).rejects.toThrow();
    expect((await t.run(async (ctx) => ctx.db.get("products", ids.bia)))?.currentQty).toBe(10);
    expect(await t.run(async (ctx) => ctx.db.query("stockAdjustments").collect())).toHaveLength(0);
  });
});

describe("Invoice Finder: a manager finds every waiter's bill", () => {
  it("manager finds a waiter's unsent bill by number and by the waiter's name; the waiter finds his own; a cashier does not see an unsent one", async () => {
    const { manager, waiter, cashier } = await setup();
    expect((await manager.query(api.waiterOrders.searchBillsForFinder, { search: "77" })).map((b) => b.invoiceNo)).toEqual(["INV-00077"]);
    expect((await manager.query(api.waiterOrders.searchBillsForFinder, { search: "asha" })).map((b) => b.waiterName)).toEqual(["Asha"]);
    expect(await waiter.query(api.waiterOrders.searchBillsForFinder, { search: "INV-00077" })).toHaveLength(1);
    expect(await cashier.query(api.waiterOrders.searchBillsForFinder, { search: "INV-00077" })).toHaveLength(0);
  });
});
