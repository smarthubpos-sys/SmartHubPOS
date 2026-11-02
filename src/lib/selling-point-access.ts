/**
 * One source of truth for "may this person see / open Selling Point?", used by the sidebar AND the route guard,
 * so the two can no longer disagree. The server still enforces everything (permission, module, business switches,
 * tenant and department scope): this file only decides what the screen shows.
 */

/** Role labels from older data ("Super Admin", "super-admin", " Waitress ") become one canonical form. */
export function normalizeRoleName(role: unknown): string {
  return String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export const isSuperAdminRole = (role: unknown) => ["super_admin", "superadmin"].includes(normalizeRoleName(role));
export const isSellingStaffRole = (role: unknown) => ["waiter", "waitress"].includes(normalizeRoleName(role));

type MenuInput = {
  role: unknown;
  /** undefined while the permission list is still loading */
  permissions: readonly string[] | undefined;
  /** business modules the user may open; null/undefined = nothing restricted (or not loaded yet) */
  modules: readonly string[] | null | undefined;
  waiterOrdersEnabled: boolean | undefined;
};

/** Sidebar: does the "Selling Point" item show? */
export function showSellingPointInMenu({ role, permissions, modules, waiterOrdersEnabled }: MenuInput): boolean {
  if (isSuperAdminRole(role)) return true; // Super Admin: always, whatever the module toggles or role permissions say
  if (modules && !modules.includes("waiterOrders")) return false;
  if (!permissions?.includes("waiterOrders.view")) return false;
  // Waiter / waitress follow their own switch on the server; every other role also needs the business switch on.
  return isSellingStaffRole(role) || waiterOrdersEnabled === true;
}

export type RouteAccess = "allowed" | "blocked" | "loading";

/**
 * Permissions that open each sidebar module (ANY ONE of them is enough). The server refuses a screen without them, so the
 * sidebar must not show it either: a module is listed only for people who were really given something inside it.
 * "dashboard", "notifications", "help" and "leave" are not here: they have no permission of their own (leave has its own rule).
 */
export const MODULE_PERMISSIONS: Record<string, readonly string[]> = {
  sales: ["sales.view"],
  stock: ["stock.view", "stock.manage", "stock.reports.view", "stock.print", "stock.export", "stock.store.view", "stock.store.manage", "stock.store.receive", "stock.store.transfer", "stock.store.dispatch", "stock.store.receive_transfer", "stock.adjust"],
  purchasing: ["purchasing.view", "purchasing.manage", "purchasing.reports.view", "purchasing.print", "purchasing.export", "purchasing.edit", "purchasing.delete", "suppliers.view", "suppliers.manage"],
  accounts: ["accounts.view", "accounts.manage", "accounts.approve", "accounts.reports.view", "accounts.print", "accounts.export"],
  bills: ["sales.view", "sales.manage", "bills.all_departments"],
  payroll: ["payroll.view", "payroll.manage", "payroll.approve", "payroll.reports.view", "payroll.print", "payroll.export"],
  hr: ["payroll.view", "payroll.manage"],
  maintenance: ["system.manager", "maintenance.system", "maintenance.company", "maintenance.hardware", "maintenance.tax", "maintenance.numbering", "maintenance.periods", "maintenance.language", "maintenance.users", "maintenance.security", "maintenance.roles", "maintenance.audit.view"],
};

/** Sidebar: does an ordinary module show for this user? (Selling Point, Cashier and Leave have their own rules.) */
export function showModuleInMenu({ role, permissions, modules, module }: { role: unknown; permissions: readonly string[] | undefined; modules: readonly string[] | null | undefined; module: string }): boolean {
  if (isSuperAdminRole(role)) return true;
  if (modules && !modules.includes(module)) return false;
  const needs = MODULE_PERMISSIONS[module];
  if (!needs) return true; // dashboard, notifications, help: everyone who has the module
  return !!permissions && needs.some((k) => permissions.includes(k));
}

/** Permission(s) a Sales screen needs (any one): the same keys the server enforces on that screen. */
export function salesScreenPermissions(pathname: string): readonly string[] {
  if (pathname.startsWith("/sales/reports/")) return ["sales.reports.view"];
  if (pathname === "/sales/invoicing" || pathname.startsWith("/sales/invoicing/") || pathname === "/sales/clients" || pathname === "/sales/clients/") return ["sales.manage"];
  return ["sales.view"];
}

type RouteInput = {
  pathname: string;
  role: unknown;
  permissions: readonly string[] | undefined;
  /** business.modules (null/undefined = unrestricted) */
  modules: readonly string[] | null | undefined;
  /** MODULES entry whose path matches the first URL segment */
  moduleKey: string | undefined;
};

/**
 * Route guard. A screen that needs a permission is "loading" until the permission list has arrived: an empty list
 * must never be mistaken for "no permissions", otherwise a refresh on /selling-point or /sales bounces the person away.
 */
export function routeAccess({ pathname, role, permissions, modules, moduleKey }: RouteInput): RouteAccess {
  const sellingPoint = pathname === "/selling-point" || pathname.startsWith("/selling-point/");
  if (sellingPoint && isSuperAdminRole(role)) return "allowed";
  if (moduleKey && modules && !modules.includes(moduleKey)) return "blocked";
  const cashierDesk = pathname === "/cashier" || pathname.startsWith("/cashier/");
  if (cashierDesk && isSuperAdminRole(role)) return "blocked"; // orders and waiter money belong to the cashier, not the Super Admin
  const inSales = pathname === "/sales" || pathname.startsWith("/sales/");
  const first = pathname.split("/")[1] ?? "";
  const moduleNeeds = !cashierDesk && !sellingPoint && !inSales ? MODULE_PERMISSIONS[first] : undefined;
  const needed: readonly string[] | null = cashierDesk ? ["waiterOrders.manage"] : sellingPoint ? ["waiterOrders.view"] : inSales ? salesScreenPermissions(pathname) : moduleNeeds ?? null;
  if (!needed) return "allowed";
  if (!permissions) return "loading";
  return needed.some((k) => permissions.includes(k)) ? "allowed" : "blocked";
}
