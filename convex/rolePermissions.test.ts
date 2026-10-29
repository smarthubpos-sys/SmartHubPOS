import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./tes.setup";

/**
 * RBAC regression tests: a role gets exactly the permissions it is configured with, normal sales screens do not need
 * report permission, reports stay protected, and business / department / ownership limits keep working.
 */
const now = new Date().toISOString();
const DAY = "2026-10-16";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("tenants", { name: "Shop A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const tenantB = await ctx.db.insert("tenants", { name: "Shop B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const bar = await ctx.db.insert("branches", { tenantId: tenantA, name: "Bar", code: "BAR", isActive: true, createdAt: now });
    const kitchen = await ctx.db.insert("branches", { tenantId: tenantA, name: "Kitchen", code: "KIT", isActive: true, createdAt: now });
    const mk = (username: string, role: string, extra: Record<string, unknown> = {}) => ctx.db.insert("users", { name: username, username, role, tenantId: tenantA, isActive: true, ...extra });
    const mgr = await mk("mgr", "manager");
    const admin = await mk("admin", "admin");
    const cashier = await mk("cash", "cashier");
    const waiter = await mk("waiter", "waiter");
    const waitress = await mk("waitress", "waitress");
    const accountant = await mk("acc", "accountant");
    const custom = await mk("sup", "supervisor");
    const disabled = await mk("off", "manager", { isActive: false });
    const mustChange = await mk("chg", "manager", { requirePasswordChange: true });
    const barCashier = await mk("barcash", "cashier", { branchId: bar });
    const ownOnly = await mk("own", "cashier", { ownDataOnly: true });
    const superAdmin = await mk("root", "super_admin");
    const otherTenantMgr = await ctx.db.insert("users", { name: "bmgr", username: "bmgr", role: "manager", tenantId: tenantB, isActive: true });

    const clientA = await ctx.db.insert("clients", { tenantId: tenantA, code: "CA", name: "Client A", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const clientB = await ctx.db.insert("clients", { tenantId: tenantB, code: "CB", name: "Client B", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const product = await ctx.db.insert("products", { tenantId: tenantA, itemCode: "P", name: "Beer", openingQty: 0, currentQty: 10, sellingPrice: 2000, isActive: true });
    const inv = (tenantId: Id<"tenants">, clientId: Id<"clients">, no: string, createdBy: Id<"users">, branchId?: Id<"branches">) =>
      ctx.db.insert("invoices", { tenantId, branchId, invoiceNo: no, invoiceDate: DAY, clientId, subtotal: 2000, discount: 0, taxAmount: 0, total: 2000, amountPaid: 0, outstanding: 2000, paymentStatus: "unpaid", status: "posted", createdBy });
    const invA = await inv(tenantA, clientA, "A-1", mgr);
    const invBar = await inv(tenantA, clientA, "BAR-1", mgr, bar);
    const invKit = await inv(tenantA, clientA, "KIT-1", mgr, kitchen);
    const invOwn = await inv(tenantA, clientA, "OWN-1", ownOnly);
    const invB = await inv(tenantB, clientB, "B-1", otherTenantMgr);
    await ctx.db.insert("invoiceLines", { invoiceId: invA, productId: product, qty: 1, qtyStr: "1", unitPrice: 2000, unitPriceStr: "2000", lineTotal: 2000, lineTotalStr: "2000", costAtSale: 1200, discount: 0 });
    return { tenantA, tenantB, bar, kitchen, superAdmin, mgr, admin, cashier, waiter, waitress, accountant, custom, disabled, mustChange, barCashier, ownOnly, otherTenantMgr, clientA, clientB, product, invA, invBar, invKit, invOwn, invB };
  });
  let n = 0;
  const as = (id: Id<"users">) => t.withIdentity({ subject: id, tokenIdentifier: `x|${++n}` });
  const setRole = (name: string, permissions: string[], knownKeys?: string[]) => t.run(async (ctx) => { await ctx.db.insert("roles", { name, displayName: name, permissions, isSystem: false, knownKeys }); });
  return { t, as, setRole, ...ids };
}

describe("sales screens do not need report permission, reports stay protected", () => {
  it("cashier (default role) can use the Sales Register / Clients / Invoice Entry data without any report permission", async () => {
    const { as, cashier } = await setup();
    const c = as(cashier);
    const basic = await c.query(api.sales.salesRegisterBasic, {});
    expect(basic.clients.map((x) => x.name)).toEqual(["Client A"]);
    expect(basic.balances.length).toBe(1);
    await expect(c.query(api.sales.recentInvoices, {})).resolves.toBeDefined();
  });

  it("the basic register never carries cost, profit, supplier or invoice-line data", async () => {
    const { as, cashier } = await setup();
    const basic = await as(cashier).query(api.sales.salesRegisterBasic, {});
    expect(basic.lines).toEqual([]);
    expect(JSON.stringify(basic)).not.toMatch(/costAtSale|"cost"|profit|supplierName|"Faida"/);
  });

  it("sales reports (profit, cost, by-supplier) remain protected by sales.reports.view", async () => {
    const { as, cashier, waiter, waitress, mgr, accountant } = await setup();
    for (const id of [cashier, waiter, waitress]) await expect(as(id).query(api.sales.salesRegisters, {})).rejects.toThrow(/sales\.reports\.view/);
    expect((await as(accountant).query(api.sales.salesRegisters, {})).lines[0].cost).toBe(1200);
    const full = await as(mgr).query(api.sales.salesRegisters, {});
    expect(full.lines.length).toBeGreaterThan(0);
    expect(full.lines[0].cost).toBe(1200);
  });

  it("a user without sales.view is refused by the basic register and by recent invoices", async () => {
    const { as, t, tenantA } = await setup();
    const viewer = await t.run(async (ctx) => await ctx.db.insert("users", { name: "v", username: "v", role: "viewer", tenantId: tenantA, isActive: true }));
    const none = await t.run(async (ctx) => await ctx.db.insert("users", { name: "n", username: "n", role: "nobody_role", tenantId: tenantA, isActive: true }));
    for (const id of [viewer, none]) {
      await expect(as(id).query(api.sales.salesRegisterBasic, {})).rejects.toThrow(/sales\.view/);
      await expect(as(id).query(api.sales.recentInvoices, {})).rejects.toThrow(/sales\.view/);
    }
  });
});

describe("a role that was saved before sales.view was a default keeps working", () => {
  it("a legacy cashier row saved as only sales.manage (no knownKeys) gets the built-in sales.view / sales.print back", async () => {
    const { as, setRole, cashier } = await setup();
    await setRole("cashier", ["sales.manage"]);
    const c = as(cashier);
    await expect(c.query(api.sales.recentInvoices, {})).resolves.toBeDefined();
    expect(await c.query(api.maintenance.myPermissions, {})).toEqual(expect.arrayContaining(["sales.view", "sales.manage", "sales.print"]));
  });

  it("a role saved on purpose WITHOUT sales.view (knownKeys present) is NOT widened", async () => {
    const { as, setRole, cashier } = await setup();
    const { ALL_PERMISSION_KEYS } = await import("./permissions");
    await setRole("cashier", ["sales.manage"], ALL_PERMISSION_KEYS);
    await expect(as(cashier).query(api.sales.recentInvoices, {})).rejects.toThrow(/sales\.view/);
  });
});

describe("Sales and Selling Point permissions are independent", () => {
  it("sales permissions alone do not grant Selling Point access", async () => {
    const { as, setRole, cashier } = await setup();
    const { ALL_PERMISSION_KEYS } = await import("./permissions");
    await setRole("cashier", ["sales.view", "sales.manage", "sales.print"], ALL_PERMISSION_KEYS);
    await expect(as(cashier).query(api.waiterOrders.list, {})).rejects.toThrow(/waiterOrders\.view/);
  });

  it("Selling Point permissions alone do not grant the normal Sales Register", async () => {
    const { as, setRole, cashier } = await setup();
    const { ALL_PERMISSION_KEYS } = await import("./permissions");
    await setRole("cashier", ["waiterOrders.view", "waiterOrders.manage"], ALL_PERMISSION_KEYS);
    await expect(as(cashier).query(api.sales.salesRegisterBasic, {})).rejects.toThrow(/sales\.view/);
  });
});

describe("permission matrix (what each role really gets)", () => {
  it("cashier: sell, view and print (plus asking for leave) only - no reports, stock, accounts, purchasing, payroll, maintenance", async () => {
    const { as, cashier } = await setup();
    const p = await as(cashier).query(api.maintenance.myPermissions, {});
    expect(p.sort()).toEqual(["leave.request", "sales.manage", "sales.print", "sales.view", "waiterOrders.manage", "waiterOrders.view"]);
  });

  it("accountant: every financial view (incl. profit/loss, cost, margins) and nothing that changes sales, stock, purchases or users", async () => {
    const { as, accountant } = await setup();
    const p = await as(accountant).query(api.maintenance.myPermissions, {});
    expect(p.sort()).toEqual(["accounts.export", "accounts.print", "accounts.reports.view", "accounts.view", "leave.request", "maintenance.audit.view", "maintenance.periods", "payroll.export", "payroll.print", "payroll.reports.view", "payroll.view", "purchasing.export", "purchasing.print", "purchasing.reports.view", "purchasing.view", "sales.export", "sales.print", "sales.reports.view", "sales.view", "stock.export", "stock.print", "stock.reports.view", "stock.view", "suppliers.view"]);
    for (const banned of ["sales.manage", "sales.edit", "sales.void", "stock.manage", "stock.adjust", "purchasing.manage", "purchasing.edit", "purchasing.delete", "maintenance.users", "maintenance.roles", "payroll.manage", "accounts.approve"]) expect(p).not.toContain(banned);
  });

  it("accountant can read profit/loss, trial balance, sales / stock / purchase reports, but cannot sell", async () => {
    const { as, accountant, clientA } = await setup();
    const a = as(accountant);
    await expect(a.query(api.accounting.profitAndLoss, { startDate: DAY, endDate: DAY })).resolves.toBeDefined();
    await expect(a.query(api.accounting.listAccounts, {})).resolves.toBeDefined();
    await expect(a.query(api.accounting.trialBalance, {})).resolves.toBeDefined();
    await expect(a.query(api.sales.salesRegisters, {})).resolves.toBeDefined();
    await expect(a.query(api.inventory.stockRegisters, {})).resolves.toBeDefined();
    await expect(a.query(api.purchasing.purchasingRegisters, {})).resolves.toBeDefined();
    await expect(a.mutation(api.sales.createInvoice, { clientId: clientA, invoiceDate: DAY, lines: [] } as never)).rejects.toThrow(/sales\.manage/);
  });

  it("waiter and waitress: everyday sales only (view, sell, print, ask for leave) - same for both, nothing else", async () => {
    const { as, waiter, waitress } = await setup();
    for (const id of [waiter, waitress]) expect((await as(id).query(api.maintenance.myPermissions, {})).sort()).toEqual(["leave.request", "sales.manage", "sales.print", "sales.view", "waiterOrders.manage", "waiterOrders.view"]);
  });

  it("waiter works through normal sales screens but every financial report and finance screen is refused", async () => {
    const { as, waiter, waitress, invA } = await setup();
    for (const id of [waiter, waitress]) {
      const w = as(id);
      await expect(w.query(api.sales.recentInvoices, {})).resolves.toBeDefined();
      await expect(w.query(api.sales.salesRegisterBasic, {})).resolves.toBeDefined();
      await expect(w.query(api.sales.salesRegisters, {})).rejects.toThrow(/sales\.reports\.view/);
      await expect(w.query(api.accounting.profitAndLoss, { startDate: DAY, endDate: DAY })).rejects.toThrow(/accounts\.reports\.view/);
      await expect(w.query(api.accounting.listAccounts, {})).rejects.toThrow(/accounts\.view/);
      await expect(w.query(api.accounting.listJournals, {})).rejects.toThrow(/accounts\.view/);
      await expect(w.query(api.accounting.trialBalance, {})).rejects.toThrow(/accounts\.view/);
      await expect(w.query(api.inventory.stockRegisters, {})).rejects.toThrow(/stock\.view/);
      await expect(w.query(api.purchasing.purchasingRegisters, {})).rejects.toThrow(/purchasing\.view/);
      await expect(w.query(api.dashboard.getMetrics, { date: DAY })).rejects.toThrow(/personal dashboard only/);
      await expect(w.query(api.dashboard.getCharts, { from: DAY, today: DAY })).rejects.toThrow(/personal dashboard only/);
      await expect(w.mutation(api.sales.voidInvoice, { invoiceId: invA } as never)).rejects.toThrow();
    }
  });

  it("the main dashboard goes to the business view for managers and accountant, and to the personal view for sellers", async () => {
    const { as, mgr, accountant, cashier, waiter, waitress } = await setup();
    const flag = async (id: typeof mgr) => (await as(id).query(api.tenants.current, {}))?.personalDashboard;
    expect(await flag(mgr)).toBe(false);
    expect(await flag(accountant)).toBe(false);
    for (const id of [cashier, waiter, waitress]) expect(await flag(id)).toBe(true);
    await expect(as(accountant).query(api.dashboard.getMetrics, { date: DAY })).resolves.toBeDefined();
  });

  it("cost of goods never reaches a seller through invoice details; managers and accountant still see it", async () => {
    const { as, waiter, cashier, mgr, accountant, invA } = await setup();
    for (const id of [waiter, cashier]) {
      const d = await as(id).query(api.sales.invoiceDetails, { id: invA });
      expect(d?.lines.length).toBe(1);
      expect(JSON.stringify(d)).not.toContain("costAtSale");
    }
    for (const id of [mgr, accountant]) expect((await as(id).query(api.sales.invoiceDetails, { id: invA }))?.lines[0]).toHaveProperty("costAtSale", 1200);
  });

  it("a seller may add a NEW customer at the till (no credit, no opening balance) but cannot edit one; a manager can do both", async () => {
    const { as, t, tenantA, bar } = await setup();
    // Shop A has departments, so both people work inside one (Bar).
    const { waiter, mgr } = await t.run(async (ctx) => ({
      waiter: await ctx.db.insert("users", { name: "w2", username: "w2", role: "waiter", tenantId: tenantA, branchId: bar, isActive: true }),
      mgr: await ctx.db.insert("users", { name: "m2", username: "m2", role: "manager", tenantId: tenantA, branchId: bar, isActive: true }),
    }));
    const base = { code: "W1", name: "Walk-in Joe", openingBalance: 5000, creditLimit: 99999, creditPolicy: "allow", isActive: true };
    const id = await as(waiter).mutation(api.clients.upsert, base);
    const row = await t.run(async (ctx) => await ctx.db.get("clients", id));
    expect(row).toMatchObject({ openingBalance: 0, creditPolicy: "block" });
    expect(row?.creditLimit).toBeUndefined();
    await expect(as(waiter).mutation(api.clients.upsert, { ...base, id, name: "Hacked" })).rejects.toThrow(/only a manager/);
    await expect(as(mgr).mutation(api.clients.upsert, { ...base, id, name: "Renamed", openingBalance: 0 })).resolves.toBeDefined();
  });

  it("manager and admin keep their wide access; only the Super Admin gets stock.adjust and role management", async () => {
    const { as, mgr, admin } = await setup();
    const m = await as(mgr).query(api.maintenance.myPermissions, {});
    const a = await as(admin).query(api.maintenance.myPermissions, {});
    expect(m).toContain("sales.reports.view");
    expect(a).toContain("sales.reports.view");
    for (const p of [m, a]) { expect(p).not.toContain("stock.adjust"); }
    expect(a).not.toContain("maintenance.roles");
  });

  it("a custom role uses exactly the permissions stored for it", async () => {
    const { as, setRole, custom, clientA } = await setup();
    await setRole("supervisor", ["sales.view", "sales.reports.view"]);
    const s = as(custom);
    expect((await s.query(api.maintenance.myPermissions, {})).sort()).toEqual(["sales.reports.view", "sales.view"]);
    await expect(s.query(api.sales.salesRegisters, {})).resolves.toBeDefined();
    await expect(s.mutation(api.sales.createInvoice, { clientId: clientA, invoiceDate: DAY, lines: [] } as never)).rejects.toThrow(/sales\.manage/);
  });
});

describe("changing a role changes authorization immediately", () => {
  it("cashier -> manager (and back) is reflected on the very next call", async () => {
    const { as, cashier, superAdmin, bar } = await setup();
    const boss = as(superAdmin);
    const c = as(cashier);
    await expect(c.query(api.sales.salesRegisters, {})).rejects.toThrow(/sales\.reports\.view/);
    await boss.mutation(api.maintenance.updateUser, { userId: cashier, role: "manager" });
    await expect(c.query(api.sales.salesRegisters, {})).resolves.toBeDefined();
    // Shop A has departments, so a cashier must be tied to one (that rule is part of the system and stays).
    await boss.mutation(api.maintenance.updateUser, { userId: cashier, role: "cashier", branchIds: [bar] });
    await expect(c.query(api.sales.salesRegisters, {})).rejects.toThrow(/sales\.reports\.view/);
  });
});

describe("business, department and ownership limits", () => {
  it("Business A never reads Business B data through the basic register, details or payments", async () => {
    const { as, mgr, otherTenantMgr, invB, invA } = await setup();
    const a = await as(mgr).query(api.sales.salesRegisterBasic, {});
    expect(a.clients.map((c) => c.name)).toEqual(["Client A"]);
    expect(JSON.stringify(a)).not.toContain("Client B");
    expect(await as(mgr).query(api.sales.invoiceDetails, { id: invB })).toBeNull();
    const b = await as(otherTenantMgr).query(api.sales.salesRegisterBasic, {});
    expect(b.clients.map((c) => c.name)).toEqual(["Client B"]);
    expect(await as(otherTenantMgr).query(api.sales.invoiceDetails, { id: invA })).toBeNull();
    await expect(as(mgr).mutation(api.sales.recordPayment, { invoiceId: invB, amount: 100, paymentMethod: "cash", paymentDate: DAY })).rejects.toThrow();
  });

  it("a department user sees only his department in the basic register, with the right totals", async () => {
    const { as, barCashier } = await setup();
    const r = await as(barCashier).query(api.sales.salesRegisterBasic, {});
    expect(r.totals.invoices).toBe(1);
    expect(r.totals.sales).toBe(2000);
  });

  it("staff mode (ownDataOnly) keeps a user to his own invoices in recent invoices and the basic register", async () => {
    const { as, ownOnly } = await setup();
    const recent = await as(ownOnly).query(api.sales.recentInvoices, {});
    expect(recent.invoices.map((i) => i.invoiceNo)).toEqual(["OWN-1"]);
    const basic = await as(ownOnly).query(api.sales.salesRegisterBasic, {});
    expect(basic.totals.invoices).toBe(1);
  });

  it("disabled users and users who must change their password are refused everywhere", async () => {
    const { as, disabled, mustChange } = await setup();
    await expect(as(disabled).query(api.sales.salesRegisterBasic, {})).rejects.toThrow(/active user/);
    await expect(as(disabled).query(api.sales.recentInvoices, {})).rejects.toThrow(/active user/);
    await expect(as(mustChange).query(api.sales.salesRegisterBasic, {})).rejects.toThrow(/password change/);
    await expect(as(mustChange).query(api.sales.salesRegisters, {})).rejects.toThrow(/password change/);
  });
});

describe("legacy profiles are migrated without losing restrictions", () => {
  it("role, business, department list, menu, staff mode and per-user grants are carried over on first sign-in", async () => {
    const { t, as, tenantA, bar, kitchen } = await setup();
    const { fresh } = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "old|session", username: "hawa", name: "Hawa", role: "waiter", tenantId: tenantA, branchId: bar, branchIds: [bar, kitchen], branchPicked: true, isActive: true, menuAccess: ["dashboard", "sales"], ownDataOnly: true, extraPermissions: ["sales.void"], requirePasswordChange: true });
      const fresh = await ctx.db.insert("users", { username: "hawa", email: "hawa@login.smarthub.invalid" });
      return { fresh };
    });
    await as(fresh).mutation(api.users.updateCurrentUser, {});
    const doc = await t.run(async (ctx) => await ctx.db.get("users", fresh));
    expect(doc?.role).toBe("waiter");
    expect(doc?.tenantId).toBe(tenantA);
    expect(doc?.branchId).toBe(bar);
    expect(doc?.branchIds).toEqual([bar, kitchen]);
    expect(doc?.menuAccess).toEqual(["dashboard", "sales"]);
    expect(doc?.ownDataOnly).toBe(true);
    expect(doc?.extraPermissions).toEqual(["sales.void"]);
    expect(doc?.requirePasswordChange).toBe(true);
  });

  it("a legacy role label such as \"Cashier\" is normalised to cashier and never downgraded to viewer", async () => {
    const { t, as, tenantA } = await setup();
    const fresh = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "old|s2", username: "juma", role: "Cashier", tenantId: tenantA, isActive: true });
      return await ctx.db.insert("users", { username: "juma", email: "juma@login.smarthub.invalid" });
    });
    await as(fresh).mutation(api.users.updateCurrentUser, {});
    expect((await t.run(async (ctx) => await ctx.db.get("users", fresh)))?.role).toBe("cashier");
  });
});


