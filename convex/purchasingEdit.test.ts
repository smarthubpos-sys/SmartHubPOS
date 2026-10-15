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
    const clerk = await ctx.db.insert("users", { name: "Neema", username: "neema", role: "cashier", tenantId, isActive: true });
    const supplierId = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Acme", openingBalance: 0, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Sukari", openingQty: 0, currentQty: 0, sellingPrice: 1500, isActive: true });
    return { tenantId, mgr, clerk, supplierId, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asMgr: as(ids.mgr, 1), asClerk: as(ids.clerk, 2) };
}

/** Every posted journal must balance, and inventory + payable must match what the documents say. */
async function ledger(t: Awaited<ReturnType<typeof setup>>["t"]) {
  return await t.run(async (ctx) => {
    const entries = await ctx.db.query("journalEntries").collect();
    for (const e of entries) expect(Math.abs(e.totalDebit - e.totalCredit)).toBeLessThan(0.01);
    const accounts = await ctx.db.query("accounts").collect();
    const lines = await ctx.db.query("journalLines").collect();
    const bal = (code: string) => { const acc = accounts.find((a) => a.code === code); return lines.filter((l) => l.accountId === acc?._id).reduce((n, l) => n + l.debit - l.credit, 0); };
    return { inventory: bal("1200") || 0, payable: -bal("2000") || 0 }; // `|| 0` turns -0 into 0
  });
}

describe("purchase invoice: edit and delete", () => {
  it("a user without the permission is refused; the permission can be given to the user or to the role", async () => {
    const { t, asMgr, asClerk, clerk, supplierId, productId } = await setup();
    const r = await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, lines: [{ productId, qty: 10, unitCost: 1000 }] });
    await expect(asClerk.mutation(api.purchasingEdit.editPurchase, { purchaseId: r.purchaseId, notes: "x" })).rejects.toThrow(/purchasing.edit/);
    await expect(asClerk.mutation(api.purchasingEdit.voidPurchase, { purchaseId: r.purchaseId })).rejects.toThrow(/purchasing.delete/);

    // Edit and delete are two separate switches.
    await t.run(async (ctx) => { await ctx.db.patch("users", clerk, { extraPermissions: ["purchasing.edit"] }); });
    await asClerk.mutation(api.purchasingEdit.editPurchase, { purchaseId: r.purchaseId, notes: "ok" });
    await expect(asClerk.mutation(api.purchasingEdit.voidPurchase, { purchaseId: r.purchaseId })).rejects.toThrow(/purchasing.delete/);

    await t.run(async (ctx) => { await ctx.db.insert("roles", { name: "cashier", displayName: "Cashier", permissions: ["purchasing.delete"], isSystem: true }); });
    await asClerk.mutation(api.purchasingEdit.voidPurchase, { purchaseId: r.purchaseId });
  });

  it("editing lines moves stock, average cost, the payable and the ledger by the difference only", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    const r = await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, paymentAmount: 4000, paymentMethod: "cash", lines: [{ productId, qty: 10, unitCost: 1000 }] });
    await asMgr.mutation(api.purchasingEdit.editPurchase, { purchaseId: r.purchaseId, supplierInvoiceNo: "INV-77", lines: [{ productId, qty: 15, unitCost: 1200 }] });

    await t.run(async (ctx) => {
      const p = await ctx.db.get("products", productId);
      expect(p?.currentQty).toBe(15);
      expect(p?.weightedAvgCost).toBe(1200);
      const pur = await ctx.db.get("purchases", r.purchaseId);
      expect(pur).toMatchObject({ total: 18000, subtotal: 18000, amountPaid: 4000, outstanding: 14000, paymentStatus: "partial", supplierInvoiceNo: "INV-77" });
      const lines = await ctx.db.query("purchaseLines").withIndex("by_purchase", (q) => q.eq("purchaseId", r.purchaseId)).collect();
      expect(lines).toHaveLength(1);
    });
    const l = await ledger(t);
    expect(l.inventory).toBe(18000);
    expect(l.payable).toBe(14000);

    // A total below what was already paid is refused.
    await expect(asMgr.mutation(api.purchasingEdit.editPurchase, { purchaseId: r.purchaseId, lines: [{ productId, qty: 1, unitCost: 1000 }] })).rejects.toThrow(/kilicholipwa/);
  });

  it("cannot cut the quantity below what is already sold", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    const r = await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, lines: [{ productId, qty: 10, unitCost: 1000 }] });
    await t.run(async (ctx) => { await ctx.db.patch("products", productId, { currentQty: 3 }); }); // 7 already sold
    await expect(asMgr.mutation(api.purchasingEdit.editPurchase, { purchaseId: r.purchaseId, lines: [{ productId, qty: 5, unitCost: 1000 }] })).rejects.toThrow(/haitoshi/);
    await expect(asMgr.mutation(api.purchasingEdit.voidPurchase, { purchaseId: r.purchaseId })).rejects.toThrow(/haiwezi|ndogo/i);
  });

  it("deleting takes the stock out, refunds what was paid on receipt, clears the payable and leaves a balanced ledger", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    const r = await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, paymentAmount: 4000, paymentMethod: "cash", lines: [{ productId, qty: 10, unitCost: 1000 }] });
    const del = await asMgr.mutation(api.purchasingEdit.voidPurchase, { purchaseId: r.purchaseId, reason: "kosa" });
    expect(del.refunded).toBe(4000);
    await expect(asMgr.mutation(api.purchasingEdit.voidPurchase, { purchaseId: r.purchaseId })).rejects.toThrow(/tayari imefutwa/);

    await t.run(async (ctx) => {
      expect((await ctx.db.get("products", productId))?.currentQty).toBe(0);
      expect((await ctx.db.get("purchases", r.purchaseId))).toMatchObject({ status: "cancelled", outstanding: 0, amountPaid: 0 });
      const pays = await ctx.db.query("supplierPayments").collect();
      expect(pays.every((p) => p.voided)).toBe(true);
    });
    const l = await ledger(t);
    expect(l.inventory).toBe(0);
    expect(l.payable).toBe(0);

    const reg = await asMgr.query(api.purchasing.purchasingRegisters, {});
    expect(reg.totals).toMatchObject({ purchase: 0, outstanding: 0, paymentTotal: 0 });
  });

  it("an invoice with a purchase return must have the return deleted first; deleting the return restores stock and the balance", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    const r = await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, lines: [{ productId, qty: 10, unitCost: 1000 }] });
    const ret = await asMgr.mutation(api.purchasing.postPurchaseReturn, { purchaseId: r.purchaseId, returnDate: date, lines: [{ productId, qty: 4 }] });
    await expect(asMgr.mutation(api.purchasingEdit.voidPurchase, { purchaseId: r.purchaseId })).rejects.toThrow(/Purchase Return/);
    await expect(asMgr.mutation(api.purchasingEdit.editPurchase, { purchaseId: r.purchaseId, notes: "x" })).rejects.toThrow(/Purchase Return/);

    await asMgr.mutation(api.purchasingEdit.voidPurchaseReturn, { returnId: ret.returnId });
    await t.run(async (ctx) => {
      expect((await ctx.db.get("products", productId))?.currentQty).toBe(10);
      expect((await ctx.db.get("purchases", r.purchaseId))?.outstanding).toBe(10000);
    });
    expect(await ledger(t)).toEqual({ inventory: 10000, payable: 10000 });
    await asMgr.mutation(api.purchasingEdit.voidPurchase, { purchaseId: r.purchaseId });
    expect(await ledger(t)).toEqual({ inventory: 0, payable: 0 });
  });
});

