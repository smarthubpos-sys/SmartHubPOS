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
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
    const supplierId = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Sup", openingBalance: 0, isActive: true } as never);
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "ITM-1", name: "Sukari", sellingPrice: 10000, openingQty: 100, currentQty: 100, weightedAvgCost: 5000, isActive: true });
    return { tenantId, mgr, supplierId, clientId, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, asMgr: as(ids.mgr, 1), ...ids };
}

const balanceOf = (rows: Array<{ code: string; balance: number }>, code: string) => rows.find((r) => r.code === code)?.balance ?? 0;

describe("GRN reaches the ledger", () => {
  it("confirming posts Inventory / Goods received not invoiced, cancelling reverses it", async () => {
    const { asMgr, supplierId, productId } = await setup();
    const po = await asMgr.mutation(api.purchasing.createPurchaseOrder, { supplierId, orderDate: date, lines: [{ productId, qty: 10, unitCost: 4000 }] });
    await asMgr.mutation(api.purchasing.approvePurchaseOrder, { orderId: po.orderId });
    const grn = await asMgr.mutation(api.purchasing.createGoodsReceivedNote, { purchaseOrderId: po.orderId, receiptDate: date, lines: [{ productId, qtyReceived: 10 }] });
    await asMgr.mutation(api.purchasing.confirmGoodsReceivedNote, { grnId: grn.grnId });
    let tb = await asMgr.query(api.accounting.trialBalance, {});
    expect(balanceOf(tb, "1200")).toBe(40000);
    expect(balanceOf(tb, "2050")).toBe(-40000); // credit balance
    await asMgr.mutation(api.purchasingEdit.cancelGoodsReceivedNote, { grnId: grn.grnId });
    tb = await asMgr.query(api.accounting.trialBalance, {});
    expect(balanceOf(tb, "1200")).toBe(0);
    expect(balanceOf(tb, "2050")).toBe(0);
  });
});

describe("bad numbers and dates are refused", () => {
  it("NaN discount / tax / payment cannot make an invoice", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const sale = (extra: Record<string, number>) => asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }], ...extra } as never);
    await expect(sale({ paymentAmount: NaN })).rejects.toThrow(/si sahihi/);
    await expect(sale({ taxRate: NaN })).rejects.toThrow(/si sahihi/);
    await expect(sale({ discount: NaN })).rejects.toThrow(/si sahihi/);
    expect((await t.run(async (ctx) => await ctx.db.query("invoices").collect())).length).toBe(0);
  });

  it("NaN purchase payment and impossible dates are refused", async () => {
    const { asMgr, supplierId, clientId, productId } = await setup();
    await expect(asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, paymentAmount: NaN, lines: [{ productId, qty: 1, unitCost: 100 }] })).rejects.toThrow(/si sahihi/);
    await expect(asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: "2026-02-31", lines: [{ productId, qty: 1, unitCost: 100 }] })).rejects.toThrow(/Tarehe/);
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] });
    await expect(asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: "siku-yoyote", amount: 1000, paymentMethod: "cash" })).rejects.toThrow(/Tarehe/);
    await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, amount: 1000, paymentMethod: "cash" });
  });
});

describe("accounts", () => {
  it("balance sheet balances because it carries the period's net profit", async () => {
    const { asMgr, clientId, productId } = await setup();
    await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 2, unitPrice: 10000 }], paymentAmount: 20000, paymentMethod: "cash" });
    const bs = await asMgr.query(api.accounting.balanceSheet, { asOfDate: date });
    expect(bs.totalAssets).toBeGreaterThan(0);
    expect(bs.totalAssets).toBe(bs.liabilitiesAndEquity);
    const pl = await asMgr.query(api.accounting.profitAndLoss, { startDate: date, endDate: date });
    expect(pl.netProfit).toBe(10000);
    expect(bs.rows.find((r) => r.code === "3999")?.balance).toBe(10000);
  });
});

describe("access", () => {
  it("a user who must change the password is refused everywhere else", async () => {
    const { t, asMgr, mgr, clientId, productId } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch("users", mgr, { requirePasswordChange: true }); });
    await expect(asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] })).rejects.toThrow(/password change required/);
    expect((await asMgr.query(api.users.getCurrentUser, {}))?.requirePasswordChange).toBe(true); // the screen can still load
    await t.run(async (ctx) => { await ctx.db.patch("users", mgr, { requirePasswordChange: false }); });
    await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] });
  });

  it("a Super Admin with several businesses must pick one before saving", async () => {
    const t = convexTest(schema, modules);
    const sa = await t.run(async (ctx) => {
      const now = new Date().toISOString();
      await ctx.db.insert("tenants", { name: "A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
      await ctx.db.insert("tenants", { name: "B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
      return await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    });
    const asSa = t.withIdentity({ subject: sa, tokenIdentifier: "x|9" });
    await expect(asSa.mutation(api.products.upsert, { itemCode: "X1", name: "X", sellingPrice: 1, isActive: true })).rejects.toThrow(/Chagua biashara/);
  });
});
