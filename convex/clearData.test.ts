import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

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

async function runCategory(t: any, actorId: any, tenantId: any, category: string, steps: number) {
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
    await runCategory(t, superId, tenantA, "invoices", 3);
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
    await runCategory(t, superId, tenantA, "stock", 3);
    const out = await t.run(async (ctx) => ({ pa: await ctx.db.get("products", a.productId), pb: await ctx.db.get("products", b.productId), mv: await ctx.db.query("stockMovements").collect() }));
    expect(out.pa?.currentQty).toBe(0);
    expect(out.pb?.currentQty).toBe(5);
    expect(out.mv).toHaveLength(0);
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
