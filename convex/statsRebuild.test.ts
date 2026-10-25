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
  it("counts cash collected on the payment day, not the invoice day, and ignores voided payments", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
      const old = new Date(Date.now() + 3 * 3600000 - 5 * 86400000).toISOString().slice(0, 10);
      const ids = await t.run(async (ctx) => {
        const now = new Date().toISOString();
        const tenantId = await ctx.db.insert("tenants", { name: "Duka2", code: "D2", isActive: true, createdByToken: "t", createdAt: now });
        const sa = await ctx.db.insert("users", { name: "Root", username: "root2", role: "super_admin", isActive: true });
        const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
        const invoiceId = await ctx.db.insert("invoices", { tenantId, invoiceNo: "INV-1", invoiceDate: old, clientId, subtotal: 10000, discount: 0, taxAmount: 0, total: 10000, amountPaid: 7000, outstanding: 3000, paymentStatus: "partial", status: "posted", createdBy: sa });
        await ctx.db.insert("customerPayments", { tenantId, paymentDate: old, clientId, invoiceId, amount: 4000, paymentMethod: "cash", createdBy: sa });
        await ctx.db.insert("customerPayments", { tenantId, paymentDate: today, clientId, invoiceId, amount: 3000, paymentMethod: "cash", createdBy: sa });
        await ctx.db.insert("customerPayments", { tenantId, paymentDate: today, clientId, invoiceId, amount: 999, paymentMethod: "cash", voided: true, createdBy: sa });
        return { tenantId, sa };
      });
      await t.withIdentity({ subject: ids.sa, tokenIdentifier: "x|9" }).mutation(api.stats.rebuildBusiness, { tenantId: ids.tenantId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const days = await t.run(async (ctx) => ctx.db.query("statsDaily").collect());
      const sum = (date: string, f: "sales" | "collected") => days.filter((d) => d.date === date).reduce((n, d) => n + d[f], 0);
      expect(sum(today, "collected")).toBe(3000);
      expect(sum(old, "collected")).toBe(4000);
      expect(sum(old, "sales")).toBe(10000);
      expect(sum(today, "sales")).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
