import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const DOMAIN = "login.smarthub.invalid";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const mk = (n: string, c: string) => ctx.db.insert("tenants", { name: n, code: c, isActive: true, createdByToken: "t", createdAt: now });
    const T = await mk("Shop", "T"); const U = await mk("Other", "U");
    const user = async (username: string, role: string, tenantId: typeof T, withLogin = true) => {
      const id = await ctx.db.insert("users", { name: username, username, email: `${username}@${DOMAIN}`, role, tenantId, isActive: true });
      if (withLogin) await ctx.db.insert("authAccounts", { userId: id, provider: "password", providerAccountId: `${username}@${DOMAIN}`, secret: "HASH-" + username });
      return id;
    };
    return { admin: await user("boss", "admin", T), staff: await user("juma", "cashier", T), staff2: await user("amina", "cashier", T), nologin: await user("ghost", "cashier", T, false), foreign: await user("zed", "cashier", U) };
  });
  const as = (id: typeof ids.admin, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, asAdmin: as(ids.admin, 1), asStaff: as(ids.staff, 2), ...ids };
}
const loginKeys = (t: Awaited<ReturnType<typeof setup>>["t"]) => t.run(async (ctx) => (await ctx.db.query("authAccounts").collect()).map((r) => r.providerAccountId).sort());

describe("username change keeps login consistent", () => {
  it("moves the login key with the username, keeps the password hash, old name stops existing", async () => {
    const { t, asAdmin, staff } = await setup();
    expect(await asAdmin.mutation(api.maintenance.renameUsername, { userId: staff, newUsername: "  Juma.New " })).toEqual({ username: "juma.new" });
    const after = await t.run(async (ctx) => ({ u: await ctx.db.get("users", staff), acc: await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", staff).eq("provider", "password")).first(), accounts: (await ctx.db.query("authAccounts").collect()).length }));
    expect(after.u?.username).toBe("juma.new");
    expect(after.acc?.providerAccountId).toBe(`juma.new@${DOMAIN}`);
    expect(after.acc?.secret).toBe("HASH-juma"); // password untouched, no second account
    expect(after.accounts).toBe(5 - 1); // no extra account created (4 users have logins)
    expect(await loginKeys(t)).not.toContain(`juma@${DOMAIN}`);
    expect(await t.run(async (ctx) => await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "juma")).first())).toBeNull();
  });

  it("rejects duplicates, invalid input and a no-login account, leaving everything unchanged (rollback)", async () => {
    const { t, asAdmin, staff, nologin } = await setup();
    const before = await loginKeys(t);
    await expect(asAdmin.mutation(api.maintenance.renameUsername, { userId: staff, newUsername: "amina" })).rejects.toThrow(/tayari inatumika/);
    await expect(asAdmin.mutation(api.maintenance.renameUsername, { userId: staff, newUsername: "ab" })).rejects.toThrow(/Username/);
    await expect(asAdmin.mutation(api.maintenance.renameUsername, { userId: staff, newUsername: "has space" })).rejects.toThrow(/Username/);
    await expect(asAdmin.mutation(api.maintenance.renameUsername, { userId: nologin, newUsername: "ghost2" })).rejects.toThrow(/login/);
    expect(await t.run(async (ctx) => (await ctx.db.get("users", nologin))?.username)).toBe("ghost"); // not half-renamed
    expect(await loginKeys(t)).toEqual(before);
  });

  it("is refused for non-admins and across businesses", async () => {
    const { asAdmin, asStaff, staff2, foreign } = await setup();
    await expect(asStaff.mutation(api.maintenance.renameUsername, { userId: staff2, newUsername: "amina2" })).rejects.toThrow(/Forbidden/);
    await expect(asAdmin.mutation(api.maintenance.renameUsername, { userId: foreign, newUsername: "zed2" })).rejects.toThrow();
  });
});
