import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

/** Nobody is promoted to Super Admin: not by a manager, not by a user administrator, not even by a Super Admin. */
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const boss2 = await ctx.db.insert("users", { name: "Boss2", username: "boss2", role: "super_admin", isActive: true });
    const manager = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId, isActive: true, extraPermissions: ["maintenance.users"] });
    const staff = await ctx.db.insert("users", { name: "Staff", username: "staff", role: "cashier", tenantId, isActive: true });
    return { boss, boss2, manager, staff };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asBoss: as(ids.boss, 1), asManager: as(ids.manager, 2) };
}

describe("Super Admin cannot be handed out", () => {
  it("a manager who manages users cannot make anybody Super Admin", async () => {
    const { asManager, staff } = await setup();
    await expect(asManager.mutation(api.maintenance.updateUser, { userId: staff, role: "super_admin" })).rejects.toThrow(/Super Admin/);
  });

  it("not even a Super Admin can promote a user to Super Admin", async () => {
    const { asBoss, staff, t } = await setup();
    await expect(asBoss.mutation(api.maintenance.updateUser, { userId: staff, role: "super_admin" })).rejects.toThrow(/Hakuna anayeweza kupandishwa/);
    await expect(asBoss.mutation(api.maintenance.updateUser, { userId: staff, role: "Super Admin" })).rejects.toThrow(/Hakuna anayeweza kupandishwa/);
    expect((await t.run((ctx) => ctx.db.get("users", staff)))?.role).toBe("cashier");
  });

  it("saving an account that already is Super Admin with the same role still works", async () => {
    const { asBoss, boss2, t } = await setup();
    await asBoss.mutation(api.maintenance.updateUser, { userId: boss2, role: "super_admin", name: "Boss Two" });
    expect((await t.run((ctx) => ctx.db.get("users", boss2)))?.name).toBe("Boss Two");
  });
});
