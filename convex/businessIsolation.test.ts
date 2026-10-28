import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const DOMAIN = "login.smarthub.invalid";

/** Two businesses. Business A already has "admin" with the OLD (plain) login identity; business B has a user "boss" with the new scoped identity. */
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const mk = (n: string, c: string) => ctx.db.insert("tenants", { name: n, code: c, isActive: true, createdByToken: "t", createdAt: now });
    const A = await mk("Alpha", "ALPHA"); const B = await mk("Racruz", "RACRUZ");
    const adminA = await ctx.db.insert("users", { name: "admin", username: "admin", email: `admin@${DOMAIN}`, role: "admin", tenantId: A, isActive: true });
    await ctx.db.insert("authAccounts", { userId: adminA, provider: "password", providerAccountId: `admin@${DOMAIN}`, secret: "HASH-A" });
    const adminB = await ctx.db.insert("users", { name: "boss", username: "boss", email: `boss@${String(B).toLowerCase()}.${DOMAIN}`, role: "admin", tenantId: B, isActive: true });
    const staffB = await ctx.db.insert("users", { name: "juma", username: "juma", email: `juma@${String(B).toLowerCase()}.${DOMAIN}`, role: "cashier", tenantId: B, isActive: true });
    await ctx.db.insert("authAccounts", { userId: staffB, provider: "password", providerAccountId: `juma@${String(B).toLowerCase()}.${DOMAIN}`, secret: "HASH-J" });
    return { A, B, adminA, adminB, staffB };
  });
  return { t, ...ids, asBossB: t.withIdentity({ subject: ids.adminB, tokenIdentifier: "x|1" }) };
}

describe("every business is independent", () => {
  it("a username used by business A is still free in business B (and the name check never looks at other businesses)", async () => {
    const { t, A, B } = await setup();
    const free = await t.query(internal.maintenance.usernameStatus, { username: "admin", tenantId: B, email: `admin@${String(B).toLowerCase()}.${DOMAIN}` });
    expect(free.taken).toBe(false);
    const taken = await t.query(internal.maintenance.usernameStatus, { username: "admin", tenantId: A, email: `admin@${String(A).toLowerCase()}.${DOMAIN}` });
    expect(taken.taken).toBe(true);
    expect(taken.suggestions[0]).toBe("admin1");
  });

  it("renaming inside a business only clashes with that business", async () => {
    const { t, asBossB, staffB, adminA, adminB } = await setup();
    // "admin" exists in business A only: business B may use it.
    expect(await asBossB.mutation(api.maintenance.renameUsername, { userId: staffB, newUsername: "admin" })).toEqual({ username: "admin" });
    const after = await t.run(async (ctx) => ({ b: await ctx.db.get("users", staffB), a: await ctx.db.get("users", adminA) }));
    expect(after.b?.username).toBe("admin");
    expect(after.a?.username).toBe("admin"); // business A untouched
    expect(after.b?.email).not.toBe(after.a?.email); // two different sign-in identities
    // But a second "admin" inside business B is refused.
    await expect(asBossB.mutation(api.maintenance.renameUsername, { userId: adminB, newUsername: "admin" })).rejects.toThrow(/tayari inatumika/);
  });

  it("the login screen resolves a name inside the business it was typed for", async () => {
    const { t, B } = await setup();
    expect(await t.query(api.users.resolveLoginEmail, { business: " racruz ", username: "JUMA" })).toBe(`juma@${String(B).toLowerCase()}.${DOMAIN}`);
    expect(await t.query(api.users.resolveLoginEmail, { business: "ALPHA", username: "admin" })).toBe(`admin@${DOMAIN}`); // old accounts keep working
    // Wrong business, unknown business or unknown name: a harmless identity that cannot sign in, never a hint about what exists.
    expect(await t.query(api.users.resolveLoginEmail, { business: "ALPHA", username: "juma" })).toBe(`juma@unknown.${DOMAIN}`);
    expect(await t.query(api.users.resolveLoginEmail, { business: "NOPE", username: "juma" })).toBe(`juma@unknown.${DOMAIN}`);
  });
});
