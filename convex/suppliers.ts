import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireActiveUser, requirePermission, canAccessBusinessRecord, filterBusiness, resolveWriteScope, logAudit, businessRows, isSuperAdmin } from "./access";

/**
 * Suppliers belong to the WHOLE business: every department sees the same list.
 * Supplier codes are unique inside one business only (two businesses may both have "SUP-0001").
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return await businessRows(ctx, user, "suppliers");
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await businessRows(ctx, user, "suppliers")).filter((s) => s.isActive);
  },
});

export const getById = query({
  args: { id: v.id("suppliers") },
  handler: async (ctx, args) => {
    const user = await requireActiveUser(ctx);
    const record = await ctx.db.get("suppliers", args.id);
    return canAccessBusinessRecord(user, record) ? record : null;
  },
});

const nextCode = (codes: string[]) => {
  let max = 0;
  for (const c of codes) { const m = /^SUP-(\d+)$/i.exec(c.trim()); if (m) max = Math.max(max, Number(m[1])); }
  return `SUP-${String(max + 1).padStart(4, "0")}`;
};

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
    // Suppliers are business-wide, so no department has to be chosen to save one.
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    const { id, ...rest } = args;
    const name = rest.name.trim();
    if (!name) throw new Error("Weka jina la supplier.");
    const tenantId = scope.tenantId;
    const sameBusiness = tenantId
      ? await ctx.db.query("suppliers").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect()
      : await ctx.db.query("suppliers").collect();
    // A blank code is filled in automatically (SUP-0001, SUP-0002, ...).
    const code = rest.code.trim() || nextCode(sameBusiness.map((s) => s.code));
    const clash = sameBusiness.find((s) => s.code.trim().toLowerCase() === code.toLowerCase() && s._id !== id);
    if (clash) throw new Error(`Supplier code ${code} tayari inatumika na ${clash.name}. Tumia code nyingine au iache wazi ijazwe yenyewe.`);
    const data = { ...rest, name, code };
    if (id) {
      const existingRecord = await ctx.db.get("suppliers", id);
      if (!canAccessBusinessRecord(user, existingRecord)) throw new Error("Forbidden: record is outside your office/branch");
      await ctx.db.patch("suppliers", id, data);
      await logAudit(ctx, user, { action: "update_supplier", module: "purchasing", referenceId: String(id), referenceType: "supplier", details: `${data.code} ${data.name}` });
      return id;
    }
    const newId = await ctx.db.insert("suppliers", { ...data, ...(tenantId ? { tenantId } : {}) });
    await logAudit(ctx, user, { action: "create_supplier", module: "purchasing", referenceId: String(newId), referenceType: "supplier", details: `${data.code} ${data.name}` });
    return newId;
  },
});

/** Old suppliers saved before businesses existed have no business, so nobody can see them. Super Admin only. */
export const unassignedCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    if (!isSuperAdmin(user) || !user.tenantId) return 0;
    return (await ctx.db.query("suppliers").withIndex("by_scope", (q) => q.eq("tenantId", undefined)).take(500)).length;
  },
});

/** Attaches every supplier that has no business to the business the Super Admin is working in. Safe to run again. */
export const adoptUnassigned = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "suppliers.manage");
    const tenantId = user.tenantId;
    if (!isSuperAdmin(user) || !tenantId) throw new Error("Super Admin achague biashara kwanza.");
    const orphans = await ctx.db.query("suppliers").withIndex("by_scope", (q) => q.eq("tenantId", undefined)).take(500);
    const taken = new Set((await ctx.db.query("suppliers").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect()).map((s) => s.code.trim().toLowerCase()));
    for (const s of orphans) {
      let code = s.code.trim() || "SUP";
      while (taken.has(code.toLowerCase())) code += "-OLD";
      taken.add(code.toLowerCase());
      await ctx.db.patch("suppliers", s._id, { tenantId, code });
    }
    return orphans.length;
  },
});
