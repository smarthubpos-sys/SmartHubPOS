import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createAccount, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import {
  filterScoped, getCurrentProfile, isSuperAdmin, logAudit, normalizeRole, requireActiveUser, requirePermission,
  requireSuperAdminUser, resolveWriteScope, roleHasPermission, scopedRows } from "./access";
import type { UserLike } from "./access";
import { ALL_PERMISSION_KEYS, SETTING_KEYS, SYSTEM_ROLES, cleanModules } from "./permissions";

const LOGIN_DOMAIN = "login.smarthub.invalid";
const DEFAULT_SECURITY = { minPasswordLength: 10, sessionTimeoutMinutes: 30, requirePasswordChangeForNewUsers: true };

/**
 * Maintenance tools (backup, health check, clear data, assign unscoped) work on tables chosen at run time, so the
 * generated per-table types cannot describe them. This is the single, documented boundary where the database is
 * viewed through a loose interface; every call still passes the table name explicitly and Convex validates that the
 * id belongs to that table.
 */
type DynamicDoc = { _id: string } & Record<string, unknown>;
interface DynamicIndexRange { eq(field: string, value: unknown): DynamicIndexRange }
interface DynamicQuery {
  take(n: number): Promise<DynamicDoc[]>;
  collect(): Promise<DynamicDoc[]>;
  withIndex(index: string, range: (q: DynamicIndexRange) => unknown): DynamicQuery;
  paginate(opts: { numItems: number; cursor: string | null }): Promise<{ page: DynamicDoc[]; isDone: boolean; continueCursor: string }>;
}
interface DynamicDb {
  query(table: string): DynamicQuery;
  patch(table: string, id: string, value: Record<string, unknown>): Promise<void>;
  delete(table: string, id: string): Promise<void>;
}
const dynamicDb = (db: unknown): DynamicDb => db as DynamicDb;

/** JSON setting value: an object whose members are plain values, lists or small nested objects (3 levels is all the screens use). */
const jsonPrim = v.union(v.string(), v.number(), v.boolean(), v.null());
const jsonLeaf = v.union(jsonPrim, v.array(jsonPrim), v.record(v.string(), jsonPrim));
const settingValue = v.record(v.string(), v.union(jsonPrim, v.array(jsonLeaf), v.record(v.string(), jsonLeaf)));
type SettingsMap = Record<string, unknown> & { security?: Partial<typeof DEFAULT_SECURITY> };
async function readSettingsMap(ctx: QueryCtx, scope: { tenantId?: Id<"tenants">; branchId?: Id<"branches"> }) {
  const rows = (await ctx.db.query("appSettings").withIndex("by_scope", (q) => q.eq("tenantId", scope.tenantId)).collect()).filter((r) => r.branchId === scope.branchId);
  const out: SettingsMap = {};
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { /* ignore corrupt value */ } }
  return out;
}

async function securityPolicy(ctx: QueryCtx, user: UserLike) {
  const scope = await resolveWriteScope(ctx, user, { tenantWide: true }).catch(() => ({} as Awaited<ReturnType<typeof resolveWriteScope>>));
  const map = await readSettingsMap(ctx, scope);
  return { ...DEFAULT_SECURITY, ...(map.security ?? {}) };
}

/* ───────────────────────── Settings (company, system, hardware, tax, numbering, language, security) ───────────────────────── */

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true }).catch(() => ({} as Awaited<ReturnType<typeof resolveWriteScope>>));
    const company = (await scopedRows(ctx, user, "companySettings"))[0] ?? null;
    const app = await readSettingsMap(ctx, scope);
    const canEdit: Record<string, boolean> = {};
    for (const key of [...Object.values(SETTING_KEYS), "maintenance.company"]) canEdit[key] = await roleHasPermission(ctx, user, key);
    return { company, app, canEdit, hasOffice: !!scope.tenantId };
  },
});

export const saveCompany = mutation({
  args: {
    companyName: v.optional(v.string()), address: v.optional(v.string()), phone: v.optional(v.string()),
    email: v.optional(v.string()), taxId: v.optional(v.string()), website: v.optional(v.string()),
    logoUrl: v.optional(v.string()), currency: v.optional(v.string()), currencySymbol: v.optional(v.string()),
    decimalPlaces: v.optional(v.number()), taxRate: v.optional(v.number()), taxName: v.optional(v.string()),
    financialYearStart: v.optional(v.string()), invoicePrefix: v.optional(v.string()), purchasePrefix: v.optional(v.string()),
    allowNegativeStock: v.optional(v.boolean()), inventoryCostingMethod: v.optional(v.string()),
    traIntegrationEnabled: v.optional(v.boolean()), stockControlEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requirePermission(ctx, "maintenance.company");
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    if (args.decimalPlaces !== undefined && (args.decimalPlaces < 0 || args.decimalPlaces > 6)) throw new Error("Decimal places lazima iwe 0–6.");
    if (args.taxRate !== undefined && (args.taxRate < 0 || args.taxRate > 100)) throw new Error("Tax rate lazima iwe 0–100.");
    const patch = Object.fromEntries(Object.entries(args).filter(([, val]) => val !== undefined));
    const existing = (await scopedRows(ctx, user, "companySettings"))[0];
    let id;
    if (existing) { await ctx.db.patch("companySettings", existing._id, patch); id = existing._id; }
    else {
      id = await ctx.db.insert("companySettings", {
        companyName: "Your Business Name", currency: "TZS", currencySymbol: "TSh", decimalPlaces: 2,
        invoicePrefix: "INV-", purchasePrefix: "PUR-", allowNegativeStock: false, inventoryCostingMethod: "weighted_average",
        ...patch, ...scope,
      });
    }
    await logAudit(ctx, user, { action: "update_company_settings", module: "maintenance", details: Object.keys(patch).join(", ") });
    return id;
  },
});

