import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const date = new Date().toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "stock", "purchasing"] });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
    const supplierId = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Acme", openingBalance: 0, isActive: true });
    const otherSupplierId = await ctx.db.insert("suppliers", { tenantId, code: "S2", name: "Beta", openingBalance: 0, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Sukari", openingQty: 0, currentQty: 0, sellingPrice: 1500, isActive: true });
    return { tenantId, mgr, supplierId, otherSupplierId, productId };
  });
  const asMgr = t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|1" });
  return { t, ...ids, asMgr };
}

async function approvedOrder() {
  const s = await setup();
  const po = await s.asMgr.mutation(api.purchasing.createPurchaseOrder, { supplierId: s.supplierId, orderDate: date, lines: [{ productId: s.productId, qty: 10, unitCost: 1000 }] });
  return { ...s, po };
}
const stockOf = (t: Awaited<ReturnType<typeof setup>>["t"], id: Id<"products">) => t.run(async (ctx) => (await ctx.db.get("products", id))!.currentQty);

describe("Purchase Entry received against a Purchase Order", () => {
  it("an order must be approved first; until then it is not offered and cannot be received", async () => {
    const { t, asMgr, po, supplierId, productId } = await approvedOrder();
    expect(await asMgr.query(api.purchasing.ordersToReceive, {})).toHaveLength(0);
    await expect(asMgr.mutation(api.purchasing.receivePurchase, { purchaseOrderId: po.orderId, supplierId, purchaseDate: date, lines: [{ productId, qty: 5, unitCost: 1000 }] })).rejects.toThrow();
    expect(await stockOf(t, productId)).toBe(0);
  });

  it("less than ordered arrives: stock grows by what came, the order stays open for the rest; the second delivery completes it", async () => {
    const { t, asMgr, po, productId } = await approvedOrder();
    await asMgr.mutation(api.purchasing.approvePurchaseOrder, { orderId: po.orderId });
    const open = await asMgr.query(api.purchasing.ordersToReceive, {});
    expect(open).toHaveLength(1);
    expect(open[0].lines[0]).toMatchObject({ qtyOrdered: 10, qtyReceived: 0, unitCost: 1000 });

    await asMgr.mutation(api.purchasing.receivePurchase, { purchaseOrderId: po.orderId, purchaseDate: date, lines: [{ productId, qty: 6, unitCost: 1000 }] });
    expect(await stockOf(t, productId)).toBe(6);
    let after = await asMgr.query(api.purchasing.ordersToReceive, {});
    expect(after[0]).toMatchObject({ status: "partially_received" });
    expect(after[0].lines[0].qtyReceived).toBe(6);

    await asMgr.mutation(api.purchasing.receivePurchase, { purchaseOrderId: po.orderId, purchaseDate: date, lines: [{ productId, qty: 5, unitCost: 1000 }] }); // more than the balance (4) is allowed
    expect(await stockOf(t, productId)).toBe(11);
    after = await asMgr.query(api.purchasing.ordersToReceive, {});
    expect(after).toHaveLength(0); // fully received: nothing left to receive
    const sheet = await asMgr.query(api.purchasing.orderDetails, { orderId: po.orderId });
    expect(sheet).toMatchObject({ status: "fully_received", supplier: { name: "Acme" } });
  });

  it("the purchase is linked to the order, and another supplier is refused", async () => {
    const { t, asMgr, po, productId, otherSupplierId } = await approvedOrder();
    await asMgr.mutation(api.purchasing.approvePurchaseOrder, { orderId: po.orderId });
    await expect(asMgr.mutation(api.purchasing.receivePurchase, { purchaseOrderId: po.orderId, supplierId: otherSupplierId, purchaseDate: date, lines: [{ productId, qty: 1, unitCost: 1000 }] })).rejects.toThrow();
    const r = await asMgr.mutation(api.purchasing.receivePurchase, { purchaseOrderId: po.orderId, purchaseDate: date, lines: [{ productId, qty: 3, unitCost: 1000 }] });
    const row = await t.run(async (ctx) => ctx.db.get("purchases", r.purchaseId));
    expect(row?.purchaseOrderId).toBe(po.orderId);
  });
});
