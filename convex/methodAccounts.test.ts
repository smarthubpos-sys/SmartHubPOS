import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const date = new Date().toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "purchasing", "stock", "accounts", "payroll"] });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "ITM-1", name: "Sukari", sellingPrice: 10000, openingQty: 100, currentQty: 100, isActive: true } as any);
    const supplierId = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Acme Traders", openingBalance: 0, isActive: true });
    return { tenantId, mgr, clientId, productId, supplierId };
  });
  const asMgr = t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|1" });
  return { t, ...ids, asMgr };
}

/** debit - credit of every journal line, per account name. */
async function ledger(t: any) {
  return await t.run(async (ctx: any) => {
    const out: Record<string, { code: string; net: number }> = {};
    for (const l of await ctx.db.query("journalLines").collect()) {
      const a = await ctx.db.get(l.accountId);
      out[a.name] = { code: a.code, net: (out[a.name]?.net ?? 0) + l.debit - l.credit };
    }
    return out;
  });
}

describe("every payment goes to the account of its own payment method", () => {
  it("10,000 M-Pesa + 10,000 CRDB + 10,000 cash lands in three different accounts", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "M-Pesa 5551234", kind: "mobile", isActive: true });
    const bank = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 3, unitPrice: 10000 }] });
    await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [
      { method: "x", methodId: phone, amount: 10000 }, { method: "x", methodId: bank, amount: 10000 }, { method: "cash", amount: 10000 },
    ] });
    const l = await ledger(t);
    expect(l["M-Pesa 5551234"].net).toBe(10000);
    expect(l["CRDB"].net).toBe(10000);
    expect(l["Cash and equivalents"].net).toBe(10000);
    expect(l["Accounts receivable"].net).toBe(0);
    const codes = new Set([l["M-Pesa 5551234"].code, l["CRDB"].code, l["Cash and equivalents"].code]);
    expect(codes.size).toBe(3);
  });

  it("two banks get two separate accounts, and the account follows a renamed method", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const crdb = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    const nmb = await asMgr.mutation(api.paymentMethods.upsert, { name: "NMB", kind: "bank", isActive: true });
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 2, unitPrice: 10000 }] });
    await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [{ method: "x", methodId: crdb, amount: 5000 }, { method: "x", methodId: nmb, amount: 7000 }] });
    await asMgr.mutation(api.paymentMethods.upsert, { id: nmb, name: "NMB Biashara", kind: "bank", isActive: true });
    const l = await ledger(t);
    expect(l["CRDB"]).toMatchObject({ net: 5000 });
    expect(l["NMB Biashara"]).toMatchObject({ net: 7000 });
    expect(l["CRDB"].code).not.toBe(l["NMB Biashara"].code);
    const bal = await asMgr.query(api.paymentMethods.balances, {});
    expect(bal.find((b) => b.name === "CRDB")?.balance).toBe(5000);
    expect(bal.find((b) => b.name === "NMB Biashara")?.balance).toBe(7000);
  });

  it("payment made while creating the invoice goes to its method's account", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Lipa 1234", kind: "mobile", isActive: true });
    await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }], paymentAmount: 4000, paymentMethod: "x", paymentMethodId: phone });
    const l = await ledger(t);
    expect(l["Lipa 1234"].net).toBe(4000);
    expect(l["Cash and equivalents"]?.net ?? 0).toBe(0);
  });

  it("supplier payments and purchases paid on receipt are taken out of the method's account", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Lipa 1234", kind: "mobile", isActive: true });
    const bank = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, splits: [{ method: "x", methodId: bank, amount: 5000 }, { method: "x", methodId: phone, amount: 7000 }], lines: [{ productId, qty: 10, unitCost: 3000 }] });
    await asMgr.mutation(api.purchasing.recordSupplierPayment, { supplierId, paymentDate: date, splits: [{ method: "x", methodId: phone, amount: 3000 }, { method: "cash", amount: 2000 }] });
    const l = await ledger(t);
    expect(l["CRDB"].net).toBe(-5000);
    expect(l["Lipa 1234"].net).toBe(-10000);
    expect(l["Cash and equivalents"].net).toBe(-2000);
    expect(l["Accounts payable"].net).toBe(-13000); // 30,000 bought - 12,000 paid on receipt - 5,000 paid later
  });

  it("bill payment, capital received and payroll use the chosen method's account", async () => {
    const { t, asMgr } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Lipa 1234", kind: "mobile", isActive: true });
    const bank = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    await asMgr.mutation(api.capital.receive, { receiptDate: date, amount: 100000, sourceType: "owner_capital", sourceName: "Juma", depositMethod: "x", depositMethodId: bank });
    const billId = await asMgr.mutation(api.bills.create, { vendor: "TANESCO", category: "electricity", billDate: date, dueDate: date, amount: 40000 });
    await asMgr.mutation(api.bills.pay, { billId, amount: 40000, method: "x", methodId: phone, paymentDate: date });
    const l = await ledger(t);
    expect(l["CRDB"].net).toBe(100000);
    expect(l["Lipa 1234"].net).toBe(-40000);
  });

  it("repairs old payments that were all posted to Cash, and can be run twice", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Lipa 1234", kind: "mobile", isActive: true });
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] });
    await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [{ method: "x", methodId: phone, amount: 6000 }] });
    // simulate the old behaviour: the line sat on Cash
    await t.run(async (ctx) => {
      const cash = (await ctx.db.query("accounts").collect()).find((a) => a.code === "1000")!;
      const line = (await ctx.db.query("journalLines").collect()).find((x) => x.debit === 6000)!;
      await ctx.db.patch(line._id, { accountId: cash._id });
    });
    expect((await ledger(t))["Cash and equivalents"].net).toBe(6000);
    expect(await asMgr.mutation(api.paymentMethods.repairOldPayments, {})).toEqual({ moved: 1 });
    const l = await ledger(t);
    expect(l["Lipa 1234"].net).toBe(6000);
    expect(l["Cash and equivalents"]?.net ?? 0).toBe(0);
    expect(await asMgr.mutation(api.paymentMethods.repairOldPayments, {})).toEqual({ moved: 0 });
  });
});
