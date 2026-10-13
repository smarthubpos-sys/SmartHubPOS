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
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "purchasing", "stock"] });
    const other = await ctx.db.insert("tenants", { name: "Other", code: "OT", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "purchasing"] });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
    const cashier = await ctx.db.insert("users", { name: "Asha", username: "asha", role: "cashier", tenantId, isActive: true });
    const otherMgr = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "admin", tenantId: other, isActive: true });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "ITM-1", name: "Sukari", sellingPrice: 10000, openingQty: 100, currentQty: 100, isActive: true } as any);
    const supplierId = await ctx.db.insert("suppliers", { tenantId, code: "S1", name: "Acme Traders", openingBalance: 0, isActive: true });
    return { tenantId, mgr, cashier, otherMgr, clientId, productId, supplierId };
  });
  const as = (id: any, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asMgr: as(ids.mgr, 1), asCashier: as(ids.cashier, 2), asOther: as(ids.otherMgr, 3) };
}

describe("payment methods", () => {
  it("a business adds several lipa namba / banks, edits them, and cannot repeat a name", async () => {
    const { asMgr, asCashier } = await setup();
    await asMgr.mutation(api.paymentMethods.upsert, { name: "M-Pesa 5551234", kind: "mobile", accountNo: "5551234", isActive: true });
    await asMgr.mutation(api.paymentMethods.upsert, { name: "Tigo Pesa 5559999", kind: "mobile", accountNo: "5559999", isActive: true });
    const crdb = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", accountNo: "0150123", isActive: true });
    await asMgr.mutation(api.paymentMethods.upsert, { name: "NMB", kind: "bank", isActive: true });
    await expect(asMgr.mutation(api.paymentMethods.upsert, { name: "crdb", kind: "bank", isActive: true })).rejects.toThrow(/tayari ipo/);
    await asMgr.mutation(api.paymentMethods.upsert, { id: crdb, name: "CRDB Biashara", kind: "bank", accountNo: "0150999", isActive: true });
    const rows = await asMgr.query(api.paymentMethods.list, {});
    expect(rows.map((r) => r.name)).toEqual(["M-Pesa 5551234", "Tigo Pesa 5559999", "CRDB Biashara", "NMB"]);
    await asMgr.mutation(api.paymentMethods.move, { id: crdb, direction: -1 });
    expect((await asMgr.query(api.paymentMethods.list, {})).map((r) => r.name)[1]).toBe("CRDB Biashara");
    await expect(asCashier.mutation(api.paymentMethods.upsert, { name: "Hack", kind: "cash", isActive: true })).rejects.toThrow(/manager/);
  });

  it("methods of one business are invisible to another", async () => {
    const { asMgr, asOther } = await setup();
    await asMgr.mutation(api.paymentMethods.upsert, { name: "M-Pesa", kind: "mobile", isActive: true });
    expect(await asOther.query(api.paymentMethods.list, {})).toEqual([]);
  });

  it("seeds Cash / Bank / Mobile Money once", async () => {
    const { asMgr } = await setup();
    expect(await asMgr.mutation(api.paymentMethods.seedDefaults, {})).toBe(3);
    expect(await asMgr.mutation(api.paymentMethods.seedDefaults, {})).toBe(0);
  });
});

