import { beforeAll, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";
import { PIN_PATTERN, pinLookupKey } from "./pinCrypto";

beforeAll(() => { process.env.PIN_LOOKUP_SECRET = "test-secret-for-pin-lookup"; });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const other = await ctx.db.insert("tenants", { name: "Hotel", code: "HTL", isActive: true, createdByToken: "t", createdAt: now });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", tenantId, isActive: true });
    const juma = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "waiter", tenantId, isActive: true });
    const musa = await ctx.db.insert("users", { name: "Musa", username: "musa", role: "waiter", tenantId, isActive: true }); // same business as Juma
    const asha = await ctx.db.insert("users", { name: "Asha", username: "asha", role: "waitress", tenantId: other, isActive: true }); // another business
    return { boss, juma, musa, asha, tenantId, other };
  });
  return { t, ...ids };
}

describe("PIN-only sign-in: one PIN, one person", () => {
  it("accepts 4 to 6 digits only", () => {
    for (const ok of ["1234", "12345", "123456"]) expect(PIN_PATTERN.test(ok)).toBe(true);
    for (const bad of ["123", "1234567", "12a4", "", "12 34"]) expect(PIN_PATTERN.test(bad)).toBe(false);
  });

  it("the same PIN always gives the same fingerprint, different PINs differ", async () => {
    expect(await pinLookupKey("4821")).toBe(await pinLookupKey("4821"));
    expect(await pinLookupKey("4821")).not.toBe(await pinLookupKey("4822"));
  });

  it("refuses a PIN that somebody in the SAME business already has, but another business may use the same PIN", async () => {
    const { t, boss, juma, musa, asha, tenantId, other } = await setup();
    const lookup = await pinLookupKey("4821");
    await t.mutation(internal.maintenance.saveStaffPin, { userId: juma, actorId: boss, pinHash: "h1", pinLookup: lookup, enabled: true });
    await expect(t.mutation(internal.maintenance.saveStaffPin, { userId: musa, actorId: boss, pinHash: "h2", pinLookup: lookup, enabled: true })).rejects.toThrow(/tayari inatumika/);
    await expect(t.query(internal.maintenance.assertPinFree, { lookup, tenantId })).rejects.toThrow(/tayari inatumika/);
    expect(await t.query(internal.maintenance.assertPinFree, { lookup, tenantId, exceptUserId: juma })).toBe(true); // the owner may keep / re-save his own PIN
    // Another business is independent: the same PIN is free there and is saved without any message about the other business.
    expect(await t.query(internal.maintenance.assertPinFree, { lookup, tenantId: other })).toBe(true);
    await t.mutation(internal.maintenance.saveStaffPin, { userId: asha, actorId: boss, pinHash: "h3", pinLookup: lookup, enabled: true });
  });

  it("PIN sign-in lookup with a business only finds that business's person", async () => {
    const { t, boss, juma, asha, tenantId, other } = await setup();
    const lookup = await pinLookupKey("4821");
    await t.mutation(internal.maintenance.saveStaffPin, { userId: juma, actorId: boss, pinHash: "h1", pinLookup: lookup, enabled: true });
    await t.mutation(internal.maintenance.saveStaffPin, { userId: asha, actorId: boss, pinHash: "h3", pinLookup: lookup, enabled: true });
    expect(await t.query(internal.maintenance.findPinOwners, { lookup, tenantId })).toEqual([{ userId: juma, pinHash: "h1" }]);
    expect(await t.query(internal.maintenance.findPinOwners, { lookup, tenantId: other })).toEqual([{ userId: asha, pinHash: "h3" }]);
    expect(await t.query(internal.maintenance.tenantIdByCode, { code: " bar " })).toBe(tenantId);
    expect(await t.query(internal.maintenance.tenantIdByCode, { code: "NOPE" })).toBeNull();
  });

  it("finds the owner of a PIN, and only while he is active and allowed to use a PIN", async () => {
    const { t, boss, juma } = await setup();
    const lookup = await pinLookupKey("4821");
    await t.mutation(internal.maintenance.saveStaffPin, { userId: juma, actorId: boss, pinHash: "h1", pinLookup: lookup, enabled: true });
    expect(await t.query(internal.maintenance.findPinOwners, { lookup })).toEqual([{ userId: juma, pinHash: "h1" }]);
    await t.run(async (ctx) => { await ctx.db.patch("users", juma, { isActive: false }); });
    expect(await t.query(internal.maintenance.findPinOwners, { lookup })).toEqual([]);
    await t.run(async (ctx) => { await ctx.db.patch("users", juma, { isActive: true, pinLoginEnabled: false }); });
    expect(await t.query(internal.maintenance.findPinOwners, { lookup })).toEqual([]);
  });

  it("a disabled person's PIN can be given to somebody else", async () => {
    const { t, boss, juma, asha } = await setup();
    const lookup = await pinLookupKey("4821");
    await t.mutation(internal.maintenance.saveStaffPin, { userId: juma, actorId: boss, pinHash: "h1", pinLookup: lookup, enabled: true });
    await t.run(async (ctx) => { await ctx.db.patch("users", juma, { isActive: false }); });
    await t.mutation(internal.maintenance.saveStaffPin, { userId: asha, actorId: boss, pinHash: "h2", pinLookup: lookup, enabled: true });
  });

  it("many wrong PINs pause PIN sign-in for everybody; a right PIN clears the count", async () => {
    const { t, boss, juma } = await setup();
    await t.mutation(internal.maintenance.saveStaffPin, { userId: juma, actorId: boss, pinHash: "h1", pinLookup: await pinLookupKey("4821"), enabled: true });
    const now = Date.now();
    for (let i = 0; i < 29; i++) expect(await t.mutation(internal.maintenance.recordPinLogin, { success: false, now: now + i })).toBe(false);
    expect((await t.query(internal.maintenance.pinLoginState, { now: now + 40 })).locked).toBe(false);
    expect(await t.mutation(internal.maintenance.recordPinLogin, { userId: juma, success: true, now: now + 41 })).toBe(true); // failures start again from zero
    for (let i = 0; i < 30; i++) await t.mutation(internal.maintenance.recordPinLogin, { success: false, now: now + 100 + i });
    expect((await t.query(internal.maintenance.pinLoginState, { now: now + 200 })).locked).toBe(true);
    expect((await t.query(internal.maintenance.pinLoginState, { now: now + 6 * 60 * 1000 })).locked).toBe(false); // pause is short
  });

  it("an old PIN (saved before PIN-only sign-in) gets its fingerprint on first successful sign-in", async () => {
    const { t, juma } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch("users", juma, { pinHash: "old", pinLoginEnabled: true }); });
    expect((await t.query(internal.maintenance.legacyPinUsers, {})).users).toEqual([{ userId: juma, pinHash: "old" }]);
    const lookup = await pinLookupKey("4821");
    expect(await t.mutation(internal.maintenance.recordPinLogin, { userId: juma, success: true, now: Date.now(), upgradeLookup: lookup })).toBe(true);
    expect(await t.query(internal.maintenance.findPinOwners, { lookup })).toHaveLength(1);
    expect((await t.query(internal.maintenance.legacyPinUsers, {})).users).toEqual([]);
  });
});
