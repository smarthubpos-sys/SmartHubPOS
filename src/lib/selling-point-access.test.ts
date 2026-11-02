import { describe, expect, it } from "vitest";
import { isSellingStaffRole, isSuperAdminRole, normalizeRoleName, routeAccess, showSellingPointInMenu } from "./selling-point-access.ts";

const WAITER_PERMS = ["sales.view", "waiterOrders.view", "waiterOrders.manage"];

describe("role names", () => {
  it("normalises case, spaces and hyphens", () => {
    expect(normalizeRoleName(" Super Admin ")).toBe("super_admin");
    expect(normalizeRoleName("super-admin")).toBe("super_admin");
    for (const r of ["super_admin", "superadmin", "Super Admin", "SUPER-ADMIN", "  Super  Admin"]) expect(isSuperAdminRole(r), r).toBe(true);
    for (const r of ["admin", "manager", "cashier", "super", "superadministrator", undefined, null, ""]) expect(isSuperAdminRole(r), String(r)).toBe(false);
    for (const r of ["waiter", "Waitress", " WAITER "]) expect(isSellingStaffRole(r), r).toBe(true);
    expect(isSellingStaffRole("cashier")).toBe(false);
  });
});

describe("Selling Point in the sidebar", () => {
  const menu = (o: Partial<Parameters<typeof showSellingPointInMenu>[0]>) =>
    showSellingPointInMenu({ role: "waiter", permissions: WAITER_PERMS, modules: null, waiterOrdersEnabled: true, ...o });

  it("Super Admin always sees it - whatever the module list, permissions or business switch say", () => {
    expect(menu({ role: "Super Admin", permissions: [], modules: ["sales"], waiterOrdersEnabled: false })).toBe(true);
    expect(menu({ role: "super-admin", permissions: undefined, modules: [] , waiterOrdersEnabled: undefined })).toBe(true);
  });

  it("a waiter / waitress with waiterOrders.view sees it, even if the business-wide flag is not what the screen reads", () => {
    expect(menu({})).toBe(true);
    expect(menu({ role: "Waitress", waiterOrdersEnabled: false })).toBe(true); // the server applies the waiter/waitress switch itself
    expect(menu({ modules: ["dashboard", "waiterOrders"] })).toBe(true);
  });

  it("a waiter WITHOUT waiterOrders.view, or while permissions are still loading, does not see it", () => {
    expect(menu({ permissions: ["sales.view"] })).toBe(false);
    expect(menu({ permissions: undefined })).toBe(false);
  });

  it("the paid-module list is still respected for ordinary users", () => {
    expect(menu({ modules: ["dashboard", "sales"] })).toBe(false);
  });

  it("ordinary users keep their own rules: permission AND the business switch are both needed", () => {
    expect(menu({ role: "cashier", waiterOrdersEnabled: true })).toBe(true);
    expect(menu({ role: "cashier", waiterOrdersEnabled: false })).toBe(false);
    expect(menu({ role: "cashier", waiterOrdersEnabled: undefined })).toBe(false);
    expect(menu({ role: "cashier", permissions: ["sales.view"], waiterOrdersEnabled: true })).toBe(false);
    expect(menu({ role: "viewer", permissions: [], waiterOrdersEnabled: true })).toBe(false);
  });
});

describe("route guard", () => {
  const route = (o: Partial<Parameters<typeof routeAccess>[0]>) =>
    routeAccess({ pathname: "/selling-point", role: "waiter", permissions: WAITER_PERMS, modules: null, moduleKey: "waiterOrders", ...o });

  it("Super Admin always opens Selling Point (and its sub-pages) regardless of modules and permissions", () => {
    expect(route({ role: "Super Admin", permissions: [], modules: ["sales"] })).toBe("allowed");
    expect(route({ role: "super_admin", permissions: undefined, pathname: "/selling-point/bills" })).toBe("allowed");
  });

  it("a waiter / waitress with waiterOrders.view is allowed", () => {
    expect(route({})).toBe("allowed");
    expect(route({ role: "Waitress", pathname: "/selling-point/bills" })).toBe("allowed");
  });

  it("ordinary users stay subject to permission and module", () => {
    expect(route({ role: "cashier", permissions: ["sales.view"] })).toBe("blocked");
    expect(route({ permissions: [] })).toBe("blocked");
    expect(route({ role: "admin", permissions: WAITER_PERMS, modules: ["dashboard", "sales"] })).toBe("blocked");
    expect(route({ role: "cashier", pathname: "/sales", permissions: ["waiterOrders.view"], moduleKey: "sales" })).toBe("blocked");
    expect(route({ role: "cashier", pathname: "/sales", permissions: ["sales.view"], moduleKey: "sales" })).toBe("allowed");
  });

  it("Super Admin gets no shortcut outside Selling Point", () => {
    expect(route({ role: "super_admin", pathname: "/sales", permissions: [], moduleKey: "sales" })).toBe("blocked");
  });

  it("permissions that have not arrived yet mean 'loading' - never 'blocked' (a refresh must not bounce people away)", () => {
    expect(route({ permissions: undefined })).toBe("loading");
    expect(route({ role: "cashier", pathname: "/sales", permissions: undefined, moduleKey: "sales" })).toBe("loading");
  });

  it("screens that need no permission are open, and look-alike paths are not treated as Selling Point", () => {
    expect(route({ pathname: "/stock", moduleKey: "stock", permissions: undefined })).toBe("allowed");
    expect(route({ pathname: "/selling-pointer", moduleKey: undefined, permissions: [] })).toBe("allowed");
    expect(route({ pathname: "/salesman", moduleKey: undefined, permissions: [] })).toBe("allowed");
  });
});
