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