export const saveSetting = mutation({
  args: { key: v.string(), value: settingValue },
  handler: async (ctx, args) => {
    const permission = SETTING_KEYS[args.key];
    if (!permission) throw new Error("Setting key haitambuliki.");
    const user = await requirePermission(ctx, permission);
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    const value = args.value ?? {};
    if (args.key === "security") {
      const s: { minPasswordLength?: unknown; sessionTimeoutMinutes?: unknown } = typeof value === "object" && value !== null ? value : {};
      if (!(typeof s.minPasswordLength === "number" && s.minPasswordLength >= 8 && s.minPasswordLength <= 64)) throw new Error("Urefu wa password uwe 8–64.");
      if (!(typeof s.sessionTimeoutMinutes === "number" && s.sessionTimeoutMinutes >= 0 && s.sessionTimeoutMinutes <= 1440)) throw new Error("Session timeout iwe 0–1440 dakika (0 = imezimwa).");
    }
    if (args.key === "language" && !["sw", "en"].includes(String((typeof value === "object" && value !== null ? (value as { language?: unknown }).language : undefined)))) throw new Error("Lugha lazima iwe sw au en.");
    const rows = (await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", args.key)).collect())
      .filter((r) => r.tenantId === scope.tenantId && r.branchId === scope.branchId);
    const doc = { value: JSON.stringify(value), updatedAt: new Date().toISOString(), updatedBy: user._id };
    if (rows[0]) await ctx.db.patch("appSettings", rows[0]._id, doc);
    else await ctx.db.insert("appSettings", { ...scope, key: args.key, ...doc });
    await logAudit(ctx, user, { action: `update_${args.key}_settings`, module: "maintenance" });
    return true;
  },
});

/* ───────────────────────── Financial periods ───────────────────────── */

export const listPeriods = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await scopedRows(ctx, user, "financialPeriods")).sort((a, b) => b.startDate.localeCompare(a.startDate));
  },
});

const iso = (d: Date) => d.toISOString().slice(0, 10);

export const createPeriod = mutation({
  args: { name: v.string(), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "maintenance.periods");
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    if (!a.name.trim()) throw new Error("Jina la period linahitajika.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(a.endDate)) throw new Error("Tarehe si sahihi.");
    if (a.endDate < a.startDate) throw new Error("Tarehe ya mwisho lazima iwe baada ya ya mwanzo.");
    const overlap = (await scopedRows(ctx, user, "financialPeriods")).find((p) => a.startDate <= p.endDate && a.endDate >= p.startDate);
    if (overlap) throw new Error(`Period inagongana na "${overlap.name}".`);
    const id = await ctx.db.insert("financialPeriods", { ...scope, name: a.name.trim(), startDate: a.startDate, endDate: a.endDate, status: "open" });
    await logAudit(ctx, user, { action: "create_period", module: "maintenance", referenceId: String(id), details: a.name });
    return id;
  },
});

/** Creates 12 monthly periods for a calendar/financial year starting on the given month (1-12). */
export const generateYear = mutation({
  args: { year: v.number(), startMonth: v.number() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "maintenance.periods");
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    if (a.year < 2000 || a.year > 2100 || a.startMonth < 1 || a.startMonth > 12) throw new Error("Mwaka au mwezi si sahihi.");
    const existing = (await scopedRows(ctx, user, "financialPeriods"));
    let created = 0;
    for (let i = 0; i < 12; i++) {
      const start = new Date(Date.UTC(a.year, a.startMonth - 1 + i, 1));
      const end = new Date(Date.UTC(a.year, a.startMonth + i, 0));
      const startDate = iso(start), endDate = iso(end);
      if (existing.some((p) => startDate <= p.endDate && endDate >= p.startDate)) continue;
      const name = start.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
      await ctx.db.insert("financialPeriods", { ...scope, name, startDate, endDate, status: "open" });
      created++;
    }
    await logAudit(ctx, user, { action: "generate_periods", module: "maintenance", details: `${a.year} (+${created})` });
    return created;
  },
});

export const setPeriodStatus = mutation({
  args: { id: v.id("financialPeriods"), status: v.union(v.literal("open"), v.literal("closed"), v.literal("locked")) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "maintenance.periods");
    const period = await ctx.db.get("financialPeriods", a.id);
    if (!period) throw new Error("Period haipo.");
    if (!isSuperAdmin(user) && (!user.tenantId || period.tenantId !== user.tenantId)) throw new Error("Forbidden: period nje ya ofisi yako.");
    if (period.status === "locked" && !isSuperAdmin(user)) throw new Error("Period iliyofungwa (locked) inafunguliwa na Super Admin tu.");
    await ctx.db.patch("financialPeriods", a.id, a.status === "open"
      ? { status: "open", closedBy: undefined, closedAt: undefined }
      : { status: a.status, closedBy: user._id, closedAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: `period_${a.status}`, module: "maintenance", referenceId: String(a.id), details: period.name });
    return true;
  },
});

