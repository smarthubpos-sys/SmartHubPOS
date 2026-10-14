import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { TestConvex } from "convex-test";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";
import { summarize, accRows, type Row } from "./reportCore";

const date = new Date().toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now }); // no module list = every module
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
    const cashier = await ctx.db.insert("users", { name: "Asha", username: "asha", role: "cashier", tenantId, isActive: true });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "ITM-1", name: "Sukari", sellingPrice: 10000, openingQty: 100, currentQty: 100, weightedAvgCost: 6000, isActive: true });
    return { tenantId, mgr, cashier, clientId, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asMgr: as(ids.mgr, 1), asCashier: as(ids.cashier, 2) };
}

const cashNet = async (t: TestConvex<typeof schema>) => t.run(async (ctx) => {
  const cash = (await ctx.db.query("accounts").collect()).find((a) => a.code === "1000");
  return (await ctx.db.query("journalLines").collect()).filter((l) => l.accountId === cash?._id).reduce((n: number, l) => n + l.debit - l.credit, 0);
});
const allBalanced = async (t: TestConvex<typeof schema>) => t.run(async (ctx) => { for (const e of await ctx.db.query("journalEntries").collect()) expect(Math.abs(e.totalDebit - e.totalCredit)).toBeLessThan(0.01); });

describe("partial sales return", () => {
  it("on a credit sale: stock back, the debt shrinks first, nothing is paid out, invoice and reports follow", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, taxRate: 18, lines: [{ productId, qty: 4, unitPrice: 10000 }], paymentAmount: 20000, paymentMethod: "cash" });
    expect(inv.total).toBe(47200); expect(inv.outstanding).toBe(27200);
    const lines = await asMgr.query(api.sales.returnableLines, { invoiceId: inv.invoiceId });
    const lineId = lines!.lines[0]._id;
    const r = await asMgr.mutation(api.sales.returnItems, { invoiceId: inv.invoiceId, lines: [{ invoiceLineId: lineId, qty: 1 }], reason: "imeharibika" });
    expect(r).toMatchObject({ total: 11800, creditedToDebt: 11800, refunded: 0, invoiceTotal: 35400, fullyReturned: false });
    await t.run(async (ctx) => {
      const i = await ctx.db.get("invoices", inv.invoiceId);
      expect(i).toMatchObject({ total: 35400, taxAmount: 5400, amountPaid: 20000, outstanding: 15400, paymentStatus: "partial" });
      expect((await ctx.db.get("products", productId))?.currentQty).toBe(97);
    });
    const reg = await asMgr.query(api.sales.salesRegisters, {});
    expect(reg.lines[0].qty).toBe(3);
    expect(reg.totals.sales).toBe(35400);
    expect(await cashNet(t)).toBe(20000);
    await allBalanced(t);
  });

  it("on a paid sale: the money goes back from the chosen method; over-returning is refused; the last return clears the invoice", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 2, unitPrice: 10000 }], paymentAmount: 20000, paymentMethod: "cash" });
    const lineId = (await asMgr.query(api.sales.returnableLines, { invoiceId: inv.invoiceId }))!.lines[0]._id;
    const r1 = await asMgr.mutation(api.sales.returnItems, { invoiceId: inv.invoiceId, lines: [{ invoiceLineId: lineId, qty: 1 }], refundMethod: "cash" });
    expect(r1).toMatchObject({ total: 10000, creditedToDebt: 0, refunded: 10000, invoiceTotal: 10000 });
    expect(await cashNet(t)).toBe(10000);
    await expect(asMgr.mutation(api.sales.returnItems, { invoiceId: inv.invoiceId, lines: [{ invoiceLineId: lineId, qty: 2 }], refundMethod: "cash" })).rejects.toThrow(/kilichobaki/);
    const r2 = await asMgr.mutation(api.sales.returnItems, { invoiceId: inv.invoiceId, lines: [{ invoiceLineId: lineId, qty: 1 }], refundMethod: "cash" });
    expect(r2).toMatchObject({ invoiceTotal: 0, fullyReturned: true });
    await t.run(async (ctx) => { expect(await ctx.db.get("invoices", inv.invoiceId)).toMatchObject({ total: 0, amountPaid: 0, outstanding: 0, paymentStatus: "returned" }); expect((await ctx.db.get("products", productId))?.currentQty).toBe(100); });
    expect(await cashNet(t)).toBe(0);
    await allBalanced(t);
  });

  it("only a manager may take returns", async () => {
    const { asMgr, asCashier, clientId, productId } = await setup();
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 2, unitPrice: 10000 }] });
    const lineId = (await asMgr.query(api.sales.returnableLines, { invoiceId: inv.invoiceId }))!.lines[0]._id;
    await expect(asCashier.mutation(api.sales.returnItems, { invoiceId: inv.invoiceId, lines: [{ invoiceLineId: lineId, qty: 1 }] })).rejects.toThrow(/meneja/);
  });

  it("cancelling an invoice after a partial return puts back only the rest of the stock", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 3, unitPrice: 10000 }], paymentAmount: 30000, paymentMethod: "cash" });
    const lineId = (await asMgr.query(api.sales.returnableLines, { invoiceId: inv.invoiceId }))!.lines[0]._id;
    await asMgr.mutation(api.sales.returnItems, { invoiceId: inv.invoiceId, lines: [{ invoiceLineId: lineId, qty: 1 }], refundMethod: "cash" });
    const v = await asMgr.mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId });
    expect(v.refunded).toBe(20000);
    await t.run(async (ctx) => { expect((await ctx.db.get("products", productId))?.currentQty).toBe(100); });
    expect(await cashNet(t)).toBe(0);
    await allBalanced(t);
  });
});

