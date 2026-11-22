import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const LOGO = "data:image/png;base64,AAAA";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const bar = await ctx.db.insert("branches", { tenantId, name: "Bar", code: "B1", isActive: true, createdAt: now });
    const common = { currency: "TZS", currencySymbol: "TSh", decimalPlaces: 0, invoicePrefix: "INV-", purchasePrefix: "PUR-", allowNegativeStock: false, inventoryCostingMethod: "weighted_average" };
    // the logo was saved on the business-wide row; the department has its own company row WITHOUT a logo
    await ctx.db.insert("companySettings", { tenantId, companyName: "RUDY'S FARM", logoUrl: LOGO, ...common });
    await ctx.db.insert("companySettings", { tenantId, branchId: bar, companyName: "RUDY'S FARM - Bar", ...common });
    const cashier = await ctx.db.insert("users", { name: "cash", username: "cash", role: "manager", tenantId, branchId: bar, isActive: true, extraPermissions: ["accounts.reports.view"] });
    return { cashier };
  });
  const as = (id: Id<"users">) => t.withIdentity({ subject: id, tokenIdentifier: "x|2" });
  return { ...ids, asCashier: as(ids.cashier) };
}

describe("the business logo shows even when the department's own company row has none", () => {
  it("settings (waiter bills, receipts) and the report header both carry the logo", async () => {
    const { asCashier } = await setup();
    const s = await asCashier.query(api.maintenance.getSettings, {});
    expect(s.company?.logoUrl).toBe(LOGO);
    const h = await asCashier.query(api.periodReport.header, {});
    expect(h?.logoUrl).toBe(LOGO);
  });
});