export const deletePeriod = mutation({
  args: { id: v.id("financialPeriods") },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "maintenance.periods");
    const period = await ctx.db.get("financialPeriods", a.id);
    if (!period) return false;
    if (!isSuperAdmin(user) && (!user.tenantId || period.tenantId !== user.tenantId)) throw new Error("Forbidden: period nje ya ofisi yako.");
    if (period.status !== "open") throw new Error("Futa period iliyo 'open' tu.");
    await ctx.db.delete("financialPeriods", a.id);
    await logAudit(ctx, user, { action: "delete_period", module: "maintenance", details: period.name });
    return true;
  },
});

/* ───────────────────────── Roles ───────────────────────── */

export const listRoles = query({
  args: {},
  handler: async (ctx) => {
    await requireActiveUser(ctx);
    const rows = await ctx.db.query("roles").collect();
    const byName = new Map(rows.map((r) => [r.name, r]));
    const system = SYSTEM_ROLES.map((r) => {
      const row = byName.get(r.name);
      return { name: r.name, displayName: row?.displayName ?? r.displayName, permissions: row?.permissions ?? r.permissions, isSystem: true, customized: !!row };
    });
    const custom = rows.filter((r) => !SYSTEM_ROLES.some((s) => s.name === r.name))
      .map((r) => ({ name: r.name, displayName: r.displayName, permissions: r.permissions, isSystem: false, customized: true }));
    return [...system, ...custom];
  },
});

export const saveRole = mutation({
  args: { name: v.string(), displayName: v.string(), permissions: v.array(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "maintenance.roles");
    const name = normalizeRole(a.name);
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(name)) throw new Error("Jina la role: herufi ndogo/namba/underscore (2–31), likianza na herufi.");
    if (["super_admin", "superadmin"].includes(name)) throw new Error("Role ya Super Admin imehifadhiwa na haiwezi kubadilishwa.");
    if (!a.displayName.trim()) throw new Error("Display name inahitajika.");
    const bad = a.permissions.filter((p) => !ALL_PERMISSION_KEYS.includes(p));
    if (bad.length) throw new Error(`Permission zisizojulikana: ${bad.join(", ")}`);
    const permissions = [...new Set(a.permissions)];
    const existing = await ctx.db.query("roles").withIndex("by_name", (q) => q.eq("name", name)).first();
    const isSystem = SYSTEM_ROLES.some((r) => r.name === name);
    if (existing) await ctx.db.patch("roles", existing._id, { displayName: a.displayName.trim(), permissions });
    else await ctx.db.insert("roles", { name, displayName: a.displayName.trim(), permissions, isSystem });
    await logAudit(ctx, user, { action: "save_role", module: "maintenance", referenceId: name, details: `${permissions.length} permissions` });
    return name;
  },
});

export const deleteRole = mutation({
  args: { name: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "maintenance.roles");
    const name = normalizeRole(a.name);
    const inUse = (await ctx.db.query("users").collect()).some((u) => u.tokenIdentifier === undefined && normalizeRole(u.role) === name);
    if (inUse) throw new Error("Role hii inatumika na watumiaji. Wabadilishie role kwanza.");
    const existing = await ctx.db.query("roles").withIndex("by_name", (q) => q.eq("name", name)).first();
    if (!existing) return false;
    await ctx.db.delete("roles", existing._id); // for system roles this resets them to built-in defaults
    await logAudit(ctx, user, { action: "delete_role", module: "maintenance", referenceId: name });
    return true;
  },
});

/* ───────────────────────── Users ───────────────────────── */

/** Keeps only modules the business actually has (the Super Admin decides that per business). */
async function allowedMenu(ctx: QueryCtx, tenantId: Id<"tenants"> | undefined, wanted: string[]) {
  const tenant = tenantId ? await ctx.db.get("tenants", tenantId) : null;
  const keys = cleanModules(wanted);
  return tenant?.modules ? keys.filter((k) => (tenant.modules as string[]).includes(k)) : keys;
}

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "maintenance.users");
    const rows = (await ctx.db.query("users").collect()).filter((r) => r.tokenIdentifier === undefined && (r.username !== undefined || r.email !== undefined));
    const visible = isSuperAdmin(user) ? rows : rows.filter((r) => r.tenantId && r.tenantId === user.tenantId);
    return visible.map((r) => ({ _id: r._id, name: r.name, username: r.username, role: r.role ?? "viewer", tenantId: r.tenantId, branchId: r.branchId, isActive: r.isActive !== false, requirePasswordChange: !!r.requirePasswordChange, lastLogin: r.lastLogin, menuAccess: r.menuAccess ?? null, ownDataOnly: r.ownDataOnly === true }));
  },
});

export const listOffices = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    const tenants = (await ctx.db.query("tenants").collect()).filter((t) => isSuperAdmin(user) || t._id === user.tenantId);
    const branches = (await ctx.db.query("branches").collect()).filter((b) => tenants.some((t) => t._id === b.tenantId));
    return { tenants, branches };
  },
});

