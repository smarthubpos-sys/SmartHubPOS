import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { cardPermission, modulePermissionItems, permissionModule } from "./permissions";
import { modules } from "./tes.setup";

/**
 * Per-person permissions inside a module: the Users form opens a window when a module (Sales, Stock, Accounts ...) is ticked and the
 * administrator ticks what that person may see and do. Result = role permissions + extraPermissions - deniedPermissions.
 */
const now = new Date().toISOString();

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenant = await ctx.db.insert("tenants", { name: "Shop A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const mk = (username: string, role: string, extra: Record<string, unknown> = {}) => ctx.db.insert("users", { name: username, username, role, tenantId: tenant, isActive: true, ...extra });
    return {
      tenant,
      boss: await mk("boss", "manager"),
      adm: await mk("adm", "admin"),
      acc: await mk("acc", "accountant"),
      accDenied: await mk("accdenied", "accountant", { deniedPermissions: ["stock.view", "accounts.reports.view"] }),
      cashier: await mk("cashier", "cashier"),
      cashierExtra: await mk("cashierextra", "cashier", { extraPermissions: ["stock.view"] }),
      managerDenied: await mk("mgrdenied", "manager", { deniedPermissions: ["stock.manage"] }),
    };
  });
  const as = (id: typeof ids.boss) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
  return { t, as, ...ids };
}

describe("permission -> module and card mapping", () => {
  it("knows which module a permission belongs to and lists what can be ticked per person", () => {
    expect(permissionModule("stock.reports.view")).toBe("stock");
    expect(permissionModule("suppliers.view")).toBe("purchasing");
    expect(permissionModule("accounts.reports.delete")).toBe("accounts");
    const stockKeys = modulePermissionItems("stock").map((i) => i.key);
    expect(stockKeys).toContain("stock.view");
    expect(stockKeys).not.toContain("stock.adjust"); // Super Admin only
    expect(modulePermissionItems("maintenance").map((i) => i.key)).not.toContain("system.manager");
    expect(modulePermissionItems("maintenance").map((i) => i.key)).not.toContain("maintenance.roles");
  });

  it("each card needs one permission; reports follow their prefix", () => {
    expect(cardPermission("/stock/reports/quantity")).toBe("stock.reports.view");
    expect(cardPermission("/accounts/reports/ledger")).toBe("accounts.reports.view");
    expect(cardPermission("/stock/barcodes")).toBe("stock.print");
    expect(cardPermission("/sales/invoice-finder")).toBeUndefined();
  });
});

describe("denied / extra permissions of one person", () => {
  it("a switched-off permission disappears from the screen list and the server refuses it", async () => {
    const { as, acc, accDenied } = await setup();
    const normal = await as(acc).query(api.maintenance.myPermissions, {});
    expect(normal).toContain("stock.view");
    expect(normal).toContain("accounts.reports.view");
    await expect(as(acc).query(api.inventory.listMovements, {})).resolves.toBeDefined();

    const limited = await as(accDenied).query(api.maintenance.myPermissions, {});
    expect(limited).not.toContain("stock.view");
    expect(limited).not.toContain("accounts.reports.view");
    expect(limited).toContain("accounts.view"); // the rest of his role stays
    await expect(as(accDenied).query(api.inventory.listMovements, {})).rejects.toThrow();
  });

  it("a permission switched on for one person is given on top of his role", async () => {
    const { as, cashier, cashierExtra } = await setup();
    expect(await as(cashier).query(api.maintenance.myPermissions, {})).not.toContain("stock.view");
    expect(await as(cashierExtra).query(api.maintenance.myPermissions, {})).toContain("stock.view");
  });

  it("denial also stops a manager-role account where the server asks 'manager or permission'", async () => {
    const { as, managerDenied, boss } = await setup();
    const group = { code: "G1", name: "Drinks", isActive: true };
    await expect(as(boss).mutation(api.products.upsertGroup, group)).resolves.toBeDefined();
    await expect(as(managerDenied).mutation(api.products.upsertGroup, group)).rejects.toThrow(/switched off/);
  });
});

describe("Users form saves them", () => {
  it("updateUser stores deniedPermissions, listUsers returns them, listAssignableRoles gives the role's list", async () => {
    const { as, adm, cashier } = await setup();
    const me = as(adm);
    const roles = await me.query(api.maintenance.listAssignableRoles, {});
    expect(roles.find((r) => r.name === "cashier")?.permissions).toContain("sales.manage");

    await me.mutation(api.maintenance.updateUser, { userId: cashier, extraPermissions: ["stock.view"], deniedPermissions: ["sales.print", "sales.print", "system.manager"] });
    const row = (await me.query(api.maintenance.listUsers, {})).find((u) => u._id === cashier);
    expect(row?.deniedPermissions).toEqual(["sales.print"]); // duplicates and never-per-person keys are dropped
    expect(row?.extraPermissions).toEqual(["stock.view"]);
    const mine = await as(cashier).query(api.maintenance.myPermissions, {});
    expect(mine).not.toContain("sales.print");
    expect(mine).toContain("stock.view");

    await me.mutation(api.maintenance.updateUser, { userId: cashier, deniedPermissions: [] });
    expect(await as(cashier).query(api.maintenance.myPermissions, {})).toContain("sales.print");
  });

  it("refuses unknown keys, and nobody can change his own switches", async () => {
    const { as, adm, cashier } = await setup();
    await expect(as(adm).mutation(api.maintenance.updateUser, { userId: cashier, deniedPermissions: ["not.a.permission"] })).rejects.toThrow();
    await expect(as(adm).mutation(api.maintenance.updateUser, { userId: adm, deniedPermissions: ["sales.print"] })).rejects.toThrow();
  });
});
