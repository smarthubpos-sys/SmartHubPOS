import { mutation, query } from "./_generated/server";
import { getCurrentProfile, isSuperAdmin, normalizeRole } from "./access";

const LOGIN_DOMAIN = "@login.smarthub.invalid";

/** Profiles = Convex Auth user documents (no tokenIdentifier). Legacy per-session rows are ignored. */
function isProfile(row: any) {
  return row.tokenIdentifier === undefined && (row.username !== undefined || row.email !== undefined);
}

/**
 * Called after every sign-in. Makes sure the signed-in account has a stable role:
 *  - SUPER_ADMIN_USERNAME (Convex env var) is always Super Admin.
 *  - Old per-session profiles with the same username are migrated (role/office/branch).
 *  - If no Super Admin exists yet, this account becomes the first Super Admin.
 *  - Everyone else defaults to "viewer" until an administrator assigns a role.
 */
export const updateCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const current = await getCurrentProfile(ctx);
    if (!current) return null;

    const identityEmail = String(current.email ?? identity.email ?? "").trim().toLowerCase();
    const username = current.username ?? (identityEmail.endsWith(LOGIN_DOMAIN) ? identityEmail.slice(0, -LOGIN_DOMAIN.length) : undefined);
    const configuredAdmin = (process.env.SUPER_ADMIN_USERNAME ?? "").trim().toLowerCase();
    const isConfiguredAdmin = !!configuredAdmin && (username ?? "").toLowerCase() === configuredAdmin;

    const patch: Record<string, unknown> = {};
    if (username && current.username !== username) patch.username = username;
    if (!current.name && username) patch.name = username;

    if (current.role === undefined) {
      // One-time setup for a brand-new account only: the full users scan runs here (not on every login),
      // so normal logins read just their own row and never conflict with each other.
      const rows = await ctx.db.query("users").collect();
      // Migrate from a legacy per-session profile of the same username (prefer the most privileged).
      const legacy = rows
        .filter((r) => r.tokenIdentifier !== undefined && r._id !== current._id && username && r.username === username)
        .sort((a, b) => Number(isSuperAdmin(b)) - Number(isSuperAdmin(a)) || Number(!!b.tenantId) - Number(!!a.tenantId));
      const source = legacy[0];
      const otherSuperAdmin = rows.some((r) => r._id !== current._id && isSuperAdmin(r) && r.isActive !== false);
      if (source?.role) {
        patch.role = source.role;
        if (source.tenantId) patch.tenantId = source.tenantId;
        if (source.branchId) patch.branchId = source.branchId;
        if (source.employeeId) patch.employeeId = source.employeeId;
        patch.isActive = source.isActive ?? true;
      } else {
        patch.role = isConfiguredAdmin || !otherSuperAdmin ? "super_admin" : "viewer";
        patch.isActive = true;
      }
      patch.requirePasswordChange = current.requirePasswordChange ?? false;
    }
    if (isConfiguredAdmin && !isSuperAdmin({ role: (patch.role as string) ?? current.role })) {
      patch.role = "super_admin";
      patch.isActive = true;
    }
    // Keep stored role labels in canonical form (e.g. "Super Admin" -> "super_admin").
    const finalRole = (patch.role as string | undefined) ?? current.role;
    if (finalRole && normalizeRole(finalRole) !== finalRole) patch.role = normalizeRole(finalRole);

    // lastLogin is refreshed at most once an hour: writing it on every page load made concurrent logins collide.
    const lastSeen = current.lastLogin ? Date.parse(current.lastLogin) : 0;
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 3_600_000) patch.lastLogin = new Date().toISOString();
    if (Object.keys(patch).length > 0) await ctx.db.patch(current._id, patch);
    return current._id;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await getCurrentProfile(ctx);
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const current = await getCurrentProfile(ctx);
    if (!current || !isSuperAdmin(current)) throw new Error("Forbidden: Super Admin only");
    return (await ctx.db.query("users").collect()).filter(isProfile);
  },
});
