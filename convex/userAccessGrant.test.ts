import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

/**
 * Fix 1 - USER ACCESS & PERMISSIONS.
 * The owner can give ONE staff member the right to add / edit / manage users (extraPermissions "maintenance.users"),
 * and it really works on the server and is reported to the screen (myPermissions). A staff member without the grant is refused,
 * and a granted staff member can never become, create or manage someone more powerful than himself.
 */
const now = new Date().toISOString();

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantA = await ctx.db.insert("tenants", { name: "Shop A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const tenantB = await ctx.db.insert("tenants", { name: "Shop B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const mk = (tenantId: typeof tenantA, username: string, role: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true, ...extra });
    return {
      tenantA, tenantB,
      granted: await mk(tenantA, "granted", "cashier", { extraPermissions: ["maintenance.users"] }),
      plain: await mk(tenantA, "plain", "cashier"),
      target: await mk(tenantA, "target", "cashier"),
      manager: await mk(tenantA, "boss", "manager"),
      admin: await mk(tenantA, "adm", "admin"),
      foreign: await mk(tenantB, "foreign", "cashier"),
    };
  });
  const as = (id: typeof ids.granted) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
  return { t, as, ...ids };
}

describe("a user given 'maintenance.users' by the owner can manage users", () => {
  it("the screen is told about the grant (menu tile) and the server accepts the calls", async () => {
    const { as, granted, target } = await setup();
    const me = as(granted);
    expect(await me.query(api.maintenance.myPermissions, {})).toContain("maintenance.users");
    const users = await me.query(api.maintenance.listUsers, {});
    expect(users.map((u) => u.username)).toContain("target");
    const roles = await me.query(api.maintenance.listAssignableRoles, {});
    expect(roles.find((r) => r.name === "cashier")?.assignable).toBe(true);
    await me.mutation(api.maintenance.updateUser, { userId: target, name: "Renamed" });
    const after = (await me.query(api.maintenance.listUsers, {})).find((u) => u._id === target);
    expect(after?.name).toBe("Renamed");
  });

  it("sees and manages only the users of his own business", async () => {
    const { as, granted, foreign } = await setup();
    const me = as(granted);
    expect((await me.query(api.maintenance.listUsers, {})).map((u) => u.username)).not.toContain("foreign");
    await expect(me.mutation(api.maintenance.updateUser, { userId: foreign, name: "Hacked" })).rejects.toThrow();
  });
});

describe("a staff member WITHOUT the grant is refused", () => {
  it("cannot list, edit or read assignable roles", async () => {
    const { as, plain, target } = await setup();
    const me = as(plain);
    expect(await me.query(api.maintenance.myPermissions, {})).not.toContain("maintenance.users");
    await expect(me.query(api.maintenance.listUsers, {})).rejects.toThrow(/Forbidden/);
    await expect(me.query(api.maintenance.listAssignableRoles, {})).rejects.toThrow(/Forbidden/);
    await expect(me.mutation(api.maintenance.updateUser, { userId: target, name: "X" })).rejects.toThrow(/Forbidden/);
  });
});

describe("a granted staff member can never become more powerful than he is", () => {
  it("cannot hand out a role stronger than his own, nor a permission he lacks", async () => {
    const { as, granted, target } = await setup();
    const me = as(granted);
    const roles = await me.query(api.maintenance.listAssignableRoles, {});
    expect(roles.find((r) => r.name === "manager")?.assignable).toBe(false);
    await expect(me.mutation(api.maintenance.updateUser, { userId: target, role: "manager" })).rejects.toThrow(/Huwezi kutoa ruhusa/);
    await expect(me.mutation(api.maintenance.updateUser, { userId: target, extraPermissions: ["sales.void"] })).rejects.toThrow(/Huwezi kutoa ruhusa/);
  });

  it("cannot edit a manager (a stronger account), and cannot change his own role or permissions", async () => {
    const { as, granted, manager } = await setup();
    const me = as(granted);
    await expect(me.mutation(api.maintenance.updateUser, { userId: manager, name: "Taken over" })).rejects.toThrow(/Huwezi kusimamia/);
    await expect(me.mutation(api.maintenance.updateUser, { userId: granted, role: "manager" })).rejects.toThrow();
    await expect(me.mutation(api.maintenance.updateUser, { userId: granted, extraPermissions: ["maintenance.users", "sales.void"] })).rejects.toThrow();
  });

  it("can pass on a permission he holds himself", async () => {
    const { as, granted, target } = await setup();
    const me = as(granted);
    await me.mutation(api.maintenance.updateUser, { userId: target, extraPermissions: ["maintenance.users"] });
    const perms = await as(target).query(api.maintenance.myPermissions, {});
    expect(perms).toContain("maintenance.users");
  });
});

describe("roles keep working according to the permissions they were given", () => {
  it("an administrator (role carries maintenance.users) can edit a cashier", async () => {
    const { as, admin, target } = await setup();
    const me = as(admin);
    await me.mutation(api.maintenance.updateUser, { userId: target, name: "By admin" });
    expect((await me.query(api.maintenance.listUsers, {})).find((u) => u._id === target)?.name).toBe("By admin");
  });

  it("a manager has no user management until the owner gives it, then it works", async () => {
    const { t, as, manager, target } = await setup();
    const me = as(manager);
    await expect(me.mutation(api.maintenance.updateUser, { userId: target, name: "X" })).rejects.toThrow(/Forbidden/);
    await t.run(async (ctx) => { await ctx.db.patch("users", manager, { extraPermissions: ["maintenance.users"] }); });
    await me.mutation(api.maintenance.updateUser, { userId: target, name: "By manager" });
    expect((await me.query(api.maintenance.listUsers, {})).find((u) => u._id === target)?.name).toBe("By manager");
  });
});
