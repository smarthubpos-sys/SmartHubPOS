import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const date = new Date().toISOString().slice(0, 10);

describe("sale idempotency", () => {
  it("the same requestKey never creates a second invoice or reduces stock twice", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = new Date().toISOString();
      const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now, modules: ["sales", "stock"] });
      const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
      const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
      const productId = await ctx.db.insert("products", { tenantId, itemCode: "ITM-1", name: "Sukari", sellingPrice: 10000, openingQty: 100, currentQty: 100, isActive: true });
      return { mgr, clientId, productId };
    });
    const as = t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|1" });
    const sale = { clientId: ids.clientId, invoiceDate: date, lines: [{ productId: ids.productId, qty: 4, unitPrice: 10000 }], requestKey: "req-1" };

    const first = await as.mutation(api.sales.createInvoice, sale);
    const again = await as.mutation(api.sales.createInvoice, sale);
    expect(again.invoiceId).toBe(first.invoiceId);
    expect(again.invoiceNo).toBe(first.invoiceNo);
    expect(again.duplicate).toBe(true);

    const state = await t.run(async (ctx) => ({
      invoices: (await ctx.db.query("invoices").collect()).length,
      stock: (await ctx.db.get("products", ids.productId))?.currentQty,
    }));
    expect(state.invoices).toBe(1);
    expect(state.stock).toBe(96);

    // a different key is a genuinely new sale
    const other = await as.mutation(api.sales.createInvoice, { ...sale, requestKey: "req-2" });
    expect(other.invoiceId).not.toBe(first.invoiceId);
    expect((await t.run((ctx) => ctx.db.get("products", ids.productId)))?.currentQty).toBe(92);
  });
});
