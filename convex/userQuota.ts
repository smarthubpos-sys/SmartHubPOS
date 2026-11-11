import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { isSuperAdmin } from "./access";

/** People who take one of a business's user places: active sign-in accounts of that business (Super Admin accounts and switched-off users do not count). */
export async function countBusinessUsers(ctx: QueryCtx, tenantId: Id<"tenants">): Promise<number> {
  const rows = await ctx.db.query("users").withIndex("by_tenant_username", (q) => q.eq("tenantId", tenantId)).collect();
  return rows.filter((u) => u.tokenIdentifier === undefined && (u.username !== undefined || u.email !== undefined) && u.isActive !== false && !isSuperAdmin(u)).length;
}

export async function businessUserQuota(ctx: QueryCtx, tenantId: Id<"tenants"> | undefined): Promise<{ used: number; max: number | null }> {
  if (!tenantId) return { used: 0, max: null };
  const tenant = await ctx.db.get("tenants", tenantId);
  return { used: await countBusinessUsers(ctx, tenantId), max: tenant?.maxUsers ?? null };
}

/** Refuses a new / re-activated user when the business has reached the limit the Super Admin set. */
export async function assertUserSeatFree(ctx: QueryCtx, tenantId: Id<"tenants"> | undefined) {
  if (!tenantId) return;
  const { used, max } = await businessUserQuota(ctx, tenantId);
  if (max !== null && used >= max) {
    throw new ConvexError(`Idadi ya watumiaji wa biashara hii imefika kikomo (${max}). Wasiliana na Super Admin akuongezee nafasi kabla ya kuongeza mtumiaji mwingine.`);
  }
}