describe("period report", () => {
  it("rebuilds sales, returns, cost, profit and money movement from the ledger", async () => {
    const { asMgr, clientId, productId } = await setup();
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 3, unitPrice: 10000 }], paymentAmount: 30000, paymentMethod: "cash" });
    const lineId = (await asMgr.query(api.sales.returnableLines, { invoiceId: inv.invoiceId }))!.lines[0]._id;
    await asMgr.mutation(api.sales.returnItems, { invoiceId: inv.invoiceId, lines: [{ invoiceLineId: lineId, qty: 1 }], refundMethod: "cash" });
    const res = await asMgr.query(api.periodReport.chunk, { from: date, to: date });
    expect(res.tooBig).toBe(false);
    const rows: Row[] = accRows(res.sections.reduce((m, s) => { for (const r of s.rows) m.set(`${r.g}|${r.k}`, r); return m; }, new Map<string, Row>()));
    const s = summarize(rows);
    expect(s).toMatchObject({ sales: 30000, returns: 10000, netSales: 20000, cogs: 12000, grossProfit: 8000, netProfit: 8000, cashIn: 30000, cashOut: 10000, netCash: 20000 });
    expect(s.counts).toMatchObject({ invoices: 1, returns: 1 });
    const empty = await asMgr.query(api.periodReport.chunk, { from: "2000-01-01", to: "2000-01-07" });
    expect(empty.sections).toHaveLength(0);
  });

  it("saves a snapshot that can be listed and reopened", async () => {
    const { asMgr } = await setup();
    const id = await asMgr.mutation(api.periodReport.save, { period: "day", startDate: date, endDate: date, scope: "all", scopeLabel: "Biashara nzima", title: "Test", sections: [{ bk: "none", name: "Duka", rows: [{ g: "rev", k: "4000", label: "Sales revenue", a: 5000, b: 0, c: 0 }] }] });
    expect((await asMgr.query(api.periodReport.history, {}))).toHaveLength(1);
    const run = await asMgr.query(api.periodReport.getRun, { id });
    expect(run?.sections[0].rows[0].a).toBe(5000);
    await expect(asMgr.mutation(api.periodReport.save, { period: "week", startDate: date, endDate: date, scope: "all", scopeLabel: "x", title: "x", sections: [] })).rejects.toThrow(/Aina ya ripoti/);
  });
});