describe("legacy built-in role default migration", () => {
  it("upgrades only exact previous Accountant / Waiter / Waitress defaults", async () => {
    const { permissionsWithNewDefaults, SYSTEM_ROLES } = await import("./permissions");
    const previousAccountant = ["accounts.manage", "suppliers.view", "maintenance.periods", "maintenance.audit.view"];
    expect(permissionsWithNewDefaults("accountant", previousAccountant, undefined)).toEqual(
      SYSTEM_ROLES.find((r) => r.name === "accountant")!.permissions,
    );
    expect(permissionsWithNewDefaults("waiter", [], undefined)).toEqual(
      SYSTEM_ROLES.find((r) => r.name === "waiter")!.permissions,
    );
    expect(permissionsWithNewDefaults("waitress", [], undefined)).toEqual(
      SYSTEM_ROLES.find((r) => r.name === "waitress")!.permissions,
    );
  });

  it("preserves customized built-in role permissions instead of widening access", async () => {
    const { permissionsWithNewDefaults } = await import("./permissions");
    expect(permissionsWithNewDefaults("waiter", ["sales.view"], undefined)).toEqual(["sales.view"]);
    expect(permissionsWithNewDefaults("accountant", ["accounts.view"], undefined)).toEqual(["accounts.view"]);
  });
});
describe("role list access control", () => {
  it("waiter and waitress cannot view roles without maintenance.roles permission", async () => {
    const { as, waiter, waitress } = await setup();

    await expect(
      as(waiter).query(api.maintenance.listRoles, {})
    ).rejects.toThrow(/maintenance\.roles/);

    await expect(
      as(waitress).query(api.maintenance.listRoles, {})
    ).rejects.toThrow(/maintenance\.roles/);
  });

  it("a user with maintenance.roles permission can view roles", async () => {
    const { as, t, tenantA } = await setup();

    const roleManager = await t.run(async (ctx) => {
      await ctx.db.insert("roles", {
        name: "rolesmanager",
        displayName: "Roles Manager",
        permissions: ["maintenance.roles"],
        isSystem: false,
      });

      return await ctx.db.insert("users", {
        name: "Roles Manager",
        username: "rolesmanager",
        role: "rolesmanager",
        tenantId: tenantA,
        isActive: true,
      });
    });

    const roles = await as(roleManager).query(
      api.maintenance.listRoles,
      {}
    );

    expect(roles.length).toBeGreaterThan(0);
    expect(roles.some((role) => role.name === "waiter")).toBe(true);
  });
});