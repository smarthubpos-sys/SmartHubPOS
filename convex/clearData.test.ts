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

describe("Clear Data File > Sales alone puts the stock back; Sales with Stock wipes everything", () => {
  async function sold() {
    const base = await setup();
    await base.t.run(async (ctx) => {
      const { tenantA, superId, a, b } = base;
      await ctx.db.patch("products", a.productId, { currentQty: 2 }); // started with 5: sold 4, one customer returned 1
      await ctx.db.insert("stockMovements", { tenantId: tenantA, productId: a.productId, movementDate: "2026-10-01", movementType: "sale", qtyIn: 0, qtyOut: 4, runningBalance: 1, createdBy: superId });
      await ctx.db.insert("stockMovements", { tenantId: tenantA, productId: a.productId, movementDate: "2026-10-02", movementType: "sale_return", qtyIn: 1, qtyOut: 0, runningBalance: 2, createdBy: superId });
      await ctx.db.insert("stockMovements", { tenantId: tenantA, productId: a.productId, movementDate: "2026-10-03", movementType: "purchase", qtyIn: 3, qtyOut: 0, runningBalance: 5, createdBy: superId });
      await ctx.db.patch("products", b.productId, { currentQty: 1 });
      await ctx.db.insert("stockMovements", { tenantId: base.tenantB, productId: b.productId, movementDate: "2026-10-01", movementType: "sale", qtyIn: 0, qtyOut: 4, runningBalance: 1, createdBy: superId });
    });
    return base;
  }
  const qtyOf = (t: TestConvex<typeof schema>, id: Id<"products">) => t.run(async (ctx) => (await ctx.db.get("products", id))!.currentQty);
  const run = async (t: TestConvex<typeof schema>, superId: Id<"users">, tenantId: Id<"tenants">, restoreStock: boolean) => {
    for (let step = 0; step < CLEAR_CATEGORIES.invoices.steps.length; step++) {
      for (let i = 0; i < 20; i++) if ((await t.mutation(internal.maintenance.clearStepBatch, { actorId: superId, tenantId, category: "invoices", step, restoreStock })).done) break;
    }
  };

  it("Sales alone: sold quantities go back (return taken off), other business and purchases untouched", async () => {
    const { t, tenantA, superId, a, b } = await sold();
    await run(t, superId, tenantA, true);
    expect(await qtyOf(t, a.productId)).toBe(2 + 4 - 1); // 5 = as if the sales never happened
    expect(await qtyOf(t, b.productId)).toBe(1); // another business is not touched
    const moves = await t.run(async (ctx) => (await ctx.db.query("stockMovements").collect()).filter((m) => m.tenantId === tenantA).map((m) => m.movementType));
    expect(moves).toEqual(["purchase"]);
  });

  it("running it twice does not restore twice", async () => {
    const { t, tenantA, superId, a } = await sold();
    await run(t, superId, tenantA, true);
    await run(t, superId, tenantA, true);
    expect(await qtyOf(t, a.productId)).toBe(5);
  });

  it("without the restore flag (Sales chosen together with Stock) quantities are not touched here", async () => {
    const { t, tenantA, superId, a } = await sold();
    await run(t, superId, tenantA, false);
    expect(await qtyOf(t, a.productId)).toBe(2);
  });

  it("Sales + Stock chosen together: everything is wiped and quantities end at 0", async () => {
    const { t, tenantA, tenantB, superId, a } = await sold();
    await t.run(async (ctx) => { await ctx.db.patch("users", superId, { tenantId: tenantA }); });
    const asSuper = t.withIdentity({ subject: superId, tokenIdentifier: "x|1" });
    // the real action re-checks the password, so drive the same steps the action would: restore is OFF because Stock is chosen too
    for (const category of ["invoices", "stock"]) {
      const steps = CLEAR_CATEGORIES[category].steps.length;
      for (let step = 0; step < steps; step++) for (let i = 0; i < 20; i++) if ((await t.mutation(internal.maintenance.clearStepBatch, { actorId: superId, tenantId: tenantA, category, step, restoreStock: false })).done) break;
    }
    void asSuper; void tenantB;
    expect(await qtyOf(t, a.productId)).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("stockMovements").collect()).filter((m) => m.tenantId === tenantA).length)).toBe(0);
  });
});

