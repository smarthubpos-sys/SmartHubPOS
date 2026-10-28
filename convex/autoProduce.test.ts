import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const base = { name: "Bar", code: "BAR", currency: "TZS" } as const;

/** Business with a Makange recipe: 1 plate = mbuzi 400 g (10/g) + nyanya 100 g (5/g) = cost 4,500. */
async function setup(autoOnSale = true) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const waiter = await ctx.db.insert("users", { name: "juma", username: "juma", role: "waiter", tenantId, isActive: true, staffCode: "W01" });
    const group = await ctx.db.insert("productGroups", { tenantId, code: "FD", name: "Chakula", isActive: true });
    const mk = (itemCode: string, name: string, currentQty: number, extra: object = {}) =>
      ctx.db.insert("products", { tenantId, itemCode, name, groupId: group, sellingPrice: 1000, openingQty: currentQty, currentQty, isActive: true, ...extra });
    const mbuzi = await mk("M1", "Mbuzi (g)", 2000, { weightedAvgCost: 10 });
    const nyanya = await mk("M2", "Nyanya (g)", 1000, { weightedAvgCost: 5 });
    const makange = await mk("M3", "Mbuzi Makange", 0, { sellingPrice: 15000 });
    await ctx.db.insert("productionRecipes", {
      tenantId, outputProductId: makange, outputQty: 1, active: true, autoOnSale, updatedAt: now, updatedBy: boss,
      ingredients: [{ productId: mbuzi, qty: 400 }, { productId: nyanya, qty: 100 }],
    });
    return { tenantId, boss, waiter, mbuzi, nyanya, makange };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  await as(ids.boss, 1).mutation(api.tenants.update, { tenantId: ids.tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
  const get = async (id: Id<"products">) => (await t.run(async (ctx) => ctx.db.get("products", id)))!;
  const batches = async () => await t.run(async (ctx) => ctx.db.query("productionBatches").collect());
  return { t, ...ids, asWaiter: as(ids.waiter, 2), get, batches };
}

describe("a recipe product is produced from its ingredients when it is sold", () => {
  it("selling 2 Makange with none in stock takes 800 g mbuzi + 200 g nyanya out of stock and leaves no Makange stock", async () => {
    const { asWaiter, makange, mbuzi, nyanya, get, batches } = await setup();
    const r = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-mk-abcdefgh", mode: "send", lines: [{ productId: makange, qty: 2 }] });
    expect(r.duplicate).toBe(false);
    expect((await get(mbuzi)).currentQty).toBe(1200);
    expect((await get(nyanya)).currentQty).toBe(800);
    const m = await get(makange);
    expect(m.currentQty).toBe(0); // produced 2, sold 2
    expect(m.weightedAvgCost).toBe(4500); // real cost of one plate, so profit reports are right
    const [b] = await batches();
    expect(b.producedQty).toBe(2);
    expect(b.totalCost).toBe(9000);
  });

  it("Makange already cooked ahead is used first; only the missing part is produced", async () => {
    const { asWaiter, makange, mbuzi, t, get, batches } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch("products", makange, { currentQty: 1, weightedAvgCost: 4000 }); });
    await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-mk-bbbbbbbb", mode: "send", lines: [{ productId: makange, qty: 3 }] });
    expect((await get(mbuzi)).currentQty).toBe(2000 - 800); // only 2 plates were produced
    expect((await get(makange)).currentQty).toBe(0);
    expect((await batches())[0].producedQty).toBe(2);
  });

  it("an ingredient that runs short refuses the order, names the ingredient, and changes nothing", async () => {
    const { asWaiter, makange, nyanya, mbuzi, t, get, batches } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch("products", nyanya, { currentQty: 150 }); });
    await expect(asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-mk-cccccccc", mode: "send", lines: [{ productId: makange, qty: 2 }] })).rejects.toThrow(/Nyanya/);
    expect((await get(nyanya)).currentQty).toBe(150);
    expect((await get(mbuzi)).currentQty).toBe(2000);
    expect(await batches()).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("waiterOrders").collect())).toHaveLength(0);
  });

  it("a recipe NOT marked 'on sale' behaves as before: no stock, no sale", async () => {
    const { asWaiter, makange, mbuzi, get, batches } = await setup(false);
    await expect(asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-mk-dddddddd", mode: "send", lines: [{ productId: makange, qty: 1 }] })).rejects.toThrow(/Stock haitoshi/);
    expect((await get(mbuzi)).currentQty).toBe(2000);
    expect(await batches()).toHaveLength(0);
  });

  it("the product list tells the screens which products are produced on sale", async () => {
    const { asWaiter, makange, mbuzi } = await setup();
    const list = await asWaiter.query(api.products.listActive, {});
    expect(list.find((p) => p._id === makange)?.autoProduced).toBe(true);
    expect(list.find((p) => p._id === mbuzi)?.autoProduced).toBe(false);
  });
});
