import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

describe("stats rebuild (typed scheduler arguments)", () => {
  it("runs every phase through the scheduler and writes the roll-up", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const ids = await t.run(async (ctx) => {
        const now = new Date().toISOString();
        const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now });
        const sa = await ctx.db.insert("users", { name: "Root", username: "root", role: "super_admin", isActive: true });
        const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
        await ctx.db.insert("products", { tenantId, itemCode: "ITM-1", name: "Sukari", sellingPrice: 10000, openingQty: 5, currentQty: 5, weightedAvgCost: 6000, isActive: true });
        await ctx.db.insert("invoices", { tenantId, invoiceNo: "INV-1", invoiceDate: new Date().toISOString().slice(0, 10), clientId, subtotal: 10000, discount: 0, taxAmount: 0, total: 10000, amountPaid: 4000, outstanding: 6000, paymentStatus: "partial", status: "posted", createdBy: sa });
        return { tenantId, sa };
      });
      const asSuper = t.withIdentity({ subject: ids.sa, tokenIdentifier: "x|9" });
      await asSuper.mutation(api.stats.rebuildBusiness, { tenantId: ids.tenantId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const totals = await t.run(async (ctx) => ctx.db.query("statsTotals").collect());
      expect(totals).toHaveLength(1);
      expect(totals[0].receivable).toBe(6000);
      expect(totals[0].productCount).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
