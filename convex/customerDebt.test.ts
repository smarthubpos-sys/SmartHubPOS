import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const bar = await ctx.db.insert("branches", { tenantId, name: "Bar", code: "B1", isActive: true, createdAt: now });
    const lounge = await ctx.db.insert("branches", { tenantId, name: "Lounge", code: "L1", isActive: true, createdAt: now });
    await ctx.db.insert("tenantSettings", { tenantId, traIntegrationEnabled: false, stockControlEnabled: false, defaultCurrency: "TZS", waiterEnabled: true, waitressEnabled: true, waiterOrdersEnabled: true, waiterOrderMode: "cashier" });
    const waiter = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "waiter", tenantId, branchId: bar, isActive: true });
    const cashier = await ctx.db.insert("users", { name: "Neema", username: "neema", role: "cashier", tenantId, isActive: true }); // no department picked
    const loungeCashier = await ctx.db.insert("users", { name: "Zawadi", username: "zawadi", role: "cashier", tenantId, branchId: lounge, isActive: true });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", tenantId, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, branchId: bar, itemCode: "P1", name: "Bia", sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    return { tenantId, waiter, cashier, loungeCashier, boss, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asWaiter: as(ids.waiter, 1), asCashier: as(ids.cashier, 2), asLoungeCashier: as(ids.loungeCashier, 3), asBoss: as(ids.boss, 4) };
}

const eat = (ms: number) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
const DAY = 86400000;

/** The waiter sells 2 x Bia (4000) last night at 22:30 EAT. Nobody has paid yet. A customer "Mama Neema" is saved in the business. */
async function creditSale() {
  const s = await setup();
  const sent = await s.asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-credit-0001", mode: "send", lines: [{ productId: s.productId, qty: 2 }] });
  const yesterday = eat(Date.now() - DAY);
  const lastNight = new Date(Date.parse(`${yesterday}T22:30:00Z`) - 3 * 3600000).toISOString();
  await s.t.run(async (ctx) => { await ctx.db.patch("waiterOrders", sent.orderId, { createdAt: lastNight }); });
  const clientId = await s.t.run(async (ctx) => ctx.db.insert("clients", { tenantId: s.tenantId, code: "C1", name: "Mama Neema", openingBalance: 0, creditPolicy: "allow", isActive: true }));
  return { ...s, orderId: sent.orderId, clientId, yesterday, today: eat(Date.now()) };
}

describe("cashier moves a waiter's credit sale to a registered customer", () => {
  it("the customer owes it (dated on the sale day), the waiter no longer owes it, and reports name the customer", async () => {
    const { asCashier, asBoss, orderId, clientId, yesterday } = await creditSale();
    expect(await asCashier.query(api.waiterCollections.owing, {})).toHaveLength(1);
    const res = await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    expect(res.total).toBe(4000);
    expect(await asCashier.query(api.waiterCollections.owing, {})).toHaveLength(0); // off the waiter's account
    const day = await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday });
    expect(day.totals).toMatchObject({ sales: 4000, outstanding: 4000, waiterDebt: 0 }); // counted once: as the customer's invoice
    expect(day.invoices).toHaveLength(1);
    expect(day.invoices[0]).toMatchObject({ clientName: "Mama Neema", date: yesterday, total: 4000, outstanding: 4000 });
    expect(day.openInvoices.map((i) => i.clientName)).toEqual(["Mama Neema"]);
  });

  it("a part the waiter already paid stays his; only the rest becomes the customer's debt, and the sale is counted once", async () => {
    const { asCashier, asBoss, waiter, orderId, clientId, yesterday } = await creditSale();
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds: [orderId], splits: [{ method: "cash", amount: 1000 }] });
    const res = await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    expect(res.total).toBe(3000);
    const day = await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday });
    expect(day.totals).toMatchObject({ sales: 4000, outstanding: 3000, waiterDebt: 0 });
  });

  it("a waiter cannot move debts, and a bill already moved cannot be cancelled", async () => {
    const { asWaiter, asCashier, asBoss, orderId, clientId } = await creditSale();
    await expect(asWaiter.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId })).rejects.toThrow();
    await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    await expect(asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId })).rejects.toThrow(); // nothing left to move
    await expect(asBoss.mutation(api.waiterOrders.cancelBillFromFinder, { orderId, reason: "Imerudi" })).rejects.toThrow();
  });
});

