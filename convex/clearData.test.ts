import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { TestConvex } from "convex-test";
import { modules } from "./tes.setup";
import { CLEAR_CATEGORIES } from "./maintenance";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantA = await ctx.db.insert("tenants", { name: "Shop A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const tenantB = await ctx.db.insert("tenants", { name: "Shop B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const superId = await ctx.db.insert("users", { name: "Super", username: "super", role: "super_admin", tenantId: tenantA, isActive: true });
    const mgrId = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId: tenantA, isActive: true });
    const seed = async (tenantId: typeof tenantA, tag: string) => {
      const clientId = await ctx.db.insert("clients", { tenantId, code: `C-${tag}`, name: `Client ${tag}`, openingBalance: 0, creditPolicy: "allow", isActive: true });
      const productId = await ctx.db.insert("products", { tenantId, itemCode: `P-${tag}`, name: `Prod ${tag}`, openingQty: 5, currentQty: 5, sellingPrice: 100, isActive: true });
      const invoiceId = await ctx.db.insert("invoices", { tenantId, invoiceNo: `INV-${tag}`, invoiceDate: "2026-10-01", clientId, subtotal: 100, discount: 0, taxAmount: 0, total: 100, amountPaid: 0, outstanding: 100, paymentStatus: "unpaid", status: "posted", createdBy: superId });
      await ctx.db.insert("invoiceLines", { invoiceId, productId, qty: 1, qtyStr: "1", unitPrice: 100, unitPriceStr: "100", lineTotal: 100, lineTotalStr: "100", costAtSale: 50, discount: 0 });
      await ctx.db.insert("customerPayments", { tenantId, paymentDate: "2026-10-01", clientId, invoiceId, amount: 10, paymentMethod: "cash", createdBy: superId });
      return { clientId, productId, invoiceId };
    };
    return { tenantA, tenantB, superId, mgrId, a: await seed(tenantA, "A"), b: await seed(tenantB, "B") };
  });
  return { t, ...ids };
}

async function runCategory(t: TestConvex<typeof schema>, actorId: Id<"users">, tenantId: Id<"tenants">, category: string, steps: number) {
  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < 20; i++) {
      const r = await t.mutation(internal.maintenance.clearStepBatch, { actorId, tenantId, category, step });
      if (r.done) break;
    }
  }
}

