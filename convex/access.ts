import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { SUPER_ADMIN_ONLY_PERMISSIONS, SYSTEM_ROLES, USER_GRANTABLE_PERMISSIONS, effectiveModules, permissionsWithNewDefaults } from "./permissions";
import { planStatus, tzToday } from "./plans";

/** The parts of a user the access helpers read. A real user (Doc<"users">) fits; tests may pass a lighter object. */
export type UserLike = Partial<Pick<Doc<"users">, "_id" | "tenantId" | "branchId" | "role" | "isActive" | "name" | "username" | "email" | "menuAccess" | "extraPermissions" | "ownDataOnly" | "branchPicked" | "branchIds" | "allDepartments">>;
/**
 * Departments a user is limited to when he was given SEVERAL (e.g. Bar + Kitchen): he works in one at a time and may switch
 * only between these. null = no such list (one department, or all departments).
 */
export function allowedBranchIds(user: UserLike): Id<"branches">[] | null {
  return user.branchIds && user.branchIds.length > 1 ? user.branchIds : null;
}

/** Turns what the Users form sends (ticked departments / "all departments") into the fields stored on the user. */
export function resolveDepartmentAccess(a: { branchId?: Id<"branches">; branchIds?: Id<"branches">[]; allDepartments?: boolean }) {
  if (a.allDepartments) return { branchId: undefined, branchIds: undefined, allDepartments: true as const, branchPicked: false };
  const ids = [...new Set(a.branchIds ?? [])];
  if (ids.length === 0) return { branchId: undefined, branchIds: undefined, allDepartments: undefined, branchPicked: false };
  if (ids.length === 1) return { branchId: ids[0], branchIds: undefined, allDepartments: undefined, branchPicked: false };
  return { branchId: a.branchId && ids.includes(a.branchId) ? a.branchId : ids[0], branchIds: ids, allDepartments: undefined, branchPicked: true };
}

/** A user that may be missing (signed out / not found). */
export type MaybeUser = UserLike | null | undefined;
/** Any stored row that belongs to a business (and optionally a department). */
export type ScopedRecord = { tenantId?: Id<"tenants">; branchId?: Id<"branches"> };

/**
 * ROOT CAUSE NOTE (supplier "manager permission required" error):
 * Convex Auth's tokenIdentifier contains the *session id*, so it changes at every sign-in.
 * Profiles keyed by tokenIdentifier were re-created as default "viewer" on each login.
 * The profile is now the Convex Auth user document itself (stable across sessions).
 * Legacy tokenIdentifier lookup is kept only as a fallback for old data.
 */
export async function getCurrentProfile(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const authUserId = ctx.db.normalizeId("users", String(identity.subject ?? "").split("|")[0]);
  if (authUserId) {
    const doc = await ctx.db.get("users", authUserId);
    if (doc) return doc;
  }
  return await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
}

/**
 * `module` (optional) = the sidebar module the call belongs to ("payroll", "purchasing" ...). The call is refused when the
 * business did not pay for that module or the user's menu does not include it, so hiding a menu is also enforced on the server.
 */
export async function requireActiveUser(ctx: QueryCtx, module?: string, opts: { allowPasswordChange?: boolean } = {}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Unauthenticated");
  const user = await getCurrentProfile(ctx);
  if (!user || user.isActive === false) throw new ConvexError("Forbidden: active user account required");
  // A user told to change the password must do so first: the screen alone is not a protection, the server refuses everything else too.
  if (user.requirePasswordChange === true && !opts.allowPasswordChange) throw new ConvexError("Forbidden: password change required");
  // Users of a stopped business cannot use the system (Super Admin is never blocked).
  if (!isSuperAdmin(user) && user.tenantId) {
    const tenant = await ctx.db.get("tenants", user.tenantId);
    if (tenant && tenant.isActive === false) throw new ConvexError("Forbidden: business suspended");
    if (tenant && planStatus(tenant, tzToday()).expired) throw new ConvexError("Forbidden: subscription expired");
    if (module) {
      const allowed = effectiveModules(tenant?.modules, user.menuAccess);
      if (allowed && !allowed.includes(module)) throw new ConvexError("Forbidden: module not available for your account");
    }
  }
  return user;
}

