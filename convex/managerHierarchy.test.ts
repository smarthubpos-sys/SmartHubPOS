import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

/**
 * Manager hierarchy. A Manager who was allowed to manage users registers and manages Accountant, Cashier, Waiter, Waitress and Viewer,
 * never hands out Administrator / Super Admin, and nobody gives another person more power than he has himself.
 */
const now = new Date().toISOString();

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("tenants", { name: "Shop A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const tenantB = await ctx.db.insert("tenants", { name: "Shop B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const mk = (tenantId: Id<"tenants">, username: string, role: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true, ...extra });
    return {
      tenantA, tenantB,
      manager: await mk(tenantA, "mgr", "manager", { extraPermissions: ["maintenance.users"] }), // the owner allowed him to manage users
      managerPlain: await mk(tenantA, "mgr2", "manager"), // no user management given
      accountant: await mk(tenantA, "acc", "accountant"),
      accountantAdmin: await mk(tenantA, "acc2", "accountant", { extraPermissions: ["maintenance.users"] }),
      staff: await mk(tenantA, "staff", "cashier"),
      admin: await mk(tenantA, "adm", "admin"),
      otherManager: await mk(tenantA, "mgr3", "manager"),
      foreign: await mk(tenantB, "foreign", "cashier"),
    };
  });
  const as = (id: Id<"users">) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
  return { t, as, ...ids };
}

describe("a Manager allowed to manage users registers his own staff", () => {
  it("Accountant, Cashier, Waiter, Waitress and Viewer are all assignable to him", async () => {
    const { as, manager } = await setup();
    const roles = await as(manager).query(api.maintenance.listAssignableRoles, {});
    for (const name of ["accountant", "cashier", "waiter", "waitress", "viewer"]) expect(roles.find((r) => r.name === name)?.assignable, name).toBe(true);
  });

  it("can give each of those roles to a user, and Accountant stays under the Manager", async () => {
    const { t, as, manager, staff } = await setup();
    const me = as(manager);
    for (const role of ["accountant", "viewer", "waitress", "waiter", "cashier", "accountant"]) {
      await me.mutation(api.maintenance.updateUser, { userId: staff, role });
      expect((await t.run((ctx) => ctx.db.get("users", staff)))?.role, role).toBe(role);
    }
  });

  it("can manage an existing Accountant (edit)", async () => {
    const { as, manager, accountant } = await setup();
    const me = as(manager);
    await me.mutation(api.maintenance.updateUser, { userId: accountant, name: "Accountant by manager" });
    expect((await me.query(api.maintenance.listUsers, {})).find((u) => u._id === accountant)?.name).toBe("Accountant by manager");
  });

  it("without user-management access he can do none of it", async () => {
    const { as, managerPlain, staff } = await setup();
    await expect(as(managerPlain).mutation(api.maintenance.updateUser, { userId: staff, role: "accountant" })).rejects.toThrow(/Forbidden/);
  });
});

describe("a Manager can never hand out or touch Administrator / Super Admin", () => {
  it("refuses the Administrator and Super Admin roles, however they are written", async () => {
    const { t, as, manager, staff } = await setup();
    const me = as(manager);
    for (const role of ["admin", "administrator", "Administrator", "super_admin", "Super Admin", "owner"]) {
      await expect(me.mutation(api.maintenance.updateUser, { userId: staff, role }), role).rejects.toThrow(/Administrator au Super Admin|Super Admin pekee/);
    }
    expect((await t.run((ctx) => ctx.db.get("users", staff)))?.role).toBe("cashier");
  });

  it("shows Administrator as not assignable on the Users form", async () => {
    const { as, manager } = await setup();
    const roles = await as(manager).query(api.maintenance.listAssignableRoles, {});
    expect(roles.find((r) => r.name === "admin")?.assignable).toBe(false);
  });

  it("cannot edit an existing Administrator", async () => {
    const { as, manager, admin } = await setup();
    await expect(as(manager).mutation(api.maintenance.updateUser, { userId: admin, name: "Taken over" })).rejects.toThrow(/Manager hawezi kusimamia Administrator/);
  });

  it("cannot give a user a direct permission he does not hold himself", async () => {
    const { as, manager, staff } = await setup();
    await expect(as(manager).mutation(api.maintenance.updateUser, { userId: staff, extraPermissions: ["maintenance.roles"] })).rejects.toThrow();
  });
});

describe("nobody gives another person more power than he has", () => {
  it("an Accountant who was allowed to manage users cannot make anybody Manager or Administrator, nor edit a Manager", async () => {
    const { as, accountantAdmin, staff, otherManager } = await setup();
    const me = as(accountantAdmin);
    await expect(me.mutation(api.maintenance.updateUser, { userId: staff, role: "manager" })).rejects.toThrow(/Huwezi kutoa ruhusa|Huwezi kusimamia/);
    await expect(me.mutation(api.maintenance.updateUser, { userId: staff, role: "admin" })).rejects.toThrow(/Huwezi kutoa ruhusa|Huwezi kusimamia/);
    await expect(me.mutation(api.maintenance.updateUser, { userId: otherManager, name: "Taken over" })).rejects.toThrow(/Huwezi kusimamia/);
  });

  it("a Manager still stays inside his own business", async () => {
    const { as, manager, foreign } = await setup();
    await expect(as(manager).mutation(api.maintenance.updateUser, { userId: foreign, name: "Hacked" })).rejects.toThrow();
    expect((await as(manager).query(api.maintenance.listUsers, {})).map((u) => u.username)).not.toContain("foreign");
  });

  it("nobody, not even a Super Admin, is promoted to Super Admin", async () => {
    const { t, as, staff } = await setup();
    const boss = await t.run((ctx) => ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true }));
    await expect(as(boss).mutation(api.maintenance.updateUser, { userId: staff, role: "super_admin" })).rejects.toThrow(/Hakuna anayeweza kupandishwa/);
  });
});