async function assertCanAssign(ctx: QueryCtx, actor: UserLike, target: { role?: string; tenantId?: Id<"tenants">; branchId?: Id<"branches"> }, existing?: UserLike | null) {
  const role = target.role === undefined ? undefined : normalizeRole(target.role);
  if (role && ["super_admin", "superadmin"].includes(role) && !isSuperAdmin(actor)) throw new Error("Super Admin pekee ndiye anaweza kutoa role ya Super Admin.");
  if (existing && isSuperAdmin(existing) && !isSuperAdmin(actor)) throw new Error("Huwezi kubadilisha akaunti ya Super Admin.");
  if (role && !["super_admin", "superadmin"].includes(role)) {
    const known = SYSTEM_ROLES.some((r) => r.name === role) || (await ctx.db.query("roles").withIndex("by_name", (q) => q.eq("name", role)).first());
    if (!known) throw new Error(`Role "${role}" haipo.`);
  }
  if (!isSuperAdmin(actor)) {
    const tenantId = target.tenantId ?? actor.tenantId;
    if (!actor.tenantId || tenantId !== actor.tenantId) throw new Error("Unaweza kusimamia watumiaji wa ofisi yako tu.");
  }
  if (target.branchId) {
    const branch = await ctx.db.get("branches", target.branchId);
    const tenantId = target.tenantId ?? actor.tenantId;
    if (!branch || (tenantId && branch.tenantId !== tenantId)) throw new Error("Branch haihusiani na ofisi iliyochaguliwa.");
  }
}

export const updateUser = mutation({
  args: {
    userId: v.id("users"), name: v.optional(v.string()), role: v.optional(v.string()),
    tenantId: v.optional(v.id("tenants")), branchId: v.optional(v.id("branches")), clearBranch: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()), requirePasswordChange: v.optional(v.boolean()),
    menuAccess: v.optional(v.array(v.string())), clearMenuAccess: v.optional(v.boolean()), ownDataOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const actor = await requirePermission(ctx, "maintenance.users");
    const target = await ctx.db.get("users", a.userId);
    if (!target || target.tokenIdentifier !== undefined) throw new Error("Mtumiaji hapatikani.");
    await assertCanAssign(ctx, actor, { role: a.role, tenantId: a.tenantId ?? target.tenantId, branchId: a.branchId }, target);
    if (String(actor._id) === String(target._id)) {
      if (a.isActive === false) throw new Error("Huwezi kuzima akaunti yako mwenyewe.");
      if (a.role !== undefined && normalizeRole(a.role) !== normalizeRole(target.role)) throw new Error("Huwezi kubadilisha role yako mwenyewe.");
    }
    if (isSuperAdmin(target) && (a.isActive === false || (a.role !== undefined && !isSuperAdmin({ role: a.role })))) {
      const others = (await ctx.db.query("users").collect()).filter((u) => u._id !== target._id && u.tokenIdentifier === undefined && isSuperAdmin(u) && u.isActive !== false);
      if (!others.length) throw new Error("Lazima abaki angalau Super Admin mmoja aliye active.");
    }
    const patch: Record<string, unknown> = {};
    if (a.name !== undefined) patch.name = a.name.trim();
    if (a.role !== undefined) patch.role = normalizeRole(a.role);
    if (a.tenantId !== undefined) patch.tenantId = a.tenantId;
    if (a.branchId !== undefined) { patch.branchId = a.branchId; patch.branchPicked = false; }
    if (a.clearBranch) { patch.branchId = undefined; patch.branchPicked = false; }
    if (a.isActive !== undefined) patch.isActive = a.isActive;
    if (a.requirePasswordChange !== undefined) patch.requirePasswordChange = a.requirePasswordChange;
    if (a.menuAccess !== undefined || a.clearMenuAccess || a.ownDataOnly !== undefined) {
      if (String(actor._id) === String(target._id)) throw new Error("Huwezi kubadilisha menyu au ruhusa za data za akaunti yako mwenyewe.");
      if (isSuperAdmin(target)) throw new Error("Huwezi kubadilisha menyu ya Super Admin.");
    }
    if (a.clearMenuAccess) patch.menuAccess = undefined;
    else if (a.menuAccess !== undefined) patch.menuAccess = await allowedMenu(ctx, a.tenantId ?? target.tenantId, a.menuAccess);
    if (a.ownDataOnly !== undefined) patch.ownDataOnly = a.ownDataOnly ? true : undefined;
    await ctx.db.patch("users", a.userId, patch);
    await logAudit(ctx, actor, { action: "update_user", module: "maintenance", referenceId: String(a.userId), referenceType: "user", details: `${target.username ?? target.name}: ${Object.keys(patch).join(", ")}` });
    return true;
  },
});

export const authorizeUserAdmin = internalQuery({
  args: { targetUserId: v.optional(v.id("users")), role: v.optional(v.string()), tenantId: v.optional(v.id("tenants")), branchId: v.optional(v.id("branches")) },
  handler: async (ctx, a) => {
    const actor = await requirePermission(ctx, "maintenance.users");
    const target = a.targetUserId ? await ctx.db.get("users", a.targetUserId) : undefined;
    if (a.targetUserId && (!target || target.tokenIdentifier !== undefined)) throw new Error("Mtumiaji hapatikani.");
    await assertCanAssign(ctx, actor, { role: a.role, tenantId: a.tenantId ?? target?.tenantId, branchId: a.branchId }, target);
    const policy = await securityPolicy(ctx, actor);
    return { actorId: actor._id, minLength: policy.minPasswordLength as number, forceChange: !!policy.requirePasswordChangeForNewUsers, email: target?.email as string | undefined, username: target?.username as string | undefined, actorTenantId: actor.tenantId };
  },
});