describe("one receipt, several payment methods", () => {
  it("customer owing 30,000 pays 10,000 phone + 10,000 bank + 10,000 cash on one invoice", async () => {
    const { t, asMgr, clientId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "M-Pesa 5551234", kind: "mobile", isActive: true });
    const bank = await asMgr.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 3, unitPrice: 10000 }] });
    expect(inv.outstanding).toBe(30000);

    const r = await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [
      { method: "x", methodId: phone, amount: 10000, reference: "MP123" },
      { method: "x", methodId: bank, amount: 10000, reference: "TRX9" },
      { method: "cash", amount: 10000 },
    ] });
    expect(r).toMatchObject({ amountPaid: 30000, outstanding: 0, amount: 30000 });
    expect(r.splits.map((s) => s.method)).toEqual(["M-Pesa 5551234", "CRDB", "cash"]);

    const { pays, invoice, journals } = await t.run(async (ctx) => ({
      pays: await ctx.db.query("customerPayments").collect(), invoice: await ctx.db.get(inv.invoiceId), journals: await ctx.db.query("journalEntries").collect(),
    }));
    expect(invoice).toMatchObject({ paymentStatus: "paid", outstanding: 0, amountPaid: 30000 });
    expect(pays).toHaveLength(3);
    expect(new Set(pays.map((p) => p.receiptNo)).size).toBe(1);
    expect(pays.map((p) => p.amount)).toEqual([10000, 10000, 10000]);
    expect(journals.filter((j) => j.sourceType === "payment")).toHaveLength(3);

    const reg = await asMgr.query(api.sales.salesRegisters, { startDate: date, endDate: date });
    expect(reg.payments.map((p) => p.method).sort()).toEqual(["CRDB", "M-Pesa 5551234", "cash"]);
    expect(reg.totals.payments).toBe(30000);
  });

  it("rejects totals above the debt, empty amounts, switched-off methods and a method of another business", async () => {
    const { asMgr, asOther, clientId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Tigo", kind: "mobile", isActive: true });
    const off = await asMgr.mutation(api.paymentMethods.upsert, { name: "Old", kind: "bank", isActive: false });
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] });
    await expect(asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [{ method: "cash", amount: 6000 }, { method: "cash", amount: 6000 }] })).rejects.toThrow(/yasizidi deni/);
    await expect(asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [{ method: "cash", amount: 0 }] })).rejects.toThrow(/kikubwa kuliko sifuri/);
    await expect(asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [{ method: "x", methodId: off, amount: 100 }] })).rejects.toThrow(/imezimwa/);
    await expect(asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [{ method: "cash", amount: 100, reference: "A" }, { method: "x", methodId: phone, amount: 100, reference: "A" }] })).rejects.toThrow(/mara mbili/);
    await expect(asOther.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, paymentDate: date, splits: [{ method: "x", methodId: phone, amount: 100 }] })).rejects.toThrow();
    // nothing was saved by any of the rejected attempts
    const reg = await asMgr.query(api.sales.salesRegisters, { startDate: date, endDate: date });
    expect(reg.payments).toHaveLength(0);
  });

  it("the old single amount + method call still works", async () => {
    const { asMgr, clientId, productId } = await setup();
    const inv = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 1, unitPrice: 10000 }] });
    const r = await asMgr.mutation(api.sales.recordPayment, { invoiceId: inv.invoiceId, amount: 4000, paymentDate: date, paymentMethod: "bank" });
    expect(r).toMatchObject({ amountPaid: 4000, outstanding: 6000 });
  });

  it("supplier payment can be split too and settles the oldest purchase first", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    const phone = await asMgr.mutation(api.paymentMethods.upsert, { name: "Lipa 1234", kind: "mobile", isActive: true });
    const p = await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, lines: [{ productId, qty: 10, unitCost: 3000 }] });
    expect(p.outstanding).toBe(30000);
    const r = await asMgr.mutation(api.purchasing.recordSupplierPayment, { supplierId, paymentDate: date, splits: [{ method: "x", methodId: phone, amount: 12000 }, { method: "cash", amount: 8000 }] });
    expect(r).toMatchObject({ amount: 20000, allocated: 20000, supplierCredit: 0 });
    const rows = await t.run(async (ctx) => ({ pays: await ctx.db.query("supplierPayments").collect(), purchase: await ctx.db.get(p.purchaseId) }));
    expect(rows.pays.map((x) => x.paymentMethod)).toEqual(["Lipa 1234", "cash"]);
    expect(new Set(rows.pays.map((x) => x.receiptNo)).size).toBe(1);
    expect(rows.purchase).toMatchObject({ amountPaid: 20000, outstanding: 10000, paymentStatus: "partial" });
  });

  it("a purchase can be paid at receiving time through several methods", async () => {
    const { t, asMgr, supplierId, productId } = await setup();
    const p = await asMgr.mutation(api.purchasing.receivePurchase, { supplierId, purchaseDate: date, splits: [{ method: "cash", amount: 5000 }, { method: "bank", amount: 7000 }], lines: [{ productId, qty: 10, unitCost: 3000 }] });
    expect(p).toMatchObject({ amountPaid: 12000, outstanding: 18000 });
    expect(await t.run((ctx) => ctx.db.query("supplierPayments").collect())).toHaveLength(2);
  });
});