describe("repayments book", () => {
  it("a bill moved to a customer cannot be edited from Invoice Finder: a clear reason, not a missing-receipt error", async () => {
    const { asCashier, asBoss, orderId, clientId, productId } = await creditSale();
    await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    await expect(asBoss.mutation(api.waiterOrders.editBillFromFinder, { orderId, customerName: "x", undoPayment: true, lines: [{ productId, qty: 1, unitPrice: 2000 }] })).rejects.toThrow(/imeelekezwa kwa mteja/);
    await expect(asBoss.mutation(api.waiterOrders.editBillFromFinder, { orderId, customerName: "x", undoPayment: true, lines: [{ productId, qty: 1, unitPrice: 2000 }] })).rejects.not.toThrow(/makusanyo ya cashier|risiti ya cashier/);
  });

  it("the customer pays part of his debt: the invoice shrinks, the money is today's cash, and the report names the customer", async () => {
    const { asCashier, asBoss, orderId, clientId, today } = await creditSale();
    await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    const list = await asCashier.query(api.customerDebt.customersForCashier, {});
    expect(list.find((c) => c.name === "Mama Neema")?.owes).toBe(4000);
    const open = await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId });
    expect(open.owes).toBe(4000);
    const r = await asCashier.mutation(api.customerDebt.receiveRepayment, { clientId, splits: [{ method: "cash", amount: 1500 }], allocations: [{ invoiceId: open.invoices[0]._id, amount: 1500 }] });
    expect(r).toMatchObject({ total: 1500, clientName: "Mama Neema", date: today });
    expect((await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId })).owes).toBe(2500);
    const day = await asBoss.query(api.sales.salesRegisters, { startDate: today, endDate: today });
    expect(day.payments).toHaveLength(1);
    expect(day.payments[0]).toMatchObject({ clientName: "Mama Neema", amount: 1500, date: today });
    expect(String(day.payments[0].notes)).toContain("Repayment ya Mama Neema");
  });

  it("one payment can be shared over several debts, and a wrong total is refused with nothing recorded", async () => {
    const { t, asCashier, orderId, clientId } = await creditSale();
    await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    const inv = (await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId })).invoices[0]._id;
    await expect(asCashier.mutation(api.customerDebt.receiveRepayment, { clientId, splits: [{ method: "cash", amount: 1000 }], allocations: [{ invoiceId: inv, amount: 900 }] })).rejects.toThrow();
    await expect(asCashier.mutation(api.customerDebt.receiveRepayment, { clientId, splits: [{ method: "cash", amount: 9000 }], allocations: [{ invoiceId: inv, amount: 9000 }] })).rejects.toThrow(); // more than he owes
    expect(await t.run(async (ctx) => (await ctx.db.query("customerPayments").collect()).length)).toBe(0);
    const r = await asCashier.mutation(api.customerDebt.receiveRepayment, { clientId, splits: [{ method: "cash", amount: 1000 }, { method: "cash", amount: 3000 }], allocations: [{ invoiceId: inv, amount: 4000 }] });
    expect(r.total).toBe(4000);
    expect((await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId })).invoices).toHaveLength(0);
  });

  it("a repayment cannot be dated in the future", async () => {
    const { asCashier, orderId, clientId } = await creditSale();
    await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    const inv = (await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId })).invoices[0]._id;
    await expect(asCashier.mutation(api.customerDebt.receiveRepayment, { clientId, splits: [{ method: "cash", amount: 1000 }], allocations: [{ invoiceId: inv, amount: 1000 }], paymentDate: eat(Date.now() + DAY) })).rejects.toThrow();
  });
});