export const finishUserSetup = internalMutation({
  args: { userId: v.id("users"), actorId: v.id("users"), name: v.string(), username: v.string(), role: v.string(), tenantId: v.optional(v.id("tenants")), branchId: v.optional(v.id("branches")), requirePasswordChange: v.boolean(), menuAccess: v.optional(v.array(v.string())), ownDataOnly: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    await ctx.db.patch("users", a.userId, {
      name: a.name, username: a.username, role: normalizeRole(a.role), tenantId: a.tenantId, branchId: a.branchId, isActive: true, requirePasswordChange: a.requirePasswordChange,
      menuAccess: a.menuAccess ? await allowedMenu(ctx, a.tenantId, a.menuAccess) : undefined, ownDataOnly: a.ownDataOnly ? true : undefined,
    });
    const actor = await ctx.db.get("users", a.actorId);
    await logAudit(ctx, actor, { action: "create_user", module: "maintenance", referenceId: String(a.userId), referenceType: "user", details: `${a.username} (${a.role})` });
  },
});

export const logUserEvent = internalMutation({
  args: { actorId: v.id("users"), action: v.string(), details: v.string(), result: v.optional(v.string()) },
  handler: async (ctx, a) => { await logAudit(ctx, await ctx.db.get("users", a.actorId), { action: a.action, module: "maintenance", details: a.details, result: a.result }); },
});

export const createUser = action({
  args: {
    name: v.string(), username: v.string(), password: v.string(), role: v.string(),
    tenantId: v.optional(v.id("tenants")), branchId: v.optional(v.id("branches")),
    menuAccess: v.optional(v.array(v.string())), ownDataOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, a): Promise<string> => {
    const username = a.username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error("Username: herufi ndogo/namba 3–32, bila nafasi.");
    const auth = await ctx.runQuery(internal.maintenance.authorizeUserAdmin, { role: a.role, tenantId: a.tenantId, branchId: a.branchId });
    if (a.password.length < auth.minLength) throw new Error(`Password iwe angalau herufi ${auth.minLength}.`);
    const tenantId = a.tenantId ?? auth.actorTenantId;
    if (!["super_admin", "superadmin"].includes(normalizeRole(a.role)) && !tenantId) throw new Error("Chagua ofisi kwa mtumiaji huyu.");
    const email = `${username}@${LOGIN_DOMAIN}`;
    const { user } = await createAccount(ctx, {
      provider: "password", account: { id: email, secret: a.password },
      profile: { email, name: a.name.trim() || username, username },
    });
    await ctx.runMutation(internal.maintenance.finishUserSetup, {
      userId: user._id, actorId: auth.actorId, name: a.name.trim() || username, username, role: a.role,
      tenantId, branchId: a.branchId, requirePasswordChange: auth.forceChange, menuAccess: a.menuAccess, ownDataOnly: a.ownDataOnly,
    });
    return String(user._id);
  },
});

export const resetUserPassword = action({
  args: { userId: v.id("users"), newPassword: v.string() },
  handler: async (ctx, a) => {
    const auth = await ctx.runQuery(internal.maintenance.authorizeUserAdmin, { targetUserId: a.userId });
    if (a.newPassword.length < auth.minLength) throw new Error(`Password iwe angalau herufi ${auth.minLength}.`);
    const email = auth.email ?? (auth.username ? `${auth.username}@${LOGIN_DOMAIN}` : undefined);
    if (!email) throw new Error("Mtumiaji huyu hana account ya password.");
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: email, secret: a.newPassword } });
    await invalidateSessions(ctx, { userId: a.userId });
    await ctx.runMutation(internal.maintenance.logUserEvent, { actorId: auth.actorId, action: "reset_password", details: auth.username ?? email });
    return true;
  },
});

export const changeOwnPassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, a) => {
    const me = await ctx.runQuery(internal.maintenance.whoAmI, {});
    if (a.newPassword.length < me.minLength) throw new Error(`Password mpya iwe angalau herufi ${me.minLength}.`);
    if (a.newPassword === a.currentPassword) throw new Error("Password mpya lazima itofautiane na ya sasa.");
    try {
      await retrieveAccount(ctx, { provider: "password", account: { id: me.email, secret: a.currentPassword } });
    } catch {
      throw new Error("Password ya sasa si sahihi.");
    }
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: me.email, secret: a.newPassword } });
    await ctx.runMutation(internal.maintenance.markPasswordChanged, { userId: me.userId });
    return true;
  },
});

export const whoAmI = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    const policy = await securityPolicy(ctx, user);
    const email = user.email ?? (user.username ? `${user.username}@${LOGIN_DOMAIN}` : undefined);
    if (!email) throw new Error("Akaunti haina login ya password.");
    return { userId: user._id, email, minLength: policy.minPasswordLength as number };
  },
});

export const markPasswordChanged = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, a) => {
    await ctx.db.patch("users", a.userId, { requirePasswordChange: false });
    await logAudit(ctx, await ctx.db.get("users", a.userId), { action: "change_own_password", module: "maintenance" });
  },
});

/* ───────────────────────── Audit trail ───────────────────────── */

export const listAudit = query({
  args: { module: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "maintenance.audit.view");
    const limit = Math.min(Math.max(a.limit ?? 300, 1), 1000);
    // Read through the (tenantId, timestamp) index so a business only ever scans its OWN logs; before, the newest logs of
    // every business were loaded and then filtered, so with many businesses a manager could see few or no rows.
    const mod = a.module;
    if (isSuperAdmin(user)) {
      const q = ctx.db.query("auditLogs").withIndex("by_timestamp").order("desc");
      return await (mod ? q.filter((f) => f.eq(f.field("module"), mod)) : q).take(limit);
    }
    if (!user.tenantId) return [];
    const tenantId = user.tenantId;
    const q = ctx.db.query("auditLogs").withIndex("by_scope", (i) => i.eq("tenantId", tenantId)).order("desc");
    return await (mod ? q.filter((f) => f.eq(f.field("module"), mod)) : q).take(limit);
  },
});