/**
 * Staff mode: the user sees only his own sales/bills and a personal dashboard.
 * Managers/admins are never limited by this flag, whatever is stored on the account.
 */
export function isOwnDataOnly(user: MaybeUser) {
  return user?.ownDataOnly === true && !isSuperAdmin(user) && !MANAGER_ROLES.includes(normalizeRole(user?.role));
}

/** Normalize role labels coming from older deployments/imported users (e.g. "Super Admin"). */
export function normalizeRole(role: unknown) {
  return String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isSuperAdmin(user: MaybeUser) {
  return ["super_admin", "superadmin"].includes(normalizeRole(user?.role));
}

const MANAGER_ROLES = ["super_admin", "superadmin", "admin", "administrator", "manager", "owner", "business_owner"];
/** Non-throwing manager check (built-in manager roles or a custom role with "system.manager"). */
export async function isManagerRole(ctx: QueryCtx, user: MaybeUser) {
  if (MANAGER_ROLES.includes(normalizeRole(user?.role))) return true;
  return await roleHasPermission(ctx, user, "system.manager");
}

export async function requireManager(ctx: QueryCtx, module?: string) {
  const user = await requireActiveUser(ctx, module);
  const role = normalizeRole(user.role);
  if (!["super_admin", "superadmin", "admin", "administrator", "manager", "owner", "business_owner"].includes(role)) {
    // Custom roles created in Maintenance > Role Management may carry the "system.manager" permission.
    if (await roleHasPermission(ctx, user, "system.manager")) return user;
    throw new ConvexError("Forbidden: manager permission required");
  }
  return user;
}

/** Built-in permission defaults used until an administrator customizes a role. */
const ALL_PERMISSIONS_FOR_ADMIN = "*";
const BUILTIN_ROLE_PERMISSIONS: Record<string, string[]> = {
  ...Object.fromEntries(SYSTEM_ROLES.map((r) => [r.name, r.permissions])),
  administrator: SYSTEM_ROLES[0].permissions,
  owner: [ALL_PERMISSIONS_FOR_ADMIN],
  business_owner: [ALL_PERMISSIONS_FOR_ADMIN],
};

export async function roleHasPermission(ctx: QueryCtx, user: MaybeUser, permission: string) {
  if (isSuperAdmin(user)) return true;
  // A permission given to this one user directly (Users form), limited to the grantable list.
  if (user?.extraPermissions?.includes(permission) && USER_GRANTABLE_PERMISSIONS.some((g) => g.key === permission)) return true;
  const name = normalizeRole(user?.role);
  const row = await ctx.db.query("roles").withIndex("by_name", (q) => q.eq("name", name)).first();
  const perms: string[] = row ? permissionsWithNewDefaults(name, row.permissions, row.knownKeys) : BUILTIN_ROLE_PERMISSIONS[name] ?? [];
  // The "owner" wildcard never covers a permission that must be given on purpose (e.g. stock.adjust).
  return (perms.includes(ALL_PERMISSIONS_FOR_ADMIN) && !SUPER_ADMIN_ONLY_PERMISSIONS.includes(permission)) || perms.includes(permission);
}

export async function requirePermission(ctx: QueryCtx, permission: string, module?: string) {
  const user = await requireActiveUser(ctx, module);
  if (!(await roleHasPermission(ctx, user, permission))) throw new ConvexError(`Forbidden: permission "${permission}" required`);
  return user;
}

/**
 * Managers/admins always pass. Any other role passes when it was given `permission` (Role Management or the Users form),
 * so a custom role such as "Store keeper" with only `stock.manage` can work without being made a manager.
 */
export async function requireManagerOrPermission(ctx: QueryCtx, permission: string, module?: string) {
  const user = await requireActiveUser(ctx, module);
  if (await isManagerRole(ctx, user)) return user;
  if (await roleHasPermission(ctx, user, permission)) return user;
  throw new ConvexError(`Forbidden: manager permission required (or permission "${permission}")`);
}

export async function requireSuperAdminUser(ctx: QueryCtx) {
  const user = await requireActiveUser(ctx);
  if (!isSuperAdmin(user)) throw new ConvexError("Forbidden: Super Admin only");
  return user;
}

/**
 * Scope for writes. Normal users use their own office/branch. A Super Admin has no
 * fixed office, so the first active office/branch is used (or none during initial setup).
 */
export async function resolveWriteScope(ctx: QueryCtx, user: UserLike, opts: { tenantWide?: boolean } = {}): Promise<{ tenantId?: Id<"tenants">; branchId?: Id<"branches"> }> {
  if (!isSuperAdmin(user)) return await withDepartment(ctx, user, requireBusinessScope(user), opts);
  if (user.tenantId) return await withDepartment(ctx, user, user.branchId ? { tenantId: user.tenantId, branchId: user.branchId } : { tenantId: user.tenantId }, opts);
  const tenants = await ctx.db.query("tenants").withIndex("by_active", (q) => q.eq("isActive", true)).collect();
  if (!tenants.length) return {};
  // Never guess the business: with several businesses a Super Admin must pick one first, otherwise records could be saved into the wrong one.
  if (tenants.length > 1) throw new ConvexError("Chagua biashara (ofisi) unayofanyia kazi kwanza kabla ya kuhifadhi.");
  const tenant = tenants[0];
  const branches = await ctx.db.query("branches").withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id)).collect();
  const branch = branches.find((b) => b.isActive);
  return branch ? { tenantId: tenant._id, branchId: branch._id } : { tenantId: tenant._id };
}