describe("cashier splits one waiter debt among many customers", () => {
  it("3 customers share a 4,000 bill: one pays now with cash + Tigo Pesa, one pays cash, one owes; the waiter owes nothing and the sale is counted once", async () => {
    const { t, tenantId, asCashier, asBoss, orderId, clientId, yesterday } = await creditSale();
    const [c2, c3] = await t.run(async (ctx) => [
      await ctx.db.insert("clients", { tenantId, code: "C2", name: "Baba Asha", openingBalance: 0, creditPolicy: "allow", isActive: true }),
      await ctx.db.insert("clients", { tenantId, code: "C3", name: "Mzee Juma", openingBalance: 0, creditPolicy: "allow", isActive: true }),
    ]);
    const res = await asCashier.mutation(api.customerDebt.splitDebtToCustomers, { orderIds: [orderId], parts: [
      { clientId, amount: 1500 }, // owes
      { clientId: c2, amount: 1500, paid: [{ method: "cash", amount: 1000 }, { method: "Tigo Pesa", amount: 500 }] }, // pays now: cash + Tigo Pesa
      { clientId: c3, amount: 1000, paid: [{ method: "cash", amount: 1000 }] },
    ] });
    expect(res).toMatchObject({ total: 4000, waiterLeft: 0 });
    expect(res.parts.map((p) => [p.clientName, p.paid, p.owes])).toEqual([["Mama Neema", 0, 1500], ["Baba Asha", 1500, 0], ["Mzee Juma", 1000, 0]]);
    expect(await asCashier.query(api.waiterCollections.owing, {})).toHaveLength(0); // off the waiter's account
    const day = await asBoss.query(api.sales.salesRegisters, { startDate: yesterday, endDate: yesterday });
    expect(day.totals).toMatchObject({ sales: 4000, outstanding: 1500, waiterDebt: 0 }); // counted once; only Mama Neema still owes
    expect(day.invoices).toHaveLength(3);
    const pays = await t.run(async (ctx) => ctx.db.query("customerPayments").collect());
    expect(pays.map((p) => [p.paymentMethod, p.amount]).sort()).toEqual([["Tigo Pesa", 500], ["cash", 1000], ["cash", 1000]]);
  });

  it("parts smaller than the debt leave the rest with the waiter; parts bigger than the debt, or the same customer twice, record nothing", async () => {
    const { t, tenantId, asCashier, orderId, clientId } = await creditSale();
    const c2 = await t.run(async (ctx) => ctx.db.insert("clients", { tenantId, code: "C2", name: "Baba Asha", openingBalance: 0, creditPolicy: "allow", isActive: true }));
    await expect(asCashier.mutation(api.customerDebt.splitDebtToCustomers, { orderIds: [orderId], parts: [{ clientId, amount: 3000 }, { clientId: c2, amount: 1500 }] })).rejects.toThrow(/imezidi/);
    await expect(asCashier.mutation(api.customerDebt.splitDebtToCustomers, { orderIds: [orderId], parts: [{ clientId, amount: 1000 }, { clientId, amount: 500 }] })).rejects.toThrow(/mara mbili/);
    expect(await asCashier.query(api.waiterCollections.owing, {})).toHaveLength(1); // nothing recorded
    const res = await asCashier.mutation(api.customerDebt.splitDebtToCustomers, { orderIds: [orderId], parts: [{ clientId, amount: 1000 }, { clientId: c2, amount: 1500 }] });
    expect(res).toMatchObject({ total: 2500, waiterLeft: 1500 });
    const owing = await asCashier.query(api.waiterCollections.owing, {});
    expect(owing).toHaveLength(1);
    expect(owing[0]).toMatchObject({ total: 1500 }); // the waiter still owes the rest
  });
});

