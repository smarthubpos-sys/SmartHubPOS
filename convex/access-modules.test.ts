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
    // A business on the small plan: only Sales + Bills (+ the always-on Dashboard / Help).
    const tenantId = await ctx.db.insert("tenants", { name: "Basic Bar", code: "BB", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "bills"] });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true }); // admin: may manage users
    const w1 = await ctx.db.insert("users", { name: "Asha", username: "asha", role: "cashier", tenantId, isActive: true, ownDataOnly: true });
    const w2 = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "cashier", tenantId, isActive: true, ownDataOnly: true });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "ITM-1", name: "Bia", sellingPrice: 2000, openingQty: 100, currentQty: 100, isActive: true });
    return { tenantId, mgr, w1, w2, clientId, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asMgr: as(ids.mgr, 1), asW1: as(ids.w1, 2), asW2: as(ids.w2, 3) };
}

describe("modules a business has paid for", () => {
  it("blocks modules the business does not have, on the server", async () => {
    const { asMgr } = await setup();
    await expect(asMgr.query(api.payroll.listEmployees, {})).rejects.toThrow(/module not available/);
    await expect(asMgr.query(api.accounting.listAccounts, {})).rejects.toThrow(/module not available/);
    expect(await asMgr.query(api.sales.listInvoices, {})).toEqual([]);
    const cur = await asMgr.query(api.tenants.current, {});
    expect(cur?.modules).toEqual(["dashboard", "sales", "bills", "help"]);
  });

  it("a manager can limit one user further, but only inside what the business has", async () => {
    const { asMgr, asW1, w1 } = await setup();
    await asMgr.mutation(api.maintenance.updateUser, { userId: w1, menuAccess: ["sales", "stock", "payroll"] });
    expect((await asW1.query(api.tenants.current, {}))?.modules).toEqual(["dashboard", "sales", "help"]);
    await expect(asW1.query(api.customerBills.access, {})).rejects.toThrow(/module not available/);
  });
});

describe("staff see only their own sales and bills", () => {
  it("filters invoices, bills and payments by creator, and keeps the manager's full view", async () => {
    const { t, asMgr, asW1, asW2, tenantId, clientId, w1, w2 } = await setup();
    const [i1, i2] = await t.run(async (ctx) => {
      const mk = (no: string, by: Id<"users">, total: number) => ctx.db.insert("invoices", { tenantId, invoiceNo: no, invoiceDate: date, clientId, subtotal: total, discount: 0, taxAmount: 0, total, amountPaid: 0, outstanding: total, paymentStatus: "unpaid", status: "posted", createdBy: by, salespersonId: by });
      return [await mk("INV-1", w1, 4000), await mk("INV-2", w2, 6000)];
    });
    expect((await asW1.query(api.sales.listInvoices, {})).map((i) => i.invoiceNo)).toEqual(["INV-1"]);
    expect((await asW2.query(api.sales.listInvoices, {})).map((i) => i.invoiceNo)).toEqual(["INV-2"]);
    expect(await asMgr.query(api.sales.listInvoices, {})).toHaveLength(2);
    expect((await asW1.query(api.customerBills.invoicesForClient, { clientId })).map((i) => i.invoiceNo)).toEqual(["INV-1"]);
    await expect(asW1.query(api.customerBills.billData, { invoiceIds: [i2] })).rejects.toThrow(/haipatikani/);
    await expect(asW1.mutation(api.sales.recordPayment, { invoiceId: i2, amount: 100, paymentDate: date, paymentMethod: "cash" })).rejects.toThrow(/haipatikani/);
    expect((await asW1.query(api.customerBills.billData, { invoiceIds: [i1] })).totals.total).toBe(4000);
  });

  it("has a personal dashboard and cannot open the business dashboard", async () => {
    const { t, asW1, asMgr, tenantId, clientId, w1, w2 } = await setup();
    await t.run(async (ctx) => {
      const mk = (no: string, by: Id<"users">, total: number, paid: number) => ctx.db.insert("invoices", { tenantId, invoiceNo: no, invoiceDate: date, clientId, subtotal: total, discount: 0, taxAmount: 0, total, amountPaid: paid, outstanding: total - paid, paymentStatus: paid ? "partial" : "unpaid", status: "posted", createdBy: by, salespersonId: by });
      await mk("INV-1", w1, 4000, 1000); await mk("INV-2", w2, 6000, 0);
    });
    const mine = await asW1.query(api.dashboard.getMyDashboard, { from: date, today: date });
    expect(mine.today).toEqual({ sales: 4000, collected: 1000, outstanding: 3000, invoices: 1 });
    expect(mine.openBills).toBe(1);
    await expect(asW1.query(api.dashboard.getMetrics, { date })).rejects.toThrow(/personal dashboard/);
    expect((await asMgr.query(api.tenants.current, {}))?.ownDataOnly).toBe(false);
    expect((await asW1.query(api.tenants.current, {}))?.ownDataOnly).toBe(true);
  });
});

