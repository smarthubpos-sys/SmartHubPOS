import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";

/** Super Admin may open any customer of the selected business, whatever department it belongs to. */
const inSameBusiness = (user: { tenantId?: unknown }, record: { tenantId?: unknown } | null) => !!record && record.tenantId === user.tenantId;
import { requireActiveUser, requireManager, isManagerRole, isSuperAdmin, requirePermission, canAccessRecord, logAudit, resolveWriteScope, scopedRows } from "./access";

/**
 * Who sees which customer:
 *  - Super Admin: every customer of the selected business (all departments)
 *  - Manager: customers of his branch
 *  - Waiter / cashier: only customers he created. Old customers saved before ownership tracking existed
 *    (no createdByUser) stay visible inside their branch so existing data is not lost.
 */
export async function visibleClients(ctx: QueryCtx, user: Parameters<typeof scopedRows>[1]) {
  if (isSuperAdmin(user)) {
    const tenantId = user.tenantId;
    if (!tenantId) return await scopedRows(ctx, user, "clients"); // no business set up (single-business install)
    return await ctx.db.query("clients").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect();
  }
  const rows = await scopedRows(ctx, user, "clients");
  if (await isManagerRole(ctx, user)) return rows;
  return rows.filter((client) => client.createdByUser === undefined || client.createdByUser === user._id);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return await visibleClients(ctx, user);
  },
});

export const getById = query({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const user = await requireActiveUser(ctx);
    const record = await ctx.db.get("clients", args.id);
    if (!record) return null;
    if (isSuperAdmin(user)) return inSameBusiness(user, record) ? record : null;
    if (!canAccessRecord(user, record)) return null;
    // Legacy customers have no owner field; keep them visible inside their existing branch rather than orphaning them.
    if (!(await isManagerRole(ctx, user)) && record.createdByUser !== undefined && record.createdByUser !== user._id) return null;
    return record;
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
    // Managers add and edit customers freely. A seller (waiter / cashier with sales.manage) may only ADD a new customer at the till,
    // with no opening balance and no credit; credit terms and editing existing customers stay with managers.
    const isMgr = await isManagerRole(ctx, await requireActiveUser(ctx));
    const user = isMgr ? await requireManager(ctx) : await requirePermission(ctx, "sales.manage", "sales");
    if (!isMgr && args.id) throw new Error("Forbidden: only a manager can edit an existing customer.");
    if (!isMgr) { args = { ...args, openingBalance: 0, creditLimit: undefined, creditPolicy: "block", isActive: true }; }
    const scope = await resolveWriteScope(ctx, user);
    const { id, ...rest } = args;
    const name = rest.name.trim(), code = rest.code.trim();
    if (!name) throw new Error("Weka jina la mteja.");
    if (!code) throw new Error("Weka code ya mteja.");
    const data = { ...rest, name, code };
    // The record keeps the business/department it was created in; a new one uses the user's scope.
    const existingRecord = id ? await ctx.db.get("clients", id) : null;
    if (id && !(isSuperAdmin(user) ? inSameBusiness(user, existingRecord) : canAccessRecord(user, existingRecord))) throw new Error("Forbidden: record is outside your office/branch");
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
    const newId = await ctx.db.insert("clients", { ...data, ...scope, createdByUser: user._id });
    await logAudit(ctx, user, { action: "create_client", module: "sales", referenceId: String(newId), referenceType: "client", details: `${code} ${name}` });
    return newId;
  },
});
