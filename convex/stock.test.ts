import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Shop", code: "SHOP", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const userId = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId, isActive: true, extraPermissions: ["stock.adjust"] });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "CASH", name: "Cash Customer", openingBalance: 0, creditPolicy: "allow", isActive: true });
    return { tenantId, userId, clientId };
  });
  const as = t.withIdentity({ subject: ids.userId, tokenIdentifier: "x|1" });
  return { t, as, ...ids };
}

describe("stock + sales flow", () => {
  it("registers a product with opening stock and keeps movements reconciled", async () => {
    const { as } = await setup();
    const id = await as.mutation(api.products.upsert, { itemCode: "A1", name: "Sugar", sellingPrice: 2500, openingQty: 10, openingCost: 2000, isActive: true });
    const reg = await as.query(api.inventory.stockRegisters, {});
    const p = reg.products.find((x) => x._id === id)!;
    expect(p.currentQty).toBe(10);
    expect(p.difference).toBe(0);
    expect(p.stockValue).toBe(20000);
    expect(reg.movements.filter((m) => m.productId === id)).toHaveLength(1);
  });

  it("editing a product changes price but never the quantity", async () => {
    const { as } = await setup();
    const id = await as.mutation(api.products.upsert, { itemCode: "A1", name: "Sugar", sellingPrice: 2500, openingQty: 10, openingCost: 2000, isActive: true });
    await as.mutation(api.products.upsert, { id, itemCode: "A1", name: "Sugar 1kg", sellingPrice: 3000, openingQty: 999, isActive: true });
    const p = (await as.query(api.inventory.stockRegisters, {})).products.find((x) => x._id === id)!;
    expect(p.sellingPrice).toBe(3000);
    expect(p.name).toBe("Sugar 1kg");
    expect(p.currentQty).toBe(10);
    await expect(as.mutation(api.products.upsert, { itemCode: "A1", name: "Dup", sellingPrice: 1, isActive: true })).rejects.toThrow(/tayari ipo/);
  });

  it("multi-line invoice reduces stock, rejects the same item oversold across lines, and feeds reports", async () => {
    const { as, clientId } = await setup();
    const a = await as.mutation(api.products.upsert, { itemCode: "A1", name: "Sugar", sellingPrice: 2500, openingQty: 10, openingCost: 2000, isActive: true });
    const b = await as.mutation(api.products.upsert, { itemCode: "B1", name: "Rice", sellingPrice: 3000, openingQty: 5, openingCost: 2500, isActive: true });
    const date = new Date().toISOString().slice(0, 10);

    // 6 + 6 of the same product exceeds the 10 on hand even though each line alone would pass.
    await expect(as.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId: a, qty: 6, unitPrice: 2500 }, { productId: a, qty: 6, unitPrice: 2500 }] })).rejects.toThrow(/Stock haitoshi/);

    const r1 = await as.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId: a, qty: 4, unitPrice: 2500 }, { productId: b, qty: 2, unitPrice: 3000, discount: 500 }], paymentAmount: 10000, paymentMethod: "cash" });
    const r2 = await as.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId: a, qty: 1, unitPrice: 2500 }] });
    expect(r1.invoiceNo).toBe("INV-00001");
    expect(r2.invoiceNo).toBe("INV-00002");
    expect(r1.total).toBe(15500);

    const reg = await as.query(api.inventory.stockRegisters, { startDate: date, endDate: date });
    const pa = reg.products.find((x) => x._id === a)!; const pb = reg.products.find((x) => x._id === b)!;
    expect(pa.currentQty).toBe(5); expect(pb.currentQty).toBe(3);
    expect(reg.totals.mismatches).toBe(0);
    const sugar = reg.earnings.find((e) => e.productName === "Sugar")!;
    expect(sugar.qtySold).toBe(5); expect(sugar.sales).toBe(12500); expect(sugar.cost).toBe(10000); expect(sugar.profit).toBe(2500);
    const rice = reg.earnings.find((e) => e.productName === "Rice")!;
    expect(rice.sales).toBe(5500); expect(rice.profit).toBe(500);
    const hist = reg.movements.filter((m) => m.productId === a);
    expect(hist.map((m) => m.balance)).toEqual([10, 6, 5]);

    const sales = await as.query(api.sales.salesRegisters, { startDate: date, endDate: date });
    expect(sales.totals.sales).toBe(18000); expect(sales.lines).toHaveLength(3);
    expect(sales.lines.reduce((n, l) => n + l.net, 0)).toBe(18000);
    expect(sales.balances.find((x) => x.clientId === clientId)?.closing).toBe(8000);
  });

  it("adjustment is recorded and reconcile repairs legacy products", async () => {
    const { as, t, tenantId } = await setup();
    const legacy = await t.run((ctx) => ctx.db.insert("products", { tenantId, itemCode: "L1", name: "Legacy", openingQty: 7, currentQty: 7, sellingPrice: 100, isActive: true }));
    let reg = await as.query(api.inventory.stockRegisters, {});
    expect(reg.totals.mismatches).toBe(1);
    await as.mutation(api.inventory.reconcileMovements, {});
    reg = await as.query(api.inventory.stockRegisters, {});
    expect(reg.totals.mismatches).toBe(0);
    await as.mutation(api.inventory.adjust, { productId: legacy, newQty: 4, reason: "count", adjustmentDate: new Date().toISOString().slice(0, 10) });
    reg = await as.query(api.inventory.stockRegisters, {});
    expect(reg.products.find((x) => x._id === legacy)?.currentQty).toBe(4);
    expect(reg.totals.mismatches).toBe(0);
    expect(reg.adjustments[0].difference).toBe(-3);
  });

  it("works for a Super Admin with no office/branch at all (branch is optional)", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true }));
    const as = t.withIdentity({ subject: userId, tokenIdentifier: "x|2" });
    const clientId = await as.mutation(api.clients.upsert, { code: "CASH", name: "Cash Customer", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const pid = await as.mutation(api.products.upsert, { itemCode: "A1", name: "Sugar", sellingPrice: 2500, openingQty: 10, openingCost: 2000, isActive: true });
    const date = new Date().toISOString().slice(0, 10);
    const r = await as.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId: pid, qty: 3, unitPrice: 2500 }], paymentAmount: 7500 });
    expect(r.invoiceNo).toBe("INV-00001");
    const reg = await as.query(api.inventory.stockRegisters, {});
    expect(reg.products[0].currentQty).toBe(7);
    expect(reg.totals.mismatches).toBe(0);
  });
});