describe("Clear Data File > what the Sales menu reports and the dashboard debt cards show afterwards", () => {
  async function owing() {
    const base = await setup();
    await base.t.run(async (ctx) => {
      const { tenantA, tenantB, superId, a, b } = base;
      await ctx.db.patch("clients", a.clientId, { openingBalance: 700 });
      await ctx.db.patch("clients", b.clientId, { openingBalance: 300 });
      for (const tenantId of [tenantA, tenantB]) {
        await ctx.db.insert("statsTotals", { tenantId, receivable: 90, payable: 40, productCount: 1, lowStock: 0, outOfStock: 0, inventoryValue: 500, billsDue: 25, topD7: [{ name: "Prod", total: 100 }], topD30: [], topD90: [], refreshedAt: Date.now() });
        await ctx.db.insert("statsDaily", { tenantId, date: "2026-10-01", sales: 100, purchases: 0, collected: 10, invoices: 1 });
        await ctx.db.insert("suppliers", { tenantId, code: `S-${String(tenantId).slice(-4)}`, name: "Supplier", openingBalance: 450, isActive: true });
      }
      void superId;
    });
    return base;
  }

  it("Sales: customers' opening debts go to 0 (customer reports show nothing), the other business keeps its own", async () => {
    const { t, tenantA, superId, a, b } = await owing();
    await runCategory(t, superId, tenantA, "invoices", CLEAR_CATEGORIES.invoices.steps.length);
    const out = await t.run(async (ctx) => ({ ca: (await ctx.db.get("clients", a.clientId))!.openingBalance, cb: (await ctx.db.get("clients", b.clientId))!.openingBalance, suppliers: (await ctx.db.query("suppliers").collect()).filter((x) => x.tenantId === tenantA).map((x) => x.openingBalance) }));
    expect(out).toEqual({ ca: 0, cb: 300, suppliers: [450] }); // supplier debts belong to Purchases, not Sales
    const asSuper = t.withIdentity({ subject: superId, tokenIdentifier: "x|1" });
    const report = await asSuper.query(api.sales.salesRegisters, { startDate: "2026-01-01", endDate: "2026-12-31", withLines: true });
    expect(report.invoices).toHaveLength(0);
    expect(report.lines).toHaveLength(0);
    expect(report.payments).toHaveLength(0);
    expect(report.balances.every((x) => x.closing === 0)).toBe(true);
    expect(report.totals.sales).toBe(0);
  });

  it("Purchases: suppliers' opening debts go to 0", async () => {
    const { t, tenantA, tenantB, superId } = await owing();
    await runCategory(t, superId, tenantA, "purchases", CLEAR_CATEGORIES.purchases.steps.length);
    const sup = await t.run(async (ctx) => (await ctx.db.query("suppliers").collect()).map((x) => `${x.tenantId === tenantA ? "A" : x.tenantId === tenantB ? "B" : "?"}:${x.openingBalance}`).sort());
    expect(sup).toEqual(["A:0", "B:450"]);
  });

  it("dashboard debt cards read 0 once the clean-up and the background recount are done", async () => {
    const { t, tenantA, superId } = await owing();
    await t.run(async (ctx) => { await ctx.db.patch("users", superId, { tenantId: tenantA }); });
    // everything that feeds the cards: invoices (receivable), purchases (payable), running-cost bills (bills due)
    for (const category of ["invoices", "purchases", "transactions", "stock"]) await runCategory(t, superId, tenantA, category, CLEAR_CATEGORIES[category].steps.length);
    await t.mutation(internal.maintenance.finishClear, { actorId: superId, tenantId: tenantA, categories: ["invoices", "purchases", "transactions", "stock"], counts: "test" });
    await t.finishAllScheduledFunctions(() => {});
    const asSuper = t.withIdentity({ subject: superId, tokenIdentifier: "x|1" });
    const m = await asSuper.query(api.dashboard.getMetrics, { date: "2026-10-01" });
    expect(m).toMatchObject({ totalOutstandingCustomer: 0, totalOutstandingSupplier: 0, todaySales: 0, todayCash: 0, waiterOwing: 0, inventoryValue: 0 });
    const c = await asSuper.query(api.dashboard.getCharts, { from: "2026-09-01", today: "2026-10-31" });
    expect(c).toMatchObject({ receivable: 0, payable: 0, billsDue: 0, topProducts: [] });
    expect(c.totals).toMatchObject({ sales: 0, purchases: 0, invoices: 0 });
  });
});

