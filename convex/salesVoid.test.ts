import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const date = new Date().toISOString().slice(0, 10);

async function setup(policy = "allow", creditLimit?: number) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "stock"] });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
    const cashier = await ctx.db.insert("users", { name: "Asha", username: "asha", role: "cashier", tenantId, isActive: true });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: policy, creditLimit, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "ITM-1", name: "Sukari", sellingPrice: 10000, openingQty: 100, currentQty: 100, isActive: true });
    return { tenantId, mgr, cashier, clientId, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asMgr: as(ids.mgr, 1), asCashier: as(ids.cashier, 2) };
}

describe("credit limit", () => {
  it("block: a sale on credit beyond the limit is refused, inside the limit it passes", async () => {
    const { asMgr, clientId, productId } = await setup("block", 50000);
    await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 4, unitPrice: 10000 }] }); // owes 40,000
    await expect(asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 2, unitPrice: 10000 }] })).rejects.toThrow(/kikomo cha mkopo/);
  });

  it("require_approval: a cashier is refused, a manager may go over", async () => {
    const { asMgr, asCashier, clientId, productId } = await setup("require_approval", 10000);
    await expect(asCashier.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 2, unitPrice: 10000 }] })).rejects.toThrow(/idhini ya meneja/);
    const r = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 2, unitPrice: 10000 }] });
    expect(r.creditWarning).toBe(true);
  });

  it("warn: allowed but flagged; allow: never flagged", async () => {
    const warn = await setup("warn", 10000);
    expect((await warn.asMgr.mutation(api.sales.createInvoice, { clientId: warn.clientId, invoiceDate: date, lines: [{ productId: warn.productId, qty: 2, unitPrice: 10000 }] })).creditWarning).toBe(true);
    const open = await setup("allow", 10000);
    expect((await open.asMgr.mutation(api.sales.createInvoice, { clientId: open.clientId, invoiceDate: date, lines: [{ productId: open.productId, qty: 2, unitPrice: 10000 }] })).creditWarning).toBe(false);
  });

  it("block with no limit means no credit at all, but a fully paid sale is fine", async () => {
    const { asMgr, clientId, productId } = await setup("block");
    await expect(asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] })).rejects.toThrow(/kikomo cha mkopo/);
    const r = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }], paymentAmount: 10000, paymentMethod: "cash" });
    expect(r.outstanding).toBe(0);
  });
});

describe("cancel invoice", () => {
  it("returns stock, refunds the payment and removes the invoice from the registers; balanced ledger", async () => {
    const { t, asMgr, asCashier, clientId, productId } = await setup();
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 3, unitPrice: 10000 }] });
    await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, amount: 10000, paymentMethod: "cash" });
    await expect(asCashier.mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId })).rejects.toThrow(/huna ruhusa ya kufuta/);

    const r = await asMgr.mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId, reason: "kosa la bei" });
    expect(r.refunded).toBe(10000);
    await expect(asMgr.mutation(api.sales.voidInvoice, { invoiceId: inv.invoiceId })).rejects.toThrow(/tayari imebatilishwa/);
    await expect(asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, amount: 1000, paymentMethod: "cash" })).rejects.toThrow();

    const reg = await asMgr.query(api.sales.salesRegisters, { withLines: false });
    expect(reg.invoices).toHaveLength(0);
    expect(reg.payments).toHaveLength(0);
    expect(reg.totals).toMatchObject({ sales: 0, outstanding: 0, payments: 0 });

    await t.run(async (ctx) => {
      const p = await ctx.db.get("products", productId);
      expect(p?.currentQty).toBe(100);
      const entries = await ctx.db.query("journalEntries").collect();
      for (const e of entries) expect(Math.abs(e.totalDebit - e.totalCredit)).toBeLessThan(0.01);
      // the cash account nets to zero (10,000 in, 10,000 refunded)
      const lines = await ctx.db.query("journalLines").collect();
      const cash = (await ctx.db.query("accounts").collect()).find((a) => a.code === "1000");
      const net = lines.filter((l) => l.accountId === cash?._id).reduce((n, l) => n + l.debit - l.credit, 0);
      expect(net).toBe(0);
    });
  });
});

describe("closed periods", () => {
  it("a sale or payment dated inside a closed period is refused; an open period or another date is fine", async () => {
    const { t, tenantId, asMgr, clientId, productId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("financialPeriods", { tenantId, name: "Septemba", startDate: "2020-09-01", endDate: "2020-09-30", status: "closed" });
      await ctx.db.insert("financialPeriods", { tenantId, name: "Oktoba", startDate: "2020-10-01", endDate: "2020-10-31", status: "open" });
    });
    await expect(asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: "2020-09-15", lines: [{ productId, qty: 1, unitPrice: 10000 }] })).rejects.toThrow(/kimefungwa/);
    await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: "2020-10-15", lines: [{ productId, qty: 1, unitPrice: 10000 }] });
    await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] });
    // the refused sale left nothing behind (stock moved only for the two good invoices)
    const qty = await t.run(async (ctx) => (await ctx.db.get("products", productId))?.currentQty);
    expect(qty).toBe(98);
  });
});

describe("who may delete (cancel) an order", () => {
  it("a cashier cannot until the permission is given to the role or to that one user; taking it away blocks again", async () => {
    const { t, asMgr, asCashier, cashier, clientId, productId } = await setup();
    const mk = async () => (await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] })).invoiceId;

    // 1. Nobody but managers by default.
    await expect(asCashier.mutation(api.sales.voidInvoice, { invoiceId: await mk() })).rejects.toThrow(/huna ruhusa ya kufuta/);

    // 2. Given to ONE user directly (User Settings).
    await t.run(async (ctx) => { await ctx.db.patch("users", cashier, { extraPermissions: ["sales.void"] }); });
    await asCashier.mutation(api.sales.voidInvoice, { invoiceId: await mk() });
    await t.run(async (ctx) => { await ctx.db.patch("users", cashier, { extraPermissions: [] }); });
    await expect(asCashier.mutation(api.sales.voidInvoice, { invoiceId: await mk() })).rejects.toThrow(/huna ruhusa ya kufuta/);

    // 3. Given to the whole ROLE (Role Management).
    await t.run(async (ctx) => { await ctx.db.insert("roles", { name: "cashier", displayName: "Cashier", permissions: ["sales.manage", "sales.void"], isSystem: true }); });
    await asCashier.mutation(api.sales.voidInvoice, { invoiceId: await mk() });
  });

  it("the current-business query tells the screen whether the Cancel button should show", async () => {
    const { t, asMgr, asCashier, cashier } = await setup();
    expect((await asMgr.query(api.tenants.current, {}))?.canVoidInvoice).toBe(true);
    expect((await asCashier.query(api.tenants.current, {}))?.canVoidInvoice).toBe(false);
    await t.run(async (ctx) => { await ctx.db.patch("users", cashier, { extraPermissions: ["sales.void"] }); });
    expect((await asCashier.query(api.tenants.current, {}))?.canVoidInvoice).toBe(true);
  });
});