/**
 * A business WITHOUT departments works exactly as before (no branch needed).
 * A business WITH departments (e.g. Bar, Lounge, Kitchen) keeps separate figures per department, so a user
 * who is not tied to one department must first choose where they are working before saving anything.
 */
async function withDepartment(ctx: QueryCtx, user: UserLike, scope: { tenantId?: Id<"tenants">; branchId?: Id<"branches"> }, opts: { tenantWide?: boolean }) {
  if (scope.branchId || opts.tenantWide || !scope.tenantId) return scope;
  const departments = await activeDepartments(ctx, scope.tenantId);
  if (departments.length > 0) throw new ConvexError("Chagua idara (sehemu) unayofanyia kazi kwenye menyu ya juu kabla ya kuhifadhi.");
  return scope;
}

export async function logAudit(ctx: MutationCtx, user: MaybeUser, entry: { action: string; module: string; details?: string; referenceId?: string; referenceType?: string; result?: string }) {
  await ctx.db.insert("auditLogs", {
    tenantId: user?.tenantId,
    userId: user?._id,
    userName: user?.name ?? user?.username ?? user?.email ?? "user",
    action: entry.action,
    module: entry.module,
    referenceId: entry.referenceId,
    referenceType: entry.referenceType,
    details: entry.details,
    timestamp: new Date().toISOString(),
    result: entry.result ?? "success",
  });
}

export function canAccessRecord(user: UserLike, record: ScopedRecord | null | undefined) {
  if (!record) return false;
  // Super Admin with a selected business only sees that business; with none selected (business picker) sees all.
  if (isSuperAdmin(user) && !user.tenantId) return true;
  if (!user.tenantId || record.tenantId !== user.tenantId) return false;
  if (user.branchId && record.branchId !== user.branchId) return false;
  return true;
}

export function filterScoped<T extends ScopedRecord>(user: UserLike, records: T[]): T[] {
  if (isSuperAdmin(user) && !user.tenantId) return records;
  if (!user.tenantId) return [];
  return records.filter((record) => record.tenantId === user.tenantId && (!user.branchId || record.branchId === user.branchId));
}

