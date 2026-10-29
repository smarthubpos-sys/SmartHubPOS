import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "M", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true, extraPermissions: ["stock.adjust"] });
    const p = (itemCode: string, name: string, extra: Record<string, unknown> = {}) => ctx.db.insert("products", { tenantId, itemCode, name, openingQty: 10, currentQty: 10, sellingPrice: 100, isActive: true, ...extra });
    const goat = await p("G", "Mbuzi (malighafi)");
    const tomato = await p("T", "Nyanya (malighafi)");
    const makange = await p("MK", "Mbuzi Makange");
    const soda = await p("S", "Soda");
    await ctx.db.insert("productionRecipes", { tenantId, outputProductId: makange, outputQty: 1, ingredients: [{ productId: goat, qty: 0.4 }, { productId: tomato, qty: 0.1 }], active: true, updatedAt: "2026-10-29", updatedBy: mgr });
    return { tenantId, mgr, goat, tomato, makange, soda };
  });
  return { t, ids, as: t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|mgr" }) };
}
const menu = async (as: Awaited<ReturnType<typeof setup>>["as"]) => Object.fromEntries((await as.query(api.products.listActive, {})).map((p) => [p.name, p.onMenu]));

describe("sales menu visibility", () => {
  it("keeps production ingredients off the menu by default, while finished and ordinary products stay on", async () => {
    const { as } = await setup();
    expect(await menu(as)).toEqual({ "Mbuzi (malighafi)": false, "Nyanya (malighafi)": false, "Mbuzi Makange": true, Soda: true });
  });

  it("lets the tick decide: ticked shows an ingredient, unticked hides an ordinary product", async () => {
    const { t, ids, as } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch("products", ids.goat, { showInSales: true }); await ctx.db.patch("products", ids.soda, { showInSales: false }); });
    expect(await menu(as)).toEqual({ "Mbuzi (malighafi)": true, "Nyanya (malighafi)": false, "Mbuzi Makange": true, Soda: false });
  });

  it("saves the tick from the product form and reports it in the stock register", async () => {
    const { ids, as } = await setup();
    await as.mutation(api.products.upsert, { id: ids.tomato, itemCode: "T", name: "Nyanya (malighafi)", sellingPrice: 100, isActive: true, showInSales: true });
    expect((await menu(as))["Nyanya (malighafi)"]).toBe(true);
    const reg = await as.query(api.inventory.stockRegisters, { light: true });
    expect(Object.fromEntries(reg.products.map((p) => [p.name, p.onMenu]))["Nyanya (malighafi)"]).toBe(true);
    await as.mutation(api.products.upsert, { id: ids.tomato, itemCode: "T", name: "Nyanya (malighafi)", sellingPrice: 100, isActive: true, showInSales: false });
    expect((await menu(as))["Nyanya (malighafi)"]).toBe(false);
  });

  it("a product that is both an ingredient and the output of another recipe stays on the menu", async () => {
    const { t, ids, as } = await setup();
    await t.run((ctx) => ctx.db.insert("productionRecipes", { tenantId: ids.tenantId, outputProductId: ids.tomato, outputQty: 1, ingredients: [{ productId: ids.soda, qty: 1 }], active: true, updatedAt: "2026-10-29", updatedBy: ids.mgr }));
    expect((await menu(as))["Nyanya (malighafi)"]).toBe(true);
  });
});
