import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

describe("business-wide product catalog and customer ownership", () => {
  it("lets Super Admin see customers across departments while staff see only their own; products show in their own branch, and products of all departments show everywhere", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "VIS", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
      const branchA = await ctx.db.insert("branches", { tenantId, name: "Bar", code: "VIS-A", isActive: true, createdAt: new Date().toISOString() });
      const branchB = await ctx.db.insert("branches", { tenantId, name: "Lounge", code: "VIS-B", isActive: true, createdAt: new Date().toISOString() });
      const admin = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
      const staffA = await ctx.db.insert("users", { name: "Asha", username: "asha", role: "cashier", tenantId, branchId: branchA, isActive: true });
      const staffB = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "cashier", tenantId, branchId: branchA, isActive: true });
      await ctx.db.insert("clients", { tenantId, branchId: branchA, createdByUser: staffA, code: "CA", name: "Mteja wa Asha", openingBalance: 0, creditPolicy: "block", isActive: true });
      await ctx.db.insert("clients", { tenantId, branchId: branchA, createdByUser: staffB, code: "CJ", name: "Mteja wa Juma", openingBalance: 0, creditPolicy: "block", isActive: true });
      await ctx.db.insert("clients", { tenantId, branchId: branchB, createdByUser: staffB, code: "CB", name: "Mteja wa Lounge", openingBalance: 0, creditPolicy: "block", isActive: true });
      await ctx.db.insert("products", { tenantId, itemCode: "GLOBAL", name: "Bidhaa ya biashara", openingQty: 10, currentQty: 10, sellingPrice: 100, isActive: true });
      await ctx.db.insert("products", { tenantId, branchId: branchA, itemCode: "A", name: "Bidhaa ya Bar", openingQty: 2, currentQty: 2, sellingPrice: 100, isActive: true });
      await ctx.db.insert("products", { tenantId, branchId: branchB, itemCode: "B", name: "Bidhaa ya Lounge", openingQty: 3, currentQty: 3, sellingPrice: 100, isActive: true });
      return { admin, staffA, tenantId };
    });
    const asAdmin = t.withIdentity({ subject: ids.admin, tokenIdentifier: "x|admin" });
    const asAsha = t.withIdentity({ subject: ids.staffA, tokenIdentifier: "x|asha" });
    await asAdmin.mutation(api.tenants.selectBusiness, { tenantId: ids.tenantId });
    expect((await asAdmin.query(api.clients.list, {})).map((c) => c.name).sort()).toEqual(["Mteja wa Asha", "Mteja wa Juma", "Mteja wa Lounge"].sort());
    expect((await asAsha.query(api.clients.list, {})).map((c) => c.name)).toEqual(["Mteja wa Asha"]);
    expect((await asAsha.query(api.products.listActive, {})).map((p) => p.name).sort()).toEqual(["Bidhaa ya Bar", "Bidhaa ya biashara"].sort());
  });
});