/**
 * Master data shared by the WHOLE business (suppliers): visible and usable from every department,
 * not only from the department it was typed in.
 */
export function canAccessBusinessRecord(user: UserLike, record: ScopedRecord | null | undefined) {
  if (!record) return false;
  if (isSuperAdmin(user) && !user.tenantId) return true;
  return !!user.tenantId && record.tenantId === user.tenantId;
}
export function filterBusiness<T extends ScopedRecord>(user: UserLike, records: T[]): T[] {
  if (isSuperAdmin(user) && !user.tenantId) return records;
  if (!user.tenantId) return [];
  return records.filter((record) => record.tenantId === user.tenantId);
}
/**
 * `table` is chosen at run time, so the per-table index types cannot be used here. Every table passed to the helpers
 * below has a `by_scope` index on [tenantId, branchId]; this is the one place that relies on that convention.
 */
interface ScopeRange { eq(field: string, value: unknown): ScopeRange }
interface ByScopeReader { withIndex(index: "by_scope", range: (q: ScopeRange) => unknown): { collect(): Promise<Doc<TableNames>[]> } }
const byScope = (ctx: QueryCtx, table: TableNames) => ctx.db.query(table) as unknown as ByScopeReader;

export async function businessRows<T extends TableNames>(ctx: QueryCtx, user: UserLike, table: T): Promise<Doc<T>[]> {
  if (isSuperAdmin(user) && !user.tenantId) return (await ctx.db.query(table).collect()) as unknown as Doc<T>[];
  if (!user.tenantId) return [];
  return (await byScope(ctx, table).withIndex("by_scope", (q) => q.eq("tenantId", user.tenantId)).collect()) as unknown as Doc<T>[];
}

export function requireBusinessScope(user: UserLike) {
  const superAdmin = isSuperAdmin(user);
  if (!user.tenantId) {
    throw new ConvexError(superAdmin ? "Super Admin lazima achague biashara kwa shughuli za biashara." : "Akaunti haijaunganishwa na ofisi (tenant).");
  }
  return user.branchId === undefined ? { tenantId: user.tenantId } : { tenantId: user.tenantId, branchId: user.branchId };
}

/**
 * Fast replacement for `filterScoped(user, await ctx.db.query(table).collect())`.
 * Reads ONLY the rows of the user's business (and of the chosen department when one is selected)
 * through the `by_scope` index, instead of loading every business's rows and filtering in memory.
 * This is what keeps the system light when many businesses and users share one database.
 */
export async function scopedRows<T extends TableNames>(ctx: QueryCtx, user: UserLike, table: T): Promise<Doc<T>[]> {
  if (isSuperAdmin(user) && !user.tenantId) return (await ctx.db.query(table).collect()) as unknown as Doc<T>[];
  if (!user.tenantId) return [];
  const byBranch = !!user.branchId && table !== "auditLogs";
  return (await byScope(ctx, table).withIndex("by_scope", (q) => (byBranch ? q.eq("tenantId", user.tenantId).eq("branchId", user.branchId) : q.eq("tenantId", user.tenantId))).collect()) as unknown as Doc<T>[];
}

/** Departments (locations such as Bar / Lounge / Kitchen) of a business. A business may have none. */
export async function activeDepartments(ctx: QueryCtx, tenantId: Id<"tenants"> | undefined): Promise<Doc<"branches">[]> {
  if (!tenantId) return [];
  const rows = await ctx.db.query("branches").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
  return rows.filter((b) => b.isActive);
}

/**
 * Company settings are business-wide; a department may override them. Prefer the department's own row,
 * otherwise fall back to the business-wide row.
 */
export async function getCompanySettings(ctx: QueryCtx, user: UserLike) {
  if (!user.tenantId) return null;
  const rows = await ctx.db.query("companySettings").withIndex("by_tenant", (q) => q.eq("tenantId", user.tenantId)).collect();
  return rows.find((r) => user.branchId && r.branchId === user.branchId) ?? rows.find((r) => !r.branchId) ?? rows[0] ?? null;
}
