import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireActiveUser, requireManager, filterScoped, resolveWriteScope, scopedRows } from "./access";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await scopedRows(ctx, user, "companySettings"))[0] ?? null;
  },
});

export const upsert = mutation({
  args: {
    companyName: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    taxId: v.optional(v.string()),
    website: v.optional(v.string()),
    currency: v.string(),
    currencySymbol: v.string(),
    decimalPlaces: v.number(),
    taxRate: v.optional(v.number()),
    taxName: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    financialYearStart: v.optional(v.string()),
    invoicePrefix: v.optional(v.string()),
    purchasePrefix: v.optional(v.string()),
    allowNegativeStock: v.optional(v.boolean()),
    inventoryCostingMethod: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireManager(ctx);
    const scope = await resolveWriteScope(ctx, user);

    const existing = (await scopedRows(ctx, user, "companySettings"))[0];
    if (existing) {
      await ctx.db.patch("companySettings", existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("companySettings", { ...args, ...scope });
  },
});

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireManager(ctx);
    const scope = await resolveWriteScope(ctx, user);
    const existing = (await scopedRows(ctx, user, "companySettings"))[0];
    if (existing) return existing._id;

    return await ctx.db.insert("companySettings", {
      companyName: "Your Business Name",
      currency: "USD",
      currencySymbol: "$",
      decimalPlaces: 2,
      invoicePrefix: "INV-",
      purchasePrefix: "PUR-",
      allowNegativeStock: false,
      inventoryCostingMethod: "weighted_average",
      ...scope,
    });
  },
});