describe("purchase order and GRN: edit and cancel", () => {
  it("edits and cancels an order; a GRN that added stock is taken back out; the order reopens", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    const o = await asMgr.mutation(api.purchasing.createPurchaseOrder, { supplierId, orderDate: date, lines: [{ productId, qty: 10, unitCost: 1000 }] });
    await asMgr.mutation(api.purchasingEdit.editPurchaseOrder, { orderId: o.orderId, notes: "haraka", lines: [{ productId, qty: 20, unitCost: 900 }] });
    await t.run(async (ctx) => { expect((await ctx.db.get("purchaseOrders", o.orderId))).toMatchObject({ total: 18000, notes: "haraka" }); });

    await asMgr.mutation(api.purchasing.approvePurchaseOrder, { orderId: o.orderId });
    const g = await asMgr.mutation(api.purchasing.createGoodsReceivedNote, { purchaseOrderId: o.orderId, receiptDate: date, lines: [{ productId, qtyReceived: 12 }] });
    await asMgr.mutation(api.purchasingEdit.editGoodsReceivedNote, { grnId: g.grnId, lines: [{ productId, qtyReceived: 8 }] });
    await asMgr.mutation(api.purchasing.confirmGoodsReceivedNote, { grnId: g.grnId });
    await t.run(async (ctx) => { expect((await ctx.db.get("products", productId))?.currentQty).toBe(8); });

    // Received goods block editing/cancelling the order until the GRN is deleted.
    await expect(asMgr.mutation(api.purchasingEdit.cancelPurchaseOrder, { orderId: o.orderId })).rejects.toThrow(/GRN/);
    await expect(asMgr.mutation(api.purchasingEdit.editGoodsReceivedNote, { grnId: g.grnId, notes: "x" })).rejects.toThrow(/iliyothibitishwa/);

    await asMgr.mutation(api.purchasingEdit.cancelGoodsReceivedNote, { grnId: g.grnId });
    await t.run(async (ctx) => {
      expect((await ctx.db.get("products", productId))?.currentQty).toBe(0);
      expect((await ctx.db.get("goodsReceivedNotes", g.grnId))?.status).toBe("cancelled");
      expect((await ctx.db.get("purchaseOrders", o.orderId))?.status).toBe("approved");
    });
    await asMgr.mutation(api.purchasingEdit.cancelPurchaseOrder, { orderId: o.orderId, reason: "hatuhitaji" });
    await t.run(async (ctx) => { expect((await ctx.db.get("purchaseOrders", o.orderId))?.status).toBe("cancelled"); });
    await expect(asMgr.mutation(api.purchasingEdit.cancelPurchaseOrder, { orderId: o.orderId })).rejects.toThrow(/tayari imefutwa/);
  });

  it("the screens learn from the current-business query which buttons to show", async () => {
    const { t, asMgr, asClerk, clerk } = await setup();
    expect(await asMgr.query(api.tenants.current, {})).toMatchObject({ canEditPurchase: true, canDeletePurchase: true });
    expect(await asClerk.query(api.tenants.current, {})).toMatchObject({ canEditPurchase: false, canDeletePurchase: false });
    await t.run(async (ctx) => { await ctx.db.patch("users", clerk, { extraPermissions: ["purchasing.delete"] }); });
    expect(await asClerk.query(api.tenants.current, {})).toMatchObject({ canEditPurchase: false, canDeletePurchase: true });
  });
});