describe("dashboard roll-ups", () => {
  it("are kept exact by sales and payments, and the dashboard reads only them", async () => {
    const { t, asMgr, tenantId, clientId, productId } = await setup();
    // A business that was already initialised by the first rebuild.
    await t.run((ctx) => ctx.db.insert("statsTotals", { tenantId, receivable: 0, payable: 0, productCount: 1, lowStock: 0, outOfStock: 0, inventoryValue: 0, billsDue: 0, topD7: [], topD30: [], topD90: [], refreshedAt: Date.now() }));
    const r = await asMgr.mutation(api.sales.createInvoice, { clientId, invoiceDate: date, lines: [{ productId, qty: 3, unitPrice: 2000 }], paymentAmount: 1000, paymentMethod: "cash" });
    let m = await asMgr.query(api.dashboard.getMetrics, { date });
    expect(m).toMatchObject({ ready: true, todaySales: 6000, todayCash: 1000, totalOutstandingCustomer: 5000 });
    await asMgr.mutation(api.sales.recordPayment, { invoiceId: r.invoiceId, amount: 2000, paymentDate: date, paymentMethod: "cash" });
    m = await asMgr.query(api.dashboard.getMetrics, { date });
    expect(m).toMatchObject({ todaySales: 6000, todayCash: 3000, totalOutstandingCustomer: 3000 });
    const c = await asMgr.query(api.dashboard.getCharts, { from: date, today: date });
    expect(c.daily).toEqual([{ date, sales: 6000, purchases: 0, collected: 3000, invoices: 1 }]);
    expect(c.receivable).toBe(3000);
  });

  it("report not ready (instead of wrong zeros) for a business with no roll-ups yet", async () => {
    const { asMgr } = await setup();
    expect((await asMgr.query(api.dashboard.getMetrics, { date })).ready).toBe(false);
  });
});

describe("edit business", () => {
  it("lets the Super Admin rename a business and choose its modules; others cannot", async () => {
    const { t, asMgr, tenantId } = await setup();
    const adminId = await t.run((ctx) => ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true }));
    const asAdmin = t.withIdentity({ subject: adminId, tokenIdentifier: "x|9" });
    await expect(asMgr.mutation(api.tenants.update, { tenantId, name: "X", code: "X", currency: "TZS" })).rejects.toThrow(/Super Admin/);
    await asAdmin.mutation(api.tenants.update, { tenantId, name: "Bar Mpya", code: "bm", currency: "kes", modules: ["sales", "stock"] });
    const e = await asAdmin.query(api.tenants.getEditable, { tenantId });
    expect(e).toMatchObject({ name: "Bar Mpya", code: "BM", currency: "KES", modules: ["dashboard", "sales", "stock", "help"] });
    await asAdmin.mutation(api.tenants.update, { tenantId, name: "Bar Mpya", code: "BM", currency: "KES", allModules: true });
    expect((await asAdmin.query(api.tenants.getEditable, { tenantId }))?.modules).toBeNull();
  });
});

describe("super admin alerts", () => {
  it("reports ended subscriptions, suspended businesses and failed actions, and totals per business", async () => {
    const { t, tenantId } = await setup();
    const adminId = await t.run((ctx) => ctx.db.insert("users", { name: "Boss", username: "boss2", role: "super_admin", isActive: true }));
    const asAdmin = t.withIdentity({ subject: adminId, tokenIdentifier: "x|10" });
    await t.run(async (ctx) => {
      await ctx.db.patch("tenants", tenantId, { plan: "paid", planEndsAt: "2020-01-01", isActive: false });
      await ctx.db.insert("subscriptionPayments", { tenantId, amount: 50000, months: 1, startsAt: "2019-12-01", endsAt: "2020-01-01", createdAt: new Date().toISOString() });
      await ctx.db.insert("auditLogs", { tenantId, userName: "x", action: "sale", module: "sales", timestamp: new Date().toISOString(), result: "failure" });
    });
    const s = await asAdmin.query(api.subscriptions.dashboardSummary, {});
    expect(s.alerts.map((a) => a.code).sort()).toEqual(["expired", "failures", "suspended"]);
    expect(s.alerts[0].level).toBe("danger");
    expect(s.paidByTenant[String(tenantId)]).toBe(50000);
  });
});