/* ───────────────────────── Backup (export) ───────────────────────── */

export const BACKUP_TABLES = [
  "tenants", "branches", "tenantSettings", "users", "roles", "companySettings", "financialPeriods", "appSettings", "paymentMethods",
  "productGroups", "unitsOfMeasure", "products", "purchasePriceHistory", "suppliers", "purchaseSequences",
  "purchases", "purchaseLines", "purchaseOrders", "purchaseOrderLines", "goodsReceivedNotes", "grnLines",
  "supplierPayments", "purchaseReturns", "purchaseReturnLines", "clients", "invoices", "invoiceLines",
  "customerPayments", "salesReturns", "stockMovements", "stockAdjustments", "employees", "attendance",
  "payrollPeriods", "payrollRecords", "accounts", "journalEntries", "journalLines", "expenses", "auditLogs",
] as const;

export const backupTables = query({
  args: {},
  handler: async (ctx) => { await requireSuperAdminUser(ctx); return [...BACKUP_TABLES]; },
});

/** Paged export of one table. Password hashes/sessions (auth* tables) are never exported. */
export const exportTable = query({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    await requireSuperAdminUser(ctx);
    if (!(BACKUP_TABLES as readonly string[]).includes(a.table)) throw new Error("Table hairuhusiwi.");
    const page = await dynamicDb(ctx.db).query(a.table).paginate({ numItems: 400, cursor: a.cursor });
    return { rows: page.page, isDone: page.isDone, cursor: page.continueCursor };
  },
});

export const recordBackup = mutation({
  args: { tables: v.number(), rows: v.number() },
  handler: async (ctx, a) => {
    const user = await requireSuperAdminUser(ctx);
    await logAudit(ctx, user, { action: "backup_export", module: "maintenance", details: `${a.tables} tables, ${a.rows} rows` });
  },
});

/* ───────────────────────── Database maintenance ───────────────────────── */

const SCOPED_TABLES = [
  "suppliers", "products", "clients", "productGroups", "unitsOfMeasure", "purchases", "purchaseOrders", "goodsReceivedNotes",
  "supplierPayments", "purchaseReturns", "invoices", "customerPayments", "stockMovements", "stockAdjustments",
  "employees", "accounts", "expenses", "companySettings", "financialPeriods",
] as const;

export const healthCheck = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdminUser(ctx);
    const counts: { table: string; count: number; capped: boolean }[] = [];
    for (const t of BACKUP_TABLES) {
      const rows = await dynamicDb(ctx.db).query(t).take(5001);
      counts.push({ table: t, count: Math.min(rows.length, 5000), capped: rows.length > 5000 });
    }
    const unscoped: { table: string; count: number }[] = [];
    for (const t of SCOPED_TABLES) {
      const rows = await dynamicDb(ctx.db).query(t).take(2000);
      const n = rows.filter((r) => r.tenantId === undefined).length;
      if (n) unscoped.push({ table: t, count: n });
    }
    const users = await ctx.db.query("users").collect();
    const profiles = users.filter((u) => u.tokenIdentifier === undefined && (u.username !== undefined || u.email !== undefined));
    const suppliers = await ctx.db.query("suppliers").take(2000);
    const seen = new Map<string, number>();
    for (const s of suppliers) seen.set(s.code, (seen.get(s.code) ?? 0) + 1);
    return {
      counts, unscoped,
      legacyProfiles: users.filter((u) => u.tokenIdentifier !== undefined).length,
      usersWithoutRole: profiles.filter((u) => !u.role).length,
      usersWithoutOffice: profiles.filter((u) => !isSuperAdmin(u) && !u.tenantId).length,
      duplicateSupplierCodes: [...seen.entries()].filter(([, n]) => n > 1).map(([code]) => code),
      superAdmins: profiles.filter((u) => isSuperAdmin(u) && u.isActive !== false).length,
    };
  },
});

/** Attach legacy records that have no office/branch to the Super Admin's default office/branch (batched). */
export const assignUnscoped = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireSuperAdminUser(ctx);
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    if (!scope.tenantId) throw new Error("Unda ofisi kwanza (Super Admin > Ofisi) kisha jaribu tena.");
    let updated = 0;
    for (const t of SCOPED_TABLES) {
      if (updated >= 400) break;
      const rows = await dynamicDb(ctx.db).query(t).take(500);
      for (const r of rows) {
        if (r.tenantId !== undefined || updated >= 400) continue;
        await dynamicDb(ctx.db).patch(t, r._id, { ...scope });
        updated++;
      }
    }
    await logAudit(ctx, user, { action: "assign_unscoped_records", module: "maintenance", details: `${updated} records` });
    return { updated, more: updated >= 400 };
  },
});

export const purgeAuditLogs = mutation({
  args: { olderThanDays: v.number() },
  handler: async (ctx, a) => {
    const user = await requireSuperAdminUser(ctx);
    if (!(a.olderThanDays >= 30)) throw new Error("Futa logs zilizo za zaidi ya siku 30 tu.");
    const cutoff = new Date(Date.now() - a.olderThanDays * 86400000).toISOString();
    const old = await ctx.db.query("auditLogs").withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff)).take(500);
    for (const r of old) await ctx.db.delete("auditLogs", r._id);
    await logAudit(ctx, user, { action: "purge_audit_logs", module: "maintenance", details: `${old.length} older than ${a.olderThanDays} days` });
    return { deleted: old.length, more: old.length === 500 };
  },
});

