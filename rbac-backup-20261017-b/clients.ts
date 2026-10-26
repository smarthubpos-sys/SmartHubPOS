import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireActiveUser, requireManager, canAccessRecord, logAudit, resolveWriteScope, scopedRows } from "./access";

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
    const record = await ctx.db.get("clients", args.id);
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
    const { id, ...rest } = args;
    const name = rest.name.trim(), code = rest.code.trim();
    if (!name) throw new Error("Weka jina la mteja.");
    if (!code) throw new Error("Weka code ya mteja.");
    const data = { ...rest, name, code };
    // The record keeps the business/department it was created in; a new one uses the user's scope.
    const existingRecord = id ? await ctx.db.get("clients", id) : null;
    if (id && !canAccessRecord(user, existingRecord)) throw new Error("Forbidden: record is outside your office/branch");
    const target = existingRecord ? { tenantId: existingRecord.tenantId, branchId: existingRecord.branchId } : scope;
    // Client codes are unique only inside the same tenant + branch (checked for new AND edited customers).
    // A different business (or department) must be free to reuse the same code/phone.
    const sameCode = await ctx.db.query("clients")
      .withIndex("by_code", (q) => q.eq("code", code))
      .collect();
    const clash = sameCode.find((client) => client._id !== id && client.tenantId === target.tenantId && client.branchId === target.branchId);
    if (clash) throw new Error(`Client code ${code} already exists in this branch (${clash.name})`);
    if (id) {
      await ctx.db.patch("clients", id, data);
      await logAudit(ctx, user, { action: "update_client", module: "sales", referenceId: String(id), referenceType: "client", details: `${code} ${name}` });
      return id;
    }
    const newId = await ctx.db.insert("clients", { ...data, ...scope });
    await logAudit(ctx, user, { action: "create_client", module: "sales", referenceId: String(newId), referenceType: "client", details: `${code} ${name}` });
    return newId;
  },
});