describe("Clear Data File > Bills", () => {
  it("clears running-cost bills, their payments, bill journals and saved reports; leaves other journals and the other business", async () => {
    const { t, tenantA, tenantB, superId } = await setup();
    await t.run(async (ctx) => {
      for (const tenantId of [tenantA, tenantB]) {
        const billId = await ctx.db.insert("bills", { tenantId, billNumber: "BILL-0001", vendor: "TANESCO", category: "electricity", billDate: "2026-10-01", dueDate: "2026-10-20", amount: 500, paidAmount: 100, status: "partial", createdBy: superId });
        await ctx.db.insert("billPayments", { tenantId, billId, paymentDate: "2026-10-02", amount: 100, method: "cash", createdBy: superId });
        for (const sourceType of ["bill", "bill_payment", "bill_void", "manual"]) {
          const entryId = await ctx.db.insert("journalEntries", { tenantId, entryDate: "2026-10-01", reference: `R-${sourceType}`, description: sourceType, status: "posted", sourceType, totalDebit: 10, totalCredit: 10, createdBy: superId });
          const accountId = await ctx.db.insert("accounts", { tenantId, code: `7${Math.floor(Math.random() * 100000)}`, name: sourceType, type: "expense", balance: 0, isActive: true });
          await ctx.db.insert("journalLines", { tenantId, entryId, accountId, debit: 10, credit: 0 });
        }
        await ctx.db.insert("reportRuns", { tenantId, period: "day", startDate: "2026-10-01", endDate: "2026-10-01", scope: "all", scopeLabel: "All", title: "Daily", netProfit: 1, netSales: 1, totalExpenses: 0, data: "{}", createdBy: superId, createdByName: "x", createdAt: "2026-10-01T00:00:00.000Z" });
      }
    });
    await runCategory(t, superId, tenantA, "bills", CLEAR_CATEGORIES.bills.steps.length);
    const left = await t.run(async (ctx) => ({
      bills: (await ctx.db.query("bills").collect()).map((b) => String(b.tenantId)),
      pays: (await ctx.db.query("billPayments").collect()).map((b) => String(b.tenantId)),
      sources: (await ctx.db.query("journalEntries").collect()).map((e) => `${e.tenantId === tenantA ? "A" : "B"}:${e.sourceType}`).sort(),
      lines: (await ctx.db.query("journalLines").collect()).length,
      reports: (await ctx.db.query("reportRuns").collect()).map((r) => String(r.tenantId)),
    }));
    expect(left.bills).toEqual([String(tenantB)]);
    expect(left.pays).toEqual([String(tenantB)]);
    expect(left.sources.filter((x) => x.startsWith("A"))).toEqual(["A:manual"]);
    expect(left.sources.filter((x) => x.startsWith("B"))).toHaveLength(4);
    expect(left.lines).toBe(1 + 4); // lines of removed entries are gone too
    expect(left.reports).toEqual([String(tenantB)]);
  });
});
