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
  const needed = cashierDesk ? "waiterOrders.manage" : sellingPoint ? "waiterOrders.view" : pathname === "/sales" || pathname.startsWith("/sales/") ? "sales.view" : null;
  if (!needed) return "allowed";
  if (!permissions) return "loading";
  return permissions.includes(needed) ? "allowed" : "blocked";
}