/* ───────────────────────── Clear Data File (Super Admin + Super Admin password) ───────────────────────── */

type ClearStep = { table: string; children?: { table: string; index: string; field: string }[]; via?: "clients" | "products"; resetStock?: boolean; resetBalances?: boolean };
type ClearCategory = { label: string; description: string; steps: ClearStep[]; resetSequences?: ("salesSequences" | "purchaseSequences")[]; rebuildStats?: boolean };

/** What the Super Admin can wipe. Child tables (lines) are removed together with their parent record. */
export const CLEAR_CATEGORIES: Record<string, ClearCategory> = {
  invoices: {
    label: "Sales Invoices", description: "Invoices za mauzo, mistari yake, malipo ya wateja na sales returns",
    steps: [
      { table: "customerPayments" },
      { table: "salesReturns", via: "clients" },
      { table: "invoices", children: [{ table: "invoiceLines", index: "by_invoice", field: "invoiceId" }] },
    ],
    resetSequences: ["salesSequences"], rebuildStats: true,
  },
  purchases: {
    label: "Purchases", description: "Manunuzi, purchase orders, GRN, malipo ya suppliers na purchase returns",
    steps: [
      { table: "supplierPayments" },
      { table: "purchaseReturns", children: [{ table: "purchaseReturnLines", index: "by_return", field: "returnId" }] },
      { table: "goodsReceivedNotes", children: [{ table: "grnLines", index: "by_grn", field: "grnId" }] },
      { table: "purchaseOrders", children: [{ table: "purchaseOrderLines", index: "by_order", field: "orderId" }] },
      { table: "purchases", children: [{ table: "purchaseLines", index: "by_purchase", field: "purchaseId" }] },
      { table: "purchasePriceHistory", via: "products" },
    ],
    resetSequences: ["purchaseSequences"], rebuildStats: true,
  },
  suppliers: { label: "Suppliers", description: "Orodha ya suppliers wote", steps: [{ table: "suppliers" }] },
  customers: { label: "Customers", description: "Orodha ya wateja wote (clients)", steps: [{ table: "salesReturns", via: "clients" }, { table: "clients" }], rebuildStats: true },
  stock: {
    label: "Stock", description: "Stock movements, stock adjustments, na kuweka idadi ya bidhaa zote kuwa 0",
    steps: [{ table: "stockMovements" }, { table: "stockAdjustments" }, { table: "products", resetStock: true }], rebuildStats: true,
  },
  products: {
    label: "Products", description: "Bidhaa zote, makundi (groups) na units",
    steps: [{ table: "purchasePriceHistory", via: "products" }, { table: "products" }, { table: "productGroups" }, { table: "unitsOfMeasure" }], rebuildStats: true,
  },
  transactions: {
    label: "Transaction Files", description: "Journal entries, expenses, capital receipts, bills za gharama na salio la accounts kuwa 0",
    steps: [
      { table: "journalLines" }, { table: "journalEntries" }, { table: "expenses" }, { table: "capitalReceipts" },
      { table: "billPayments" }, { table: "bills" }, { table: "accounts", resetBalances: true },
    ],
    rebuildStats: true,
  },
  auditLogs: { label: "Audit Logs", description: "Kumbukumbu zote za shughuli (audit trail)", steps: [{ table: "auditLogs" }] },
};

const CLEAR_BATCH = 60;