describe("Maintenance > Clear Data File", () => {
  it("clears sales invoices (with lines and payments) of the chosen business only", async () => {
    const { t, tenantA, tenantB, superId } = await setup();
    await runCategory(t, superId, tenantA, "invoices", CLEAR_CATEGORIES.invoices.steps.length);
    const left = await t.run(async (ctx) => ({
      invoices: await ctx.db.query("invoices").collect(),
      lines: await ctx.db.query("invoiceLines").collect(),
      pays: await ctx.db.query("customerPayments").collect(),
      clients: await ctx.db.query("clients").collect(),
    }));
    expect(left.invoices.map((i) => i.tenantId)).toEqual([tenantB]);
    expect(left.lines).toHaveLength(1);
    expect(left.pays.map((p) => p.tenantId)).toEqual([tenantB]);
    expect(left.clients).toHaveLength(2); // customers are not part of the invoices group
  });

  it("stock group deletes movements and resets product quantities to 0 for that business", async () => {
    const { t, tenantA, superId, a, b } = await setup();
    await t.run(async (ctx) => { await ctx.db.insert("stockMovements", { tenantId: tenantA, productId: a.productId, movementDate: "2026-10-01", movementType: "purchase", qtyIn: 5, qtyOut: 0, runningBalance: 5, createdBy: superId }); });
    await runCategory(t, superId, tenantA, "stock", CLEAR_CATEGORIES.stock.steps.length);
    const out = await t.run(async (ctx) => ({ pa: await ctx.db.get("products", a.productId), pb: await ctx.db.get("products", b.productId), mv: await ctx.db.query("stockMovements").collect() }));
    expect(out.pa?.currentQty).toBe(0);
    expect(out.pb?.currentQty).toBe(5);
    expect(out.mv).toHaveLength(0);
  });

  /** Rows that the REPORTS read (journals, stock history, saved period reports) for both businesses, tagged by the document that wrote them. */
  async function seedReportRows(t: TestConvex<typeof schema>, tenantId: Id<"tenants">, productId: Id<"products">, userId: Id<"users">) {
    await t.run(async (ctx) => {
      for (const sourceType of ["sale", "sale_return", "payment", "waiter_sale", "purchase", "supplier_payment", "stock_adjustment", "manual"]) {
        const entryId = await ctx.db.insert("journalEntries", { tenantId, entryDate: "2026-10-01", reference: `R-${sourceType}`, description: sourceType, status: "posted", sourceType, totalDebit: 10, totalCredit: 10, createdBy: userId });
        const accountId = await ctx.db.insert("accounts", { tenantId, code: `9${sourceType.length}${Math.floor(Math.random() * 1000)}`, name: sourceType, type: "asset", balance: 0, isActive: true });
        await ctx.db.insert("journalLines", { tenantId, entryId, accountId, debit: 10, credit: 0 });
      }
      for (const movementType of ["sale", "waiter_order", "purchase", "adjustment"]) {
        await ctx.db.insert("stockMovements", { tenantId, productId, movementDate: "2026-10-01", movementType, qtyIn: 1, qtyOut: 0, runningBalance: 1, createdBy: userId });
      }
      await ctx.db.insert("reportRuns", { tenantId, period: "day", startDate: "2026-10-01", endDate: "2026-10-01", scope: "all", scopeLabel: "All", title: "Daily", netProfit: 1, netSales: 1, totalExpenses: 0, data: "{}", createdBy: userId, createdByName: "x", createdAt: "2026-10-01T00:00:00.000Z" });
    });
  }
  const snapshot = (t: TestConvex<typeof schema>) => t.run(async (ctx) => ({
    sources: (await ctx.db.query("journalEntries").collect()).map((e) => `${e.tenantId}:${e.sourceType}`),
    lines: (await ctx.db.query("journalLines").collect()).length,
    moves: (await ctx.db.query("stockMovements").collect()).map((m) => `${m.tenantId}:${m.movementType}`),
    reports: (await ctx.db.query("reportRuns").collect()).map((r) => String(r.tenantId)),
  }));

  it("clearing Sales also clears its reports: sale journals, sale stock history and saved period reports - nothing is left", async () => {
    const { t, tenantA, tenantB, superId, a, b } = await setup();
    await seedReportRows(t, tenantA, a.productId, superId);
    await seedReportRows(t, tenantB, b.productId, superId);
    await runCategory(t, superId, tenantA, "invoices", CLEAR_CATEGORIES.invoices.steps.length);
    const left = await snapshot(t);
    const mine = (x: string) => x.startsWith(String(tenantA));
    expect(left.sources.filter(mine).sort()).toEqual([`${tenantA}:manual`, `${tenantA}:purchase`, `${tenantA}:stock_adjustment`, `${tenantA}:supplier_payment`].sort()); // no sale, return, payment or waiter sale left
    expect(left.moves.filter(mine).sort()).toEqual([`${tenantA}:adjustment`, `${tenantA}:purchase`].sort());
    expect(left.reports).not.toContain(String(tenantA));
    // the other business is untouched
    expect(left.sources.filter((x) => x.startsWith(String(tenantB)))).toHaveLength(8);
    expect(left.moves.filter((x) => x.startsWith(String(tenantB)))).toHaveLength(4);
    expect(left.reports).toContain(String(tenantB));
    expect(left.lines).toBe(8 + 4); // journal lines of removed entries are gone too
  });

  it("clearing Purchases also clears purchase journals, purchase stock history and saved reports", async () => {
    const { t, tenantA, superId, a } = await setup();
    await seedReportRows(t, tenantA, a.productId, superId);
    await runCategory(t, superId, tenantA, "purchases", CLEAR_CATEGORIES.purchases.steps.length);
    const left = await snapshot(t);
    expect(left.sources.filter((x) => x.includes("purchase") || x.includes("supplier_payment"))).toHaveLength(0);
    expect(left.sources.filter((x) => x.startsWith(String(tenantA)))).toHaveLength(6);
    expect(left.moves.some((m) => m.endsWith(":purchase"))).toBe(false);
    expect(left.reports).toHaveLength(0);
  });

  it("clearing Stock also clears stock history, adjustment journals and saved reports", async () => {
    const { t, tenantA, superId, a } = await setup();
    await seedReportRows(t, tenantA, a.productId, superId);
    await runCategory(t, superId, tenantA, "stock", CLEAR_CATEGORIES.stock.steps.length);
    const left = await snapshot(t);
    expect(left.moves).toHaveLength(0);
    expect(left.sources.some((x) => x.endsWith(":stock_adjustment"))).toBe(false);
    expect(left.reports).toHaveLength(0);
  });

  it("refuses anyone who is not a Super Admin", async () => {
    const { t, tenantA, mgrId } = await setup();
    await expect(t.mutation(internal.maintenance.clearStepBatch, { actorId: mgrId, tenantId: tenantA, category: "invoices", step: 0 })).rejects.toThrow(/Super Admin/);
  });

  it("overview is empty for non-Super Admins and lists the groups for a Super Admin", async () => {
    const { t, superId, mgrId } = await setup();
    const sa = await t.withIdentity({ subject: superId, tokenIdentifier: "x|1" }).query(api.maintenance.clearDataOverview, {});
    const mg = await t.withIdentity({ subject: mgrId, tokenIdentifier: "x|2" }).query(api.maintenance.clearDataOverview, {});
    expect(sa.isSuperAdmin && sa.categories.map((c) => c.key)).toEqual(expect.arrayContaining(["invoices", "purchases", "suppliers", "stock", "transactions"]));
    expect(mg.isSuperAdmin).toBe(false);
  });
});

