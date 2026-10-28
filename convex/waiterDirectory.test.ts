import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const day = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const mk = async (code: string) => ctx.db.insert("tenants", { name: code, code, isActive: true, createdByToken: code, createdAt: now, modules: ["waiterOrders", "stock"] });
    const ta = await mk("A"), tb = await mk("B");
    const user = (tenantId: Id<"tenants">, username: string, role: string) => ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true });
    const cashierA = await user(ta, "cashA", "cashier"), waiterA = await user(ta, "asha", "waiter"), waiterA2 = await user(ta, "neema", "waitress");
    const cashierB = await user(tb, "cashB", "cashier"), waiterB = await user(tb, "baraka", "waiter");
    const clientId = await ctx.db.insert("clients", { tenantId: ta, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const inv = (createdBy: Id<"users">, no: string, total: number, paid: number, discount: number, status: "posted" | "cancelled") =>
      ctx.db.insert("invoices", { tenantId: ta, invoiceNo: no, invoiceDate: day, clientId, subtotal: total + discount, discount, taxAmount: 0, total, amountPaid: paid, outstanding: total - paid, paymentStatus: paid === total ? "paid" : paid > 0 ? "partial" : "unpaid", status, createdBy });
    const i1 = await inv(waiterA, "INV-1", 10000, 10000, 500, "posted");
    await inv(waiterA, "INV-2", 6000, 2000, 0, "posted");
    await inv(waiterA, "INV-3", 9999, 0, 0, "cancelled");
    await inv(waiterA2, "INV-4", 7777, 7777, 0, "posted");
    await ctx.db.insert("customerPayments", { tenantId: ta, paymentDate: day, clientId, invoiceId: i1, amount: 10000, paymentMethod: "cash", createdBy: cashierA });
    await ctx.db.insert("waiterOrders", { tenantId: ta, customerName: "X", waiterId: waiterA, waiterName: "asha", status: "pending", stockDeducted: false, lines: [], total: 0, createdAt: now, updatedAt: now });
    return { cashierA, waiterA, waiterA2, cashierB, waiterB };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asCashierA: as(ids.cashierA, 1), asWaiterA: as(ids.waiterA, 2), asCashierB: as(ids.cashierB, 3) };
}

describe("cashier waiter directory", () => {
  it("lists only the waiters of the caller's business and supports search", async () => {
    const { asCashierA, asCashierB } = await setup();
    expect((await asCashierA.query(api.waiterDirectory.list, {})).map((w) => w.username)).toEqual(["asha", "neema"]);
    expect((await asCashierA.query(api.waiterDirectory.list, { search: "nee" })).map((w) => w.username)).toEqual(["neema"]);
    expect((await asCashierB.query(api.waiterDirectory.list, {})).map((w) => w.username)).toEqual(["baraka"]);
  });

  it("summarises one waiter: posted only, discounts, payments by method, outstanding, orders", async () => {
    const { asCashierA, waiterA } = await setup();
    const s = await asCashierA.query(api.waiterDirectory.summary, { waiterId: waiterA, from: day, to: day });
    expect(s.invoices).toBe(2);
    expect(s.cancelledInvoices).toBe(1);
    expect(s.netSales).toBe(16000);
    expect(s.discounts).toBe(500);
    expect(s.customerOutstanding).toBe(4000);
    expect(s.creditSales).toBe(6000);
    expect(s.paymentsByMethod).toEqual({ cash: 10000 });
    expect(s.orders).toEqual({ pending: 1 });
  });

  it("refuses another business's waiter and refuses waiters themselves", async () => {
    const { asCashierA, asCashierB, asWaiterA, waiterA, waiterB } = await setup();
    await expect(asCashierB.query(api.waiterDirectory.summary, { waiterId: waiterA, from: day, to: day })).rejects.toThrow(/hayupo/);
    await expect(asCashierA.query(api.waiterDirectory.summary, { waiterId: waiterB, from: day, to: day })).rejects.toThrow(/hayupo/);
    await expect(asWaiterA.query(api.waiterDirectory.list, {})).rejects.toThrow();
  });
});

describe("waiter invoices and payment history", () => {
  it("lists a waiter's invoices with search, shows payments, and refuses other businesses", async () => {
    const { asCashierA, asCashierB, waiterA, t } = await setup();
    const all = await asCashierA.query(api.waiterDirectory.invoices, { waiterId: waiterA, from: day, to: day });
    expect(all.map((i) => i.invoiceNo).sort()).toEqual(["INV-1", "INV-2", "INV-3"]);
    const one = await asCashierA.query(api.waiterDirectory.invoices, { waiterId: waiterA, from: day, to: day, search: "inv-2" });
    expect(one.map((i) => i.invoiceNo)).toEqual(["INV-2"]);
    const inv1 = all.find((i) => i.invoiceNo === "INV-1")!;
    const pays = await asCashierA.query(api.waiterDirectory.invoicePayments, { invoiceId: inv1._id });
    expect(pays).toHaveLength(1);
    expect(pays[0].amount).toBe(10000);
    await expect(asCashierB.query(api.waiterDirectory.invoices, { waiterId: waiterA, from: day, to: day })).rejects.toThrow(/hayupo/);
    await expect(asCashierB.query(api.waiterDirectory.invoicePayments, { invoiceId: inv1._id })).rejects.toThrow(/haipo/);
    // viewing changes nothing
    const after = await t.run(async (ctx) => (await ctx.db.get("invoices", inv1._id))?.outstanding);
    expect(after).toBe(0);
  });
});
