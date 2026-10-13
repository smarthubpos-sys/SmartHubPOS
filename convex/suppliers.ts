import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireActiveUser, requirePermission, canAccessRecord, filterScoped, resolveWriteScope, logAudit, scopedRows } from "./access";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await scopedRows(ctx, user, "suppliers"));
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return filterScoped(user, await ctx.db.query("suppliers").filter((q) => q.eq(q.field("isActive"), true)).collect());
  },
});

export const getById = query({
  args: { id: v.id("suppliers") },
  handler: async (ctx, args) => {
    const user = await requireActiveUser(ctx);
    const record = await ctx.db.get(args.id);
    return canAccessRecord(user, record) ? record : null;
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("suppliers")),
    code: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    taxId: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    paymentTermsDays: v.optional(v.number()),
    creditLimit: v.optional(v.number()),
    openingBalance: v.number(),
    contactPerson: v.optional(v.string()),
    notes: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requirePermission(ctx, "suppliers.manage");
    const scope = await resolveWriteScope(ctx, user);
    const { id, ...data } = args;
    if (id) {
      const existingRecord = await ctx.db.get(id);
      if (!canAccessRecord(user, existingRecord)) throw new Error("Forbidden: record is outside your office/branch");
      await ctx.db.patch(id, data);
      await logAudit(ctx, user, { action: "update_supplier", module: "purchasing", referenceId: String(id), referenceType: "supplier", details: `${data.code} ${data.name}` });
      return id;
    }
    const existing = await ctx.db
      .query("suppliers")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    if (existing) throw new Error(`Supplier code ${args.code} already exists`);
    const newId = await ctx.db.insert("suppliers", { ...data, ...scope });
    await logAudit(ctx, user, { action: "create_supplier", module: "purchasing", referenceId: String(newId), referenceType: "supplier", details: `${data.code} ${data.name}` });
    return newId;
  },
});