describe("Clear Data File > Sales Invoices also clears Selling Point sales and the dashboard numbers", () => {
  it("removes waiter orders, waiter collections and customer bills of the chosen business only, and empties its dashboard roll-ups", async () => {
    const { t, tenantA, tenantB, superId, a, b } = await setup();
    const seeded = await t.run(async (ctx) => {
      const now = new Date().toISOString();
      const mk = async (tenantId: typeof tenantA, productId: typeof a.productId, clientId: typeof a.clientId, invoiceId: typeof a.invoiceId) => {
        const orderId = await ctx.db.insert("waiterOrders", { tenantId, customerName: "Walk-in", waiterId: superId, waiterName: "Super", status: "pending", lines: [{ productId, productName: "P", qty: 1, unitPrice: 100, lineTotal: 100 }], total: 100, createdAt: now, updatedAt: now });
        await ctx.db.insert("waiterCollections", { tenantId, staffId: superId, staffName: "Super", cashierId: superId, cashierName: "Super", date: "2026-10-26", total: 100, splits: [{ method: "cash", amount: 100 }], orderIds: [orderId], createdAt: now });
        await ctx.db.insert("customerBills", { tenantId, clientId, invoiceIds: [invoiceId], status: "issued", createdBy: superId, createdAt: now });
        await ctx.db.insert("statsDaily", { tenantId, date: "2026-10-26", sales: 200, purchases: 0, collected: 110, invoices: 2 });
        await ctx.db.insert("statsDaily", { tenantId, date: "2020-01-01", sales: 999, purchases: 0, collected: 0, invoices: 1 }); // older than the rebuilt window
        await ctx.db.insert("statsTotals", { tenantId, receivable: 90, payable: 5, productCount: 1, lowStock: 0, outOfStock: 0, inventoryValue: 0, billsDue: 3, topD7: [{ name: "P", total: 100 }], topD30: [], topD90: [], refreshedAt: Date.now() });
      };
      await mk(tenantA, a.productId, a.clientId, a.invoiceId);
      await mk(tenantB, b.productId, b.clientId, b.invoiceId);
    });
    void seeded;
    await runCategory(t, superId, tenantA, "invoices", CLEAR_CATEGORIES.invoices.steps.length);
    await t.mutation(internal.maintenance.finishClear, { actorId: superId, tenantId: tenantA, categories: ["invoices"], counts: "test" });
    const left = await t.run(async (ctx) => ({
      orders: await ctx.db.query("waiterOrders").collect(),
      collections: await ctx.db.query("waiterCollections").collect(),
      bills: await ctx.db.query("customerBills").collect(),
      daily: await ctx.db.query("statsDaily").collect(),
      totals: await ctx.db.query("statsTotals").collect(),
    }));
    expect(left.orders.map((o) => o.tenantId)).toEqual([tenantB]);
    expect(left.collections.map((o) => o.tenantId)).toEqual([tenantB]);
    expect(left.bills.map((o) => o.tenantId)).toEqual([tenantB]);
    expect(left.daily.filter((d) => d.tenantId === tenantA)).toHaveLength(0); // every day, including those outside the rebuilt window
    expect(left.daily.filter((d) => d.tenantId === tenantB)).toHaveLength(2);
    const totalsA = left.totals.find((x) => x.tenantId === tenantA);
    expect(totalsA && [totalsA.receivable, totalsA.payable, totalsA.billsDue, totalsA.topD7.length]).toEqual([0, 0, 0, 0]);
    expect(left.totals.find((x) => x.tenantId === tenantB)?.receivable).toBe(90);
  });
});
