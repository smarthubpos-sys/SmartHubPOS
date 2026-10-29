import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "R", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId, isActive: true });
    const p = (itemCode: string, name: string, qty: number, cost?: number) => ctx.db.insert("products", { tenantId, itemCode, name, openingQty: qty, currentQty: qty, sellingPrice: 100, isActive: true, weightedAvgCost: cost });
    const goat = await p("G", "Mbuzi", 10, 5000);
    const tomato = await p("T", "Nyanya", 5, 1000);
    const makange = await p("MK", "Mbuzi Makange", 0);
    const mgrUser = await ctx.db.get("users", mgr);
    await ctx.db.insert("productionRecipes", { tenantId, outputProductId: makange, outputQty: 1, ingredients: [{ productId: goat, qty: 0.4 }, { productId: tomato, qty: 0.1 }], active: true, updatedAt: "2026-10-29", updatedBy: mgr });
    return { tenantId, mgr, goat, tomato, makange, mgrUser };
  });
  const as = t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|mgr" });
  const batch = await as.mutation(api.production.produceBatch, { outputProductId: ids.makange, quantity: 10 });
  const qty = (id: typeof ids.goat) => t.run(async (ctx) => (await ctx.db.get("products", id))?.currentQty);
  return { t, ids, as, batch, qty };
}

describe("returning produced goods to raw stock", () => {
  it("moves the finished product back into its ingredients in proportion and records every step", async () => {
    const { t, ids, as, batch, qty } = await setup();
    expect([await qty(ids.makange), await qty(ids.goat), await qty(ids.tomato)]).toEqual([10, 6, 4]);
    const r = await as.mutation(api.production.returnToStock, { batchId: batch.batchId, quantity: 4, reason: "Haikuuzwa" });
    expect(r.remaining).toBe(6);
    expect(r.ingredients.map((i) => [i.name, Math.round(i.qty * 1000) / 1000])).toEqual([["Mbuzi", 1.6], ["Nyanya", 0.4]]);
    expect([await qty(ids.makange), await qty(ids.goat), await qty(ids.tomato)]).toEqual([6, 7.6, 4.4]);
    const moves = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(moves.filter((m) => m.movementType.startsWith("production_return"))).toHaveLength(3);
    const listed = (await as.query(api.production.recentBatches, {}))[0];
    expect(listed.returnedQty).toBe(4);
  });

  it("never returns more than the batch made, in total", async () => {
    const { as, batch } = await setup();
    await as.mutation(api.production.returnToStock, { batchId: batch.batchId, quantity: 6, reason: "Batch imezidi" });
    await expect(as.mutation(api.production.returnToStock, { batchId: batch.batchId, quantity: 5, reason: "Tena" })).rejects.toThrow(/hadi 4/);
    await as.mutation(api.production.returnToStock, { batchId: batch.batchId, quantity: 4, reason: "Zilizobaki" });
  });

  it("needs a reason, a positive quantity, and enough finished product left in stock", async () => {
    const { t, ids, as, batch, qty } = await setup();
    await expect(as.mutation(api.production.returnToStock, { batchId: batch.batchId, quantity: 1, reason: " " })).rejects.toThrow(/sababu/);
    await expect(as.mutation(api.production.returnToStock, { batchId: batch.batchId, quantity: 0, reason: "Sawa" })).rejects.toThrow(/sifuri/);
    await t.run((ctx) => ctx.db.patch("products", ids.makange, { currentQty: 3 })); // 7 already sold
    await expect(as.mutation(api.production.returnToStock, { batchId: batch.batchId, quantity: 4, reason: "Sawa" })).rejects.toThrow(/imeshauzwa/);
    expect(await qty(ids.goat)).toBe(6); // nothing changed by the refused attempts
  });

  it("refuses a user without stock permission and another business's batch", async () => {
    const { t, ids, batch } = await setup();
    const other = await t.run(async (ctx) => {
      const tenant = await ctx.db.insert("tenants", { name: "Nyingine", code: "O", isActive: true, createdByToken: "t2", createdAt: new Date().toISOString() });
      return { outsider: await ctx.db.insert("users", { name: "Out", username: "out", role: "manager", tenantId: tenant, isActive: true }), waiter: await ctx.db.insert("users", { name: "W", username: "w", role: "waiter", tenantId: ids.tenantId, isActive: true }) };
    });
    const as = (id: typeof other.outsider) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
    await expect(as(other.outsider).mutation(api.production.returnToStock, { batchId: batch.batchId, quantity: 1, reason: "Sawa" })).rejects.toThrow();
    await expect(as(other.waiter).mutation(api.production.returnToStock, { batchId: batch.batchId, quantity: 1, reason: "Sawa" })).rejects.toThrow();
  });
});
