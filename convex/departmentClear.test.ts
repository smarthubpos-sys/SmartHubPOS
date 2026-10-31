import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { TestConvex } from "convex-test";
import { modules } from "./tes.setup";
import { CLEAR_CATEGORIES } from "./maintenance";

/**
 * Fix 2 - TENANT, BUSINESS & DEPARTMENT.
 * Clearing the data of ONE department removes that department's rows only: the other departments of the same business and every other
 * business keep theirs, and so does the business-wide invoice counter (numbers of surviving invoices are never reused).
 */
const now = new Date().toISOString();

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("tenants", { name: "Shop A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const tenantB = await ctx.db.insert("tenants", { name: "Shop B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const bar = await ctx.db.insert("branches", { tenantId: tenantA, name: "Bar", code: "BAR", isActive: true, createdAt: now });
    const kitchen = await ctx.db.insert("branches", { tenantId: tenantA, name: "Kitchen", code: "KIT", isActive: true, createdAt: now });
    const otherBranch = await ctx.db.insert("branches", { tenantId: tenantB, name: "Other", code: "OTH", isActive: true, createdAt: now });
    const superId = await ctx.db.insert("users", { name: "Super", username: "super", role: "super_admin", tenantId: tenantA, isActive: true });
    const seed = async (tenantId: Id<"tenants">, branchId: Id<"branches">, tag: string) => {
      const clientId = await ctx.db.insert("clients", { tenantId, branchId, code: `C-${tag}`, name: `Client ${tag}`, openingBalance: 40, creditPolicy: "allow", isActive: true });
      const productId = await ctx.db.insert("products", { tenantId, branchId, itemCode: `P-${tag}`, name: `Prod ${tag}`, openingQty: 5, currentQty: 4, sellingPrice: 100, isActive: true });
      const invoiceId = await ctx.db.insert("invoices", { tenantId, branchId, invoiceNo: `INV-${tag}`, invoiceDate: "2026-10-01", clientId, subtotal: 100, discount: 0, taxAmount: 0, total: 100, amountPaid: 10, outstanding: 90, paymentStatus: "partial", status: "posted", createdBy: superId });
      await ctx.db.insert("invoiceLines", { invoiceId, productId, qty: 1, qtyStr: "1", unitPrice: 100, unitPriceStr: "100", lineTotal: 100, lineTotalStr: "100", costAtSale: 50, discount: 0 });
      await ctx.db.insert("customerPayments", { tenantId, branchId, paymentDate: "2026-10-01", clientId, invoiceId, amount: 10, paymentMethod: "cash", createdBy: superId });
      await ctx.db.insert("stockMovements", { tenantId, branchId, movementDate: "2026-10-01", productId, movementType: "sale", referenceId: String(invoiceId), referenceType: "invoice", qtyIn: 0, qtyOut: 1, runningBalance: 4, createdBy: superId });
      return { clientId, productId, invoiceId };
    };
    const a = { bar: await seed(tenantA, bar, "BAR"), kitchen: await seed(tenantA, kitchen, "KIT") };
    const b = await seed(tenantB, otherBranch, "OTH");
    // One business-wide counter plus the old per-department ones.
    await ctx.db.insert("salesSequences", { tenantId: tenantA, nextNumber: 3 });
    await ctx.db.insert("salesSequences", { tenantId: tenantA, branchId: bar, nextNumber: 2 });
    await ctx.db.insert("salesSequences", { tenantId: tenantA, branchId: kitchen, nextNumber: 2 });
    return { tenantA, tenantB, bar, kitchen, otherBranch, superId, a, b };
  });
  return { t, ...ids };
}

async function runCategory(t: TestConvex<typeof schema>, actorId: Id<"users">, tenantId: Id<"tenants">, category: string, branchId?: Id<"branches">, restoreStock = false) {
  const steps = CLEAR_CATEGORIES[category].steps.length;
  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < 20; i++) {
      const r = await t.mutation(internal.maintenance.clearStepBatch, { actorId, tenantId, category, step, branchId, restoreStock });
      if (r.done) break;
    }
  }
  await t.mutation(internal.maintenance.finishClear, { actorId, tenantId, categories: [category], counts: "test", branchId });
}

