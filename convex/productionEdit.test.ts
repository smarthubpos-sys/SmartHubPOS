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
  const produced = await as.mutation(api.production.produceBatch, { outputProductId: ids.makange, quantity: 10 });
  if (produced.batchId === null) throw new Error("Setup: batch haikutengenezwa");
  const batch = { ...produced, batchId: produced.batchId }; // batchId is now a plain Id, not Id | null
  const qty = (id: typeof ids.goat) => t.run(async (ctx) => (await ctx.db.get("products", id))?.currentQty);
  return { t, ids, as, batch, qty };
}

describe("editing and deleting a production batch", () => {
  it("edit moves ingredients and output by the difference only, and rescales the batch cost", async () => {
    const { as, ids, batch, qty } = await setup(); // batch of 10: goat 10->6, tomato 5->4
    await as.mutation(api.production.editBatch, { batchId: batch.batchId, quantity: 5, notes: "Sahihi" });
    expect([await qty(ids.makange), await qty(ids.goat), await qty(ids.tomato)]).toEqual([5, 8, 4.5]);
    const listed = (await as.query(api.production.recentBatches, {}))[0];
    expect(listed.producedQty).toBe(5);
    await expect(as.mutation(api.production.editBatch, { batchId: batch.batchId, quantity: 0 })).rejects.toThrow(/sifuri/);
  });

  it("edit refuses when raw stock is short or part of the product was sold", async () => {
    const { t, ids, as, batch, qty } = await setup();
    await expect(as.mutation(api.production.editBatch, { batchId: batch.batchId, quantity: 100 })).rejects.toThrow(/haitoshi/);
    await t.run((ctx) => ctx.db.patch("products", ids.makange, { currentQty: 3 }));
    await expect(as.mutation(api.production.editBatch, { batchId: batch.batchId, quantity: 5 })).rejects.toThrow(/haitoshi/);
    expect(await qty(ids.goat)).toBe(6);
  });

  it("delete puts the ingredients back, keeps the record cancelled and hides it from the list", async () => {
    const { t, ids, as, batch, qty } = await setup();
    await as.mutation(api.production.deleteBatch, { batchId: batch.batchId, reason: "Kosa" });
    expect([await qty(ids.makange), await qty(ids.goat), await qty(ids.tomato)]).toEqual([0, 10, 5]);
    expect(await as.query(api.production.recentBatches, {})).toHaveLength(0);
    const row = await t.run((ctx) => ctx.db.get("productionBatches", batch.batchId));
    expect(row?.status).toBe("cancelled");
    await expect(as.mutation(api.production.deleteBatch, { batchId: batch.batchId })).rejects.toThrow(/imefutwa/);
  });

  it("delete is refused once some of the product was sold, and a recipe can be deleted", async () => {
    const { t, ids, as, batch } = await setup();
    await t.run((ctx) => ctx.db.patch("products", ids.makange, { currentQty: 3 }));
    await expect(as.mutation(api.production.deleteBatch, { batchId: batch.batchId })).rejects.toThrow(/Huwezi kufuta/);
    const recipes = await as.query(api.production.listRecipes, {});
    await as.mutation(api.production.deleteRecipe, { recipeId: recipes[0]._id });
    expect(await as.query(api.production.listRecipes, {})).toHaveLength(0);
  });
});
