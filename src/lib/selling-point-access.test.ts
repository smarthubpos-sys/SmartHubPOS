import { describe, expect, it } from "vitest";
import { isSellingStaffRole, isSuperAdminRole, normalizeRoleName, routeAccess, salesScreenPermissions, showModuleInMenu, showSellingPointInMenu } from "./selling-point-access.ts";

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

  it("screens that need no permission are open, module screens follow their permission, and look-alike paths are not treated as Selling Point", () => {
    expect(route({ pathname: "/dashboard", moduleKey: "dashboard", permissions: undefined })).toBe("allowed");
    expect(route({ pathname: "/help", moduleKey: "help", permissions: [] })).toBe("allowed");
    // Stock now needs a stock permission (same as the server), so it waits while permissions load instead of opening for everybody.
    expect(route({ pathname: "/stock", moduleKey: "stock", permissions: undefined })).toBe("loading");
    expect(route({ pathname: "/stock", moduleKey: "stock", permissions: [] })).toBe("blocked");
    expect(route({ pathname: "/selling-pointer", moduleKey: undefined, permissions: [] })).toBe("allowed");
    expect(route({ pathname: "/salesman", moduleKey: undefined, permissions: [] })).toBe("allowed");
  });
});


describe("sidebar modules follow the permissions given", () => {
  const show = (module: string, permissions: string[] | undefined, extra: { role?: string; modules?: string[] | null } = {}) =>
    showModuleInMenu({ role: extra.role ?? "cashier", permissions, modules: extra.modules ?? null, module });

  it("a module shows only when the user has at least one permission inside it", () => {
    expect(show("stock", ["stock.view"])).toBe(true);
    expect(show("stock", ["sales.view"])).toBe(false);
    expect(show("purchasing", ["suppliers.view"])).toBe(true);
    expect(show("purchasing", ["stock.view"])).toBe(false);
    expect(show("accounts", ["accounts.reports.view"])).toBe(true);
    expect(show("accounts", [])).toBe(false);
    expect(show("payroll", ["payroll.view"])).toBe(true);
    expect(show("hr", ["payroll.view"])).toBe(true);
    expect(show("hr", ["leave.request"])).toBe(false);
    expect(show("maintenance", ["maintenance.users"])).toBe(true);
    expect(show("maintenance", ["sales.view", "sales.manage"])).toBe(false);
    expect(show("bills", ["sales.view"])).toBe(true);
    expect(show("bills", ["stock.view"])).toBe(false);
  });

  it("Dashboard, Notifications and Help need no permission of their own", () => {
    for (const m of ["dashboard", "notifications", "help"]) expect(show(m, [])).toBe(true);
  });

  it("the module list still decides first, and nothing shows while permissions are loading", () => {
    expect(show("stock", ["stock.view"], { modules: ["dashboard", "sales"] })).toBe(false);
    expect(show("stock", undefined)).toBe(false);
  });

  it("Super Admin always sees everything", () => {
    expect(show("stock", [], { role: "Super Admin" })).toBe(true);
  });
});

describe("Sales screens follow the permissions given", () => {
  it("picks the permission each screen needs", () => {
    expect(salesScreenPermissions("/sales")).toEqual(["sales.view"]);
    expect(salesScreenPermissions("/sales/clients/list")).toEqual(["sales.view"]);
    expect(salesScreenPermissions("/sales/invoicing")).toEqual(["sales.manage"]);
    expect(salesScreenPermissions("/sales/clients")).toEqual(["sales.manage"]);
    expect(salesScreenPermissions("/sales/reports/sold-items")).toEqual(["sales.reports.view"]);
  });

  const go = (pathname: string, permissions: string[] | undefined, moduleKey?: string) => routeAccess({ pathname, role: "cashier", permissions, modules: null, moduleKey });

  it("blocks screens the user was not given, opens the ones he was", () => {
    expect(go("/sales/invoicing", ["sales.view"])).toBe("blocked");
    expect(go("/sales/invoicing", ["sales.view", "sales.manage"])).toBe("allowed");
    expect(go("/sales/reports/sold-items", ["sales.view", "sales.manage"])).toBe("blocked");
    expect(go("/sales/reports/sold-items", ["sales.view", "sales.reports.view"])).toBe("allowed");
    expect(go("/stock", ["sales.view"])).toBe("blocked");
    expect(go("/stock/products", ["stock.view"])).toBe("allowed");
    expect(go("/accounts", [])).toBe("blocked");
    expect(go("/maintenance/users", ["maintenance.users"])).toBe("allowed");
    expect(go("/maintenance", ["sales.manage"])).toBe("blocked");
    expect(go("/dashboard", [])).toBe("allowed");
  });

  it("waits (never blocks) while permissions are loading", () => {
    expect(go("/stock", undefined)).toBe("loading");
    expect(go("/sales/invoicing", undefined)).toBe("loading");
  });
});
