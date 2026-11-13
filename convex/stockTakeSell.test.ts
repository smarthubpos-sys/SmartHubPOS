import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const base = { name: "Bar", code: "BAR", currency: "TZS" } as const;
const day = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const other = await ctx.db.insert("tenants", { name: "Other", code: "OTH", isActive: true, createdByToken: "t", createdAt: now });
    const user = (tid: Id<"tenants">, username: string, role: string, extra: object = {}) => ctx.db.insert("users", { name: username, username, role, tenantId: tid, isActive: true, ...extra });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const taker = await user(tenantId, "taker", "manager", { extraPermissions: ["stock.view", "stock.adjust", "waiterOrders.manage"] });
    const waiter = await user(tenantId, "juma", "waiter", { staffCode: "W01" });
    const cashier = await user(tenantId, "cash", "cashier");
    const stranger = await user(other, "mgeni", "waiter", { staffCode: "W09" });
    const group = await ctx.db.insert("productGroups", { tenantId, code: "DR", name: "Vinywaji", isActive: true });
    const mk = (itemCode: string, name: string, currentQty: number, sellingPrice: number) =>
      ctx.db.insert("products", { tenantId, itemCode, name, groupId: group, sellingPrice, openingQty: currentQty, currentQty, weightedAvgCost: 1500, isActive: true });
    const bia = await mk("P1", "Bia", 10, 2000);
    const soda = await mk("P2", "Soda", 3, 1000);
    return { tenantId, boss, taker, waiter, cashier, stranger, bia, soda };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  await as(ids.boss, 1).mutation(api.tenants.update, { tenantId: ids.tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
  const qty = async (id: Id<"products">) => (await t.run(async (ctx) => ctx.db.get("products", id)))!.currentQty;
  const orders = async () => await t.run(async (ctx) => ctx.db.query("waiterOrders").collect());
  return { t, ...ids, asTaker: as(ids.taker, 2), asCashier: as(ids.cashier, 3), qty, orders };
}

describe("Stock take: sell the shortage to a staff member", () => {
  it("sells only what is missing, at the SELLING price, onto his account; overage is just added to stock", async () => {
    const s = await setup();
    const r = await s.asTaker.mutation(api.inventory.stockTake, {
      adjustmentDate: day, reason: "Month end",
      lines: [{ productId: s.bia, counted: 8 }, { productId: s.soda, counted: 5 }],
      sellShortageTo: s.waiter,
    });
    expect(await s.qty(s.bia)).toBe(8); // 10 system, 8 counted: 2 missing
    expect(await s.qty(s.soda)).toBe(5); // 3 system, 5 counted: 2 extra, only added
    expect(r.soldTotal).toBe(4000); // 2 x 2,000 selling price (not the 1,500 cost)
    const orders = await s.orders();
    expect(orders).toHaveLength(1);
    expect(orders[0].waiterId).toBe(s.waiter);
    expect(orders[0].status).toBe("pending");
    expect(orders[0].stockDeducted).toBe(true);
    expect(orders[0].lines).toEqual([expect.objectContaining({ productId: s.bia, qty: 2, unitPrice: 2000, lineTotal: 4000 })]);
    // the cashier can now receive this money under "Receive waiters' money"
    const owing = await s.asCashier.query(api.waiterCollections.owing, {});
    expect(owing).toEqual([expect.objectContaining({ staffId: s.waiter, total: 4000 })]);
  });

  it("without the switch the shortage stays a normal adjustment and nothing is sold", async () => {
    const s = await setup();
    await s.asTaker.mutation(api.inventory.stockTake, { adjustmentDate: day, reason: "Month end", lines: [{ productId: s.bia, counted: 8 }] });
    expect(await s.qty(s.bia)).toBe(8);
    expect(await s.orders()).toHaveLength(0);
  });

  it("a product without a selling price refuses the whole take and changes nothing", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => { await ctx.db.patch("products", s.bia, { sellingPrice: 0 }); });
    await expect(s.asTaker.mutation(api.inventory.stockTake, { adjustmentDate: day, reason: "x", lines: [{ productId: s.bia, counted: 8 }, { productId: s.soda, counted: 5 }], sellShortageTo: s.waiter })).rejects.toThrow(/Bei ya kuuzia/);
    expect(await s.qty(s.bia)).toBe(10);
    expect(await s.qty(s.soda)).toBe(3);
    expect(await s.orders()).toHaveLength(0);
  });

  it("cannot charge the shortage to a user of another business", async () => {
    const s = await setup();
    await expect(s.asTaker.mutation(api.inventory.stockTake, { adjustmentDate: day, reason: "x", lines: [{ productId: s.bia, counted: 8 }], sellShortageTo: s.stranger })).rejects.toThrow();
    expect(await s.qty(s.bia)).toBe(10);
  });
});