/** Super Admin check + selected business, used by the clear action before it asks for the password. */
export const authorizeClear = internalQuery({
  args: { categories: v.array(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireSuperAdminUser(ctx);
    if (!user.tenantId) throw new Error("Chagua biashara kwanza kabla ya kufuta data.");
    if (!a.categories.length) throw new Error("Chagua angalau kundi moja la data.");
    const unknown = a.categories.filter((c) => !CLEAR_CATEGORIES[c]);
    if (unknown.length) throw new Error(`Kundi lisilojulikana: ${unknown.join(", ")}`);
    const email = user.email ?? (user.username ? `${user.username}@${LOGIN_DOMAIN}` : undefined);
    if (!email) throw new Error("Akaunti haina login ya password.");
    const tenant = await ctx.db.get("tenants", user.tenantId);
    return { actorId: user._id, tenantId: user.tenantId, email, tenantName: tenant?.name ?? "" };
  },
});

/** Deletes up to one batch of a single step for one business. Returns `done: true` once the step has nothing left. */
export const clearStepBatch = internalMutation({
  args: { actorId: v.id("users"), tenantId: v.id("tenants"), category: v.string(), step: v.number() },
  handler: async (ctx, a) => {
    const actor = await ctx.db.get("users", a.actorId);
    if (!actor || !isSuperAdmin(actor) || actor.isActive === false) throw new Error("Forbidden: Super Admin only");
    const step = CLEAR_CATEGORIES[a.category]?.steps[a.step];
    if (!step) throw new Error("Hatua haipo.");
    const db = dynamicDb(ctx.db);
    let deleted = 0;

    const removeWithChildren = async (doc: DynamicDoc) => {
      for (const c of step.children ?? []) {
        const kids = await db.query(c.table).withIndex(c.index, (q) => q.eq(c.field, doc._id)).collect();
        for (const k of kids) await db.delete(c.table, k._id);
      }
      await db.delete(step.table, doc._id);
    };

    if (step.via) {
      // Tables without their own tenantId: reach them through the business's clients / products.
      const [childTable, index, field] = step.table === "salesReturns" ? ["salesReturns", "by_client", "clientId"] : ["purchasePriceHistory", "by_product", "productId"];
      const parents = await db.query(step.via).withIndex("by_scope", (q) => q.eq("tenantId", a.tenantId)).collect();
      for (const p of parents) {
        const rows = await db.query(childTable).withIndex(index, (q) => q.eq(field, p._id)).take(200);
        for (const r of rows) { await db.delete(childTable, r._id); deleted++; }
        if (deleted >= 400) return { done: false, deleted };
      }
      return { done: true, deleted };
    }

    if (step.resetStock || step.resetBalances) {
      const rows = await db.query(step.table).withIndex("by_scope", (q) => q.eq("tenantId", a.tenantId)).collect();
      for (const r of rows) {
        if (step.resetStock && (r.currentQty !== 0 || r.openingQty !== 0)) { await db.patch(step.table, r._id, { currentQty: 0, openingQty: 0 }); deleted++; }
        if (step.resetBalances && r.balance !== 0) { await db.patch(step.table, r._id, { balance: 0 }); deleted++; }
        if (deleted >= 400) return { done: false, deleted };
      }
      return { done: true, deleted };
    }

    const batch = await db.query(step.table).withIndex("by_scope", (q) => q.eq("tenantId", a.tenantId)).take(CLEAR_BATCH);
    for (const doc of batch) { await removeWithChildren(doc); deleted++; }
    return { done: batch.length < CLEAR_BATCH, deleted };
  },
});

export const finishClear = internalMutation({
  args: { actorId: v.id("users"), tenantId: v.id("tenants"), categories: v.array(v.string()), counts: v.string() },
  handler: async (ctx, a) => {
    const actor = await ctx.db.get("users", a.actorId);
    for (const key of a.categories) {
      for (const seq of CLEAR_CATEGORIES[key]?.resetSequences ?? []) {
        const rows = await ctx.db.query(seq).withIndex("by_scope", (q) => q.eq("tenantId", a.tenantId)).collect();
        for (const r of rows) await dynamicDb(ctx.db).delete(seq, r._id);
      }
    }
    if (a.categories.some((k) => CLEAR_CATEGORIES[k]?.rebuildStats)) {
      await ctx.scheduler.runAfter(0, internal.stats.requestRebuild, { tenantId: a.tenantId });
    }
    await logAudit(ctx, actor, { action: "clear_data_file", module: "maintenance", details: `${a.categories.join(", ")} — ${a.counts}` });
  },
});

export const logClearFailure = internalMutation({
  args: { actorId: v.id("users"), details: v.string() },
  handler: async (ctx, a) => { await logAudit(ctx, await ctx.db.get("users", a.actorId), { action: "clear_data_file", module: "maintenance", details: a.details, result: "failure" }); },
});

/** Wipes the chosen data of the SELECTED business after re-checking the Super Admin's own password. */
export const clearData = action({
  args: { categories: v.array(v.string()), password: v.string() },
  handler: async (ctx, a): Promise<{ deleted: number }> => {
    const auth = await ctx.runQuery(internal.maintenance.authorizeClear, { categories: a.categories });
    if (!a.password) throw new Error("Weka password ya Super Admin.");
    try {
      await retrieveAccount(ctx, { provider: "password", account: { id: auth.email, secret: a.password } });
    } catch {
      await ctx.runMutation(internal.maintenance.logClearFailure, { actorId: auth.actorId, details: "Password ya Super Admin si sahihi" });
      throw new Error("Password ya Super Admin si sahihi.");
    }
    // Audit logs go last so the record of this very action is kept.
    const ordered = [...a.categories].sort((x, y) => Number(x === "auditLogs") - Number(y === "auditLogs"));
    let total = 0;
    const perCategory: string[] = [];
    for (const category of ordered) {
      let count = 0;
      const steps = CLEAR_CATEGORIES[category].steps;
      for (let step = 0; step < steps.length; step++) {
        for (let guard = 0; guard < 5000; guard++) {
          const r: { done: boolean; deleted: number } = await ctx.runMutation(internal.maintenance.clearStepBatch, { actorId: auth.actorId, tenantId: auth.tenantId, category, step });
          count += r.deleted;
          if (r.done) break;
        }
      }
      perCategory.push(`${category}: ${count}`);
      total += count;
    }
    await ctx.runMutation(internal.maintenance.finishClear, { actorId: auth.actorId, tenantId: auth.tenantId, categories: ordered, counts: perCategory.join(", ") });
    return { deleted: total };
  },
});

/** Lets the Clear Data File card show what exists and which business will be affected. */
export const clearDataOverview = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    if (!isSuperAdmin(user)) return { isSuperAdmin: false as const, tenantName: null, categories: [] as { key: string; label: string; description: string }[] };
    const tenant = user.tenantId ? await ctx.db.get("tenants", user.tenantId) : null;
    return {
      isSuperAdmin: true as const,
      tenantName: tenant?.name ?? null,
      categories: Object.entries(CLEAR_CATEGORIES).map(([key, c]) => ({ key, label: c.label, description: c.description })),
    };
  },
});

/** Used by the sidebar/top bar to know what the current user may open. */
export const myPermissions = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentProfile(ctx);
    if (!user) return [];
    const out: string[] = [];
    for (const key of ALL_PERMISSION_KEYS) if (await roleHasPermission(ctx, user, key)) out.push(key);
    return out;
  },
});
