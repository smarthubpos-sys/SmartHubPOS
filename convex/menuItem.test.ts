import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const base = { name: "Bar", code: "BAR", currency: "TZS" } as const;

/** A menu item (isStockItem = false) "Makange" picking mbuzi 400 + nyanya 100 per plate. The recipe has NO auto-on-sale tick on purpose. */
async function setup(opts: { recipe?: boolean; stale?: number } = {}) {
  const { recipe = true, stale = 0 } = opts;
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
    const makange = await mk("M3", "Mbuzi Makange", stale, { sellingPrice: 15000, isStockItem: false });
    if (recipe) await ctx.db.insert("productionRecipes", {
      tenantId, outputProductId: makange, outputQty: 1, active: true, autoOnSale: false, updatedAt: now, updatedBy: boss,
      ingredients: [{ productId: mbuzi, qty: 400 }, { productId: nyanya, qty: 100 }],
    });
    return { tenantId, boss, waiter, mbuzi, nyanya, makange };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  await as(ids.boss, 1).mutation(api.tenants.update, { tenantId: ids.tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
  const get = async (id: Id<"products">) => (await t.run(async (ctx) => ctx.db.get("products", id)))!;
  return { t, ...ids, asBoss: as(ids.boss, 1), asWaiter: as(ids.waiter, 2), get };
}

describe("a menu item (not a stock item) only picks from its recipe", () => {
  it("sells from the ingredients even without the auto-on-sale tick, and never keeps a quantity", async () => {
    const { asWaiter, makange, mbuzi, nyanya, get } = await setup();
    await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-menu-aaaaaaaa", mode: "send", lines: [{ productId: makange, qty: 2 }] });
    expect((await get(mbuzi)).currentQty).toBe(1200);
    expect((await get(nyanya)).currentQty).toBe(800);
    expect((await get(makange)).currentQty).toBe(0);
  });

  it("old leftovers on the menu item (plus or minus) are ignored: the whole sale comes from the ingredients and it ends at 0", async () => {
    for (const stale of [3, -2]) {
      const { asWaiter, makange, mbuzi, get } = await setup({ stale });
      await asWaiter.mutation(api.waiterOrders.submit, { clientKey: `key-menu-stale${stale > 0 ? "p" : "m"}x`, mode: "send", lines: [{ productId: makange, qty: 1 }] });
      expect((await get(mbuzi)).currentQty).toBe(1600);
      expect((await get(makange)).currentQty).toBe(0);
    }
  });

  it("is refused when it points to no recipe", async () => {
    const { asWaiter, makange } = await setup({ recipe: false });
    await expect(asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-menu-norecipe", mode: "send", lines: [{ productId: makange, qty: 1 }] })).rejects.toThrow(/haijaelekezwa kwenye stock/);
  });

  it("is refused when the ingredient stock is not enough, and nothing changes", async () => {
    const { asWaiter, makange, nyanya, mbuzi, t, get } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch("products", nyanya, { currentQty: 150 }); });
    await expect(asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-menu-short-aa", mode: "send", lines: [{ productId: makange, qty: 2 }] })).rejects.toThrow(/Hakuna stock ya kutosha ya Nyanya/);
    expect((await get(nyanya)).currentQty).toBe(150);
    expect((await get(mbuzi)).currentQty).toBe(2000);
  });

  it("shows no quantity in the stock lists and is left out of stock value / out-of-stock totals", async () => {
    const { asBoss, asWaiter, makange, t } = await setup({ stale: 3 });
    const active = await asWaiter.query(api.products.listActive, {});
    const row = active.find((p) => p._id === makange)!;
    expect(row.isMenuItem).toBe(true);
    expect(row.currentQty).toBe(0);
    expect(row.routed).toBe(true);
    const reg = await asBoss.query(api.inventory.stockRegisters, { light: true });
    const r = reg.products.find((p) => p._id === makange)!;
    expect(r.currentQty).toBe(0);
    expect(r.stockValue).toBe(0);
    expect(reg.totals.items).toBe(2); // the two ingredients only
    await t.run(async () => undefined);
  });

  it("cannot be adjusted or produced as a batch", async () => {
    const { asBoss, makange } = await setup();
    await expect(asBoss.mutation(api.production.produceBatch, { outputProductId: makange, quantity: 1 })).rejects.toThrow(/bidhaa ya menu/);
  });
});