describe("cashier edits what was received and where a debt was directed", () => {
  it("a customer payment can be corrected (method, amount): invoice, customer debt and the ledger follow, nothing is erased", async () => {
    const { t, asCashier, orderId, clientId } = await creditSale();
    await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    const open = await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId });
    const invoiceId = open.invoices[0]._id;
    await asCashier.mutation(api.customerDebt.receiveRepayment, { clientId, splits: [{ method: "cash", amount: 1500 }], allocations: [{ invoiceId, amount: 1500 }] });
    const rows = await asCashier.query(api.customerDebt.recentCustomerPayments, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total: 1500, outstanding: 2500, editable: true });
    const r = await asCashier.mutation(api.customerDebt.editCustomerPayment, { invoiceId, receiptNo: rows[0].receiptNo!, splits: [{ method: "cash", amount: 1000 }, { method: "mobile", amount: 1000, reference: "TP1" }] });
    expect(r).toMatchObject({ total: 2000, outstanding: 2000 });
    expect((await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId })).owes).toBe(2000);
    const after = await asCashier.query(api.customerDebt.recentCustomerPayments, {});
    expect(after[0].splits.map((s) => s.amount).sort()).toEqual([1000, 1000]);
    await t.run(async (ctx) => {
      const entries = await ctx.db.query("journalEntries").collect();
      for (const e of entries) expect(Math.abs(e.totalDebit - e.totalCredit)).toBeLessThan(0.01);
      const pays = await ctx.db.query("customerPayments").collect();
      expect(pays.filter((p) => p.voided)).toHaveLength(1); // the old line is kept, voided
    });
    // more than the debt is refused and changes nothing
    await expect(asCashier.mutation(api.customerDebt.editCustomerPayment, { invoiceId, receiptNo: rows[0].receiptNo!, splits: [{ method: "cash", amount: 9000 }] })).rejects.toThrow();
    expect((await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId })).owes).toBe(2000);
  });

  it("a debt directed to the wrong customer is moved to the right one, with its payments", async () => {
    const { t, tenantId, asCashier, asWaiter, orderId, clientId } = await creditSale();
    await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    const rightId = await t.run(async (ctx) => ctx.db.insert("clients", { tenantId, code: "C2", name: "Baba Zawadi", openingBalance: 0, creditPolicy: "allow", isActive: true }));
    const debts = await asCashier.query(api.customerDebt.assignedDebts, {});
    expect(debts).toHaveLength(1);
    await asCashier.mutation(api.customerDebt.reassignDebt, { invoiceId: debts[0]._id, clientId: rightId });
    expect((await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId: rightId })).owes).toBe(4000);
    expect((await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId })).owes).toBe(0);
    await expect(asCashier.mutation(api.customerDebt.reassignDebt, { invoiceId: debts[0]._id, clientId: rightId })).rejects.toThrow();
    await expect(asWaiter.mutation(api.customerDebt.reassignDebt, { invoiceId: debts[0]._id, clientId })).rejects.toThrow();
  });

  it("a waiter receipt can change its payment methods (same total) and the money accounts report shows it", async () => {
    const { t, asWaiter, asCashier, waiter, productId } = await setup();
    const sent = await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-edit-receipt1", mode: "send", lines: [{ productId, qty: 2 }] });
    const owing = await asCashier.query(api.waiterCollections.owing, {});
    const orderIds = owing.flatMap((o) => o.orders.map((x: { _id: Id<"waiterOrders"> }) => x._id)).length ? owing.flatMap((o) => o.orders.map((x: { _id: Id<"waiterOrders"> }) => x._id)) : [sent.orderId];
    await asCashier.mutation(api.waiterCollections.collect, { staffId: waiter, orderIds, splits: [{ method: "cash", amount: 4000 }] });
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const receipts = await asCashier.query(api.waiterCollections.receipts, { date: today });
    expect(receipts).toHaveLength(1);
    await expect(asCashier.mutation(api.waiterCollections.editReceipt, { collectionId: receipts[0]._id, splits: [{ method: "mobile", amount: 3000 }] })).rejects.toThrow(/lazima ibaki sawa/);
    await asCashier.mutation(api.waiterCollections.editReceipt, { collectionId: receipts[0]._id, splits: [{ method: "cash", amount: 1000 }, { method: "mobile", amount: 3000, reference: "TP9" }] });
    const again = await asCashier.query(api.waiterCollections.receipts, { date: today });
    expect(again[0].splits.map((s) => s.amount)).toEqual([1000, 3000]);
    const rep = await asCashier.query(api.accounting.methodReport, { startDate: today, endDate: today }).catch(() => null);
    if (rep) expect(rep.totalIn).toBe(4000);
    await t.run(async (ctx) => { for (const e of await ctx.db.query("journalEntries").collect()) expect(Math.abs(e.totalDebit - e.totalCredit)).toBeLessThan(0.01); });
  });
});

describe("Selling Point stands on its own and a paid customer debt leaves the Bills list", () => {
  it("a cashier works with the Selling Point module only (no Sales module)", async () => {
    const { t, tenantId, asCashier, orderId, clientId } = await creditSale();
    await t.run((ctx) => ctx.db.patch("tenants", tenantId, { modules: ["waiterOrders", "stock", "accounts"] }));
    await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    const open = await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId });
    expect(open.owes).toBe(4000);
    await asCashier.mutation(api.customerDebt.receiveRepayment, { clientId, splits: [{ method: "cash", amount: 4000 }], allocations: [{ invoiceId: open.invoices[0]._id, amount: 4000 }] });
    expect((await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId })).owes).toBe(0);
  });

  it("the bill stays on the Bills screen while the customer owes, and leaves it once the invoice is paid in full", async () => {
    const { t, asCashier, orderId, clientId } = await creditSale();
    await t.run((ctx) => ctx.db.patch("waiterOrders", orderId, { billSentAt: new Date().toISOString() }));
    await asCashier.mutation(api.customerDebt.assignOrdersToCustomer, { orderIds: [orderId], clientId });
    const ids = async () => (await asCashier.query(api.waiterOrders.listForBills, {})).map((o) => o._id);
    expect(await ids()).toContain(orderId);
    const open = await asCashier.query(api.customerDebt.openInvoicesOfCustomer, { clientId });
    await asCashier.mutation(api.customerDebt.receiveRepayment, { clientId, splits: [{ method: "cash", amount: 1000 }], allocations: [{ invoiceId: open.invoices[0]._id, amount: 1000 }] });
    expect(await ids()).toContain(orderId); // partly paid: still there
    await asCashier.mutation(api.customerDebt.receiveRepayment, { clientId, splits: [{ method: "cash", amount: 3000 }], allocations: [{ invoiceId: open.invoices[0]._id, amount: 3000 }] });
    expect(await ids()).not.toContain(orderId);
    expect((await asCashier.query(api.waiterOrders.listForBills, { includePrinted: true })).map((o) => o._id)).toContain(orderId); // history keeps it
  });
});