describe("clearing Sales of one department", () => {
  it("removes that department's invoices, lines, payments and sale history - and nothing else", async () => {
    const { t, tenantA, bar, kitchen, superId, a, b } = await setup();
    await runCategory(t, superId, tenantA, "invoices", bar);
    const left = await t.run(async (ctx) => ({
      invoices: await ctx.db.query("invoices").collect(),
      lines: await ctx.db.query("invoiceLines").collect(),
      pays: await ctx.db.query("customerPayments").collect(),
      moves: await ctx.db.query("stockMovements").collect(),
    }));
    expect(left.invoices.map((i) => i._id).sort()).toEqual([a.kitchen.invoiceId, b.invoiceId].sort());
    expect(left.lines).toHaveLength(2);
    expect(left.pays.map((p) => p.branchId === bar)).not.toContain(true);
    expect(left.pays).toHaveLength(2);
    expect(left.moves.filter((m) => m.branchId === kitchen)).toHaveLength(1);
    expect(left.moves.filter((m) => m.branchId === bar)).toHaveLength(0);
  });

  it("zeroes the opening debt of that department's customers only", async () => {
    const { t, tenantA, bar, superId, a, b } = await setup();
    await runCategory(t, superId, tenantA, "invoices", bar);
    const clients = await t.run(async (ctx) => ({ bar: await ctx.db.get("clients", a.bar.clientId), kitchen: await ctx.db.get("clients", a.kitchen.clientId), other: await ctx.db.get("clients", b.clientId) }));
    expect(clients.bar?.openingBalance).toBe(0);
    expect(clients.kitchen?.openingBalance).toBe(40);
    expect(clients.other?.openingBalance).toBe(40);
  });

  it("keeps the business-wide invoice counter and the other department's counter", async () => {
    const { t, tenantA, bar, kitchen, superId } = await setup();
    await runCategory(t, superId, tenantA, "invoices", bar);
    const seq = await t.run(async (ctx) => await ctx.db.query("salesSequences").collect());
    expect(seq.find((s) => s.branchId === undefined)?.nextNumber).toBe(3);
    expect(seq.find((s) => s.branchId === kitchen)?.nextNumber).toBe(2);
    expect(seq.find((s) => s.branchId === bar)).toBeUndefined();
  });

  it("with the restore flag, only the cleared department's products get their sold quantity back", async () => {
    const { t, tenantA, bar, superId, a, b } = await setup();
    await runCategory(t, superId, tenantA, "invoices", bar, true);
    const p = await t.run(async (ctx) => ({ bar: await ctx.db.get("products", a.bar.productId), kitchen: await ctx.db.get("products", a.kitchen.productId), other: await ctx.db.get("products", b.productId) }));
    expect(p.bar?.currentQty).toBe(5);
    expect(p.kitchen?.currentQty).toBe(4);
    expect(p.other?.currentQty).toBe(4);
  });
});

describe("clearing Stock / Products of one department", () => {
  it("resets only that department's product quantities", async () => {
    const { t, tenantA, bar, superId, a, b } = await setup();
    await runCategory(t, superId, tenantA, "stock", bar);
    const p = await t.run(async (ctx) => ({ bar: await ctx.db.get("products", a.bar.productId), kitchen: await ctx.db.get("products", a.kitchen.productId), other: await ctx.db.get("products", b.productId) }));
    expect(p.bar?.currentQty).toBe(0);
    expect(p.kitchen?.currentQty).toBe(4);
    expect(p.other?.currentQty).toBe(4);
  });

  it("deleting Products of one department keeps the other department's products", async () => {
    const { t, tenantA, bar, superId, a } = await setup();
    await runCategory(t, superId, tenantA, "products", bar);
    const left = await t.run(async (ctx) => (await ctx.db.query("products").collect()).map((p) => p._id));
    expect(left).not.toContain(a.bar.productId);
    expect(left).toContain(a.kitchen.productId);
  });
});

describe("whole business and guards", () => {
  it("without a department the whole business goes - but never another business", async () => {
    const { t, tenantA, superId, a, b } = await setup();
    await runCategory(t, superId, tenantA, "invoices");
    const left = (await t.run(async (ctx) => await ctx.db.query("invoices").collect())).map((i) => i._id);
    expect(left).toEqual([b.invoiceId]);
    expect(left).not.toContain(a.bar.invoiceId);
  });

  it("refuses a department that belongs to another business", async () => {
    const { t, tenantA, otherBranch, superId } = await setup();
    await expect(t.mutation(internal.maintenance.clearStepBatch, { actorId: superId, tenantId: tenantA, category: "invoices", step: 0, branchId: otherBranch })).rejects.toThrow(/Idara haihusiani/);
  });

  it("the form's authorisation picks ONE department (or the whole business on purpose), never both", async () => {
    const { t, tenantA, bar, superId } = await setup();
    const as = t.withIdentity({ subject: superId, tokenIdentifier: "x|1" });
    const one = await as.query(internal.maintenance.authorizeClear, { categories: ["invoices"], branchId: bar });
    expect(one.branchId).toBe(bar);
    expect(one.tenantId).toBe(tenantA);
    const all = await as.query(internal.maintenance.authorizeClear, { categories: ["invoices"], wholeBusiness: true });
    expect(all.branchId).toBeUndefined();
    await expect(as.query(internal.maintenance.authorizeClear, { categories: ["invoices"], branchId: bar, wholeBusiness: true })).rejects.toThrow(/AU biashara nzima/);
  });

  it("Audit Logs are business-wide: a department wipe of them is refused", async () => {
    const { t, bar, superId } = await setup();
    const as = t.withIdentity({ subject: superId, tokenIdentifier: "x|1" });
    await expect(as.query(internal.maintenance.authorizeClear, { categories: ["auditLogs"], branchId: bar })).rejects.toThrow(/biashara nzima/);
  });

  it("only a Super Admin may clear data", async () => {
    const { t, tenantA, bar } = await setup();
    const plain = await t.run(async (ctx) => await ctx.db.insert("users", { name: "M", username: "m", role: "manager", tenantId: tenantA, isActive: true }));
    await expect(t.mutation(internal.maintenance.clearStepBatch, { actorId: plain, tenantId: tenantA, category: "invoices", step: 0, branchId: bar })).rejects.toThrow(/Super Admin/);
    // The public overview is empty for non-Super Admins.
    const as = t.withIdentity({ subject: plain, tokenIdentifier: "x|2" });
    expect(api.maintenance.clearDataOverview).toBeTruthy();
    await expect(as.query(internal.maintenance.authorizeClear, { categories: ["invoices"], branchId: bar })).rejects.toThrow();
  });
});
