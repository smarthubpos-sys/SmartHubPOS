import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireActiveUser, requireManager, canAccessRecord, filterScoped, resolveWriteScope, scopedRows } from "./access";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await scopedRows(ctx, user, "clients"));
  },
});

export const getById = query({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const user = await requireActiveUser(ctx);
    const record = await ctx.db.get(args.id);
    return canAccessRecord(user, record) ? record : null;
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("clients")),
    code: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    taxId: v.optional(v.string()),
    openingBalance: v.number(),
    creditLimit: v.optional(v.number()),
    paymentTerms: v.optional(v.string()),
    paymentTermsDays: v.optional(v.number()),
    contactPerson: v.optional(v.string()),
    notes: v.optional(v.string()),
    creditPolicy: v.string(),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireManager(ctx);
    const scope = await resolveWriteScope(ctx, user);
    const { id, ...data } = args;
    if (id) {
      const existingRecord = await ctx.db.get(id);
      if (!canAccessRecord(user, existingRecord)) throw new Error("Forbidden: record is outside your office/branch");
      await ctx.db.patch(id, data);
      return id;
    }
    // Client codes are unique only inside the current tenant + branch. A different
    // business (or department/branch) must be free to reuse the same code/phone.
    const sameCode = await ctx.db.query("clients")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .collect();
    const existing = sameCode.find((client) =>
      client.tenantId === scope.tenantId && client.branchId === scope.branchId
    );
    if (existing) throw new Error(`Client code ${args.code} already exists in this branch`);
    return await ctx.db.insert("clients", { ...data, ...scope });
  },
});
