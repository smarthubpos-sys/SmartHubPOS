import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentProfile, isSuperAdmin, normalizeRole } from "./access";

const LOGIN_DOMAIN = "@login.smarthub.invalid";

/** Profiles = Convex Auth user documents (no tokenIdentifier). Legacy per-session rows are ignored. */
function isProfile(row: Record<string, unknown>) {
  return row.tokenIdentifier === undefined && (row.username !== undefined || row.email !== undefined);
}

/**
 * Called after every sign-in. Makes sure the signed-in account has a stable role:
 *  - SUPER_ADMIN_USERNAME (Convex env var) is always Super Admin.
 *  - Old per-session profiles with the same username are migrated (role/office/branch).
 *  - If no Super Admin exists yet, this account becomes the first Super Admin.
 *  - Everyone else defaults to "viewer" until an administrator assigns a role.
 */
/**
 * Login screen helper (no sign-in yet): which sign-in identity belongs to this username INSIDE this business?
 * Returns only an internal, non-secret identity string. An unknown business or name returns a harmless identity that simply fails to sign in,
 * so nobody can use this to find out which businesses or users exist.
 */
export const resolveLoginEmail = query({
  args: { business: v.string(), username: v.string() },
  handler: async (ctx, a) => {
    const username = a.username.trim().toLowerCase();
    const code = a.business.trim().toUpperCase();
    const fallback = `${username}@unknown.${LOGIN_DOMAIN.slice(1)}`;
    if (!code || !username) return fallback;
    const tenant = await ctx.db.query("tenants").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (!tenant) return fallback;
    const user = await ctx.db.query("users").withIndex("by_tenant_username", (q) => q.eq("tenantId", tenant._id).eq("username", username)).first();
    return user && user.tokenIdentifier === undefined && user.email ? user.email : fallback;
  },
});

export const updateCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const current = await getCurrentProfile(ctx);
    if (!current) return null;

    const identityEmail = String(current.email ?? identity.email ?? "").trim().toLowerCase();
    const username = current.username ?? (identityEmail.endsWith(LOGIN_DOMAIN.slice(1)) ? identityEmail.slice(0, identityEmail.lastIndexOf("@")) : undefined);
    const businessScopedLogin = identityEmail.endsWith(`.${LOGIN_DOMAIN.slice(1)}`); // belongs to ONE business: never merge it with another business's old rows
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
      const source = businessScopedLogin ? undefined : legacy[0];
      const otherSuperAdmin = rows.some((r) => r._id !== current._id && isSuperAdmin(r) && r.isActive !== false);
      if (source?.role) {
        patch.role = source.role;
        if (source.tenantId) patch.tenantId = source.tenantId;
        if (source.branchId) patch.branchId = source.branchId;
        if (source.employeeId) patch.employeeId = source.employeeId;
        // Restrictions must travel with the profile; losing them would silently widen what the user may do.
        if (source.branchIds?.length) patch.branchIds = source.branchIds;
        if (source.allDepartments) patch.allDepartments = source.allDepartments;
        if (source.branchPicked !== undefined) patch.branchPicked = source.branchPicked;
        if (source.menuAccess) patch.menuAccess = source.menuAccess;
        if (source.extraPermissions?.length) patch.extraPermissions = source.extraPermissions;
        if (source.ownDataOnly) patch.ownDataOnly = source.ownDataOnly;
        patch.isActive = source.isActive ?? true;
      } else {
        patch.role = isConfiguredAdmin || !otherSuperAdmin ? "super_admin" : "viewer";
        patch.isActive = true;
      }
      patch.requirePasswordChange = current.requirePasswordChange ?? source?.requirePasswordChange ?? false;
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
    if (Object.keys(patch).length > 0) await ctx.db.patch("users", current._id, patch);
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
    if (!current || !isSuperAdmin(current)) throw new ConvexError("Forbidden: Super Admin only");
    return (await ctx.db.query("users").collect()).filter(isProfile);
  },
});
