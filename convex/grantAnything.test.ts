import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", tenantId, isActive: true });
    // a cashier whose menu is limited to Sales
    const cashier = await ctx.db.insert("users", { name: "Neema", username: "neema", role: "cashier", tenantId, isActive: true, menuAccess: ["dashboard", "sales"] });
    // a user administrator who is NOT a Super Admin
    const admin = await ctx.db.insert("users", { name: "Admin", username: "adm", role: "cashier", tenantId, isActive: true, extraPermissions: ["maintenance.users"] });
    const target = await ctx.db.insert("users", { name: "Target", username: "target", role: "viewer", tenantId, isActive: true });
    return { boss, cashier, admin, target };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asBoss: as(ids.boss, 1), asCashier: as(ids.cashier, 2), asAdmin: as(ids.admin, 3) };
}

const account = { code: "9100", name: "Test account", type: "asset" };

describe("when the Super Admin says yes, the user does not meet a no", () => {
  it("a permission outside the old short list works, and its menu module is opened with it", async () => {
    const { asBoss, asCashier, cashier, t } = await setup();
    await expect(asCashier.mutation(api.accounting.createAccount, account)).rejects.toThrow(/Forbidden/); // before: no

    await asBoss.mutation(api.maintenance.updateUser, { userId: cashier, extraPermissions: ["accounts.manage", "accounts.view"] });

    const row = await t.run((ctx) => ctx.db.get("users", cashier));
    expect(row?.extraPermissions).toEqual(["accounts.manage", "accounts.view"]);
    expect(row?.menuAccess).toEqual(expect.arrayContaining(["sales", "accounts"])); // "Accounts" is no longer hidden from him
    await expect(asCashier.mutation(api.accounting.createAccount, account)).resolves.toBeTruthy(); // after: yes
  });

  it("payroll.manage is honoured by the payroll screens, which used to ask for a manager only", async () => {
    const { asBoss, asCashier, cashier } = await setup();
    await asBoss.mutation(api.maintenance.updateUser, { userId: cashier, extraPermissions: ["payroll.manage"] });
    expect(await asCashier.query(api.maintenance.myPermissions, {})).toContain("payroll.manage");
  });

  it("another user administrator can still give only the short grantable list", async () => {
    const { asAdmin, target } = await setup();
    await expect(asAdmin.mutation(api.maintenance.updateUser, { userId: target, extraPermissions: ["accounts.manage"] })).rejects.toThrow();
  });
});
