import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Per-business switch "Bili za wateja" (tenantSettings.customerBillsEnabled).
 * A business saved before the switch existed has no value = ON, so nothing changes for it until a Super Admin turns it off.
 */
export function customerBillsEnabledFor(s: { customerBillsEnabled?: boolean } | null | undefined): boolean {
  return s?.customerBillsEnabled !== false;
}

export const CUSTOMER_BILLS_OFF_MESSAGE = "Biashara hii imezuiwa kutengeneza bili za wateja. Wasiliana na Super Admin.";

/** Throws when this business may not generate customer bills. Call at the start of every mutation that creates, prints or sends a bill. */
export async function requireCustomerBillsEnabled(ctx: QueryCtx, tenantId: Id<"tenants"> | string | undefined | null): Promise<void> {
  if (!tenantId) return; // Super Admin outside a business: nothing to check
  const settings = await ctx.db.query("tenantSettings").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId as Id<"tenants">)).first();
  if (!customerBillsEnabledFor(settings)) throw new ConvexError(CUSTOMER_BILLS_OFF_MESSAGE);
}
