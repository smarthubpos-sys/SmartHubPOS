import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";
import { pinLookupKey } from "./pinCrypto";

/* ───── WebAuthn test helpers (same shape as features.test.ts) ───── */
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (s: string) => new TextEncoder().encode(s);
function rawToDer(raw: Uint8Array) {
  const int = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let x = b.slice(i); if (x[0] & 0x80) x = new Uint8Array([0, ...x]); return [0x02, x.length, ...x]; };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}
async function assertion(key: CryptoKeyPair, challenge: string, counter: number) {
  const rp = new Uint8Array(await crypto.subtle.digest("SHA-256", enc("localhost")));
  const authData = new Uint8Array([...rp, 0x05, 0, 0, 0, counter]);
  const clientDataJSON = enc(JSON.stringify({ type: "webauthn.get", challenge, origin: "http://localhost:5173" }));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new Uint8Array([...authData, ...hash])));
  return { authenticatorData: b64u(authData), clientDataJSON: b64u(clientDataJSON), signature: b64u(rawToDer(raw)) };
}
const newKey = () => crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const at = (iso: string) => vi.setSystemTime(new Date(iso));

/** Monday 2026-10-26 05:00 UTC = 08:00 business time (East Africa, UTC+3). */
async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-10-26T05:00:00Z");
  vi.stubEnv("APP_ORIGIN", "http://localhost:5173");
  vi.stubEnv("PIN_LOOKUP_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  const lookup = await pinLookupKey("4321");
  const ids = await t.run(async (ctx) => {
    const tenant = await ctx.db.insert("tenants", { name: "Hotel", code: "H", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId: tenant, isActive: true });
    const kiosk = await ctx.db.insert("users", { name: "Kifaa", username: "kifaa", role: "attendance", tenantId: tenant, isActive: true });
    const waiter = await ctx.db.insert("users", { name: "Wai", username: "wai", role: "waiter", tenantId: tenant, isActive: true });
    const mk = (code: string, name: string) => ctx.db.insert("employees", { tenantId: tenant, employeeCode: code, name, startDate: "2026-01-01", basicSalary: 300000, salaryType: "monthly", isActive: true });
    const asha = await mk("E1", "Asha");
    const juma = await mk("E2", "Juma");
    // Asha also has a login with a Staff PIN, linked to her employee record.
    await ctx.db.insert("users", { name: "Asha", username: "asha", role: "waiter", tenantId: tenant, isActive: true, employeeId: asha, pinLoginEnabled: true, pinLookup: lookup });
    return { tenant, mgr, kiosk, waiter, asha, juma };
  });
  const asMgr = t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|1" });
  const asKiosk = t.withIdentity({ subject: ids.kiosk, tokenIdentifier: "x|2" });
  const asWaiter = t.withIdentity({ subject: ids.waiter, tokenIdentifier: "x|3" });
  const keys = { asha: await newKey(), juma: await newKey() };
  for (const [name, emp, key] of [["asha", ids.asha, keys.asha], ["juma", ids.juma, keys.juma]] as const) {
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", key.publicKey));
    const reg = await asMgr.mutation(api.biometric.registerOptions, { employeeId: emp });
    await asMgr.mutation(api.biometric.finishRegistration, { employeeId: emp, challenge: reg.challenge, credentialId: `cred-${name}`, publicKey: b64u(spki), algorithm: -7, clientDataJSON: b64u(enc(JSON.stringify({ type: "webauthn.create", challenge: reg.challenge, origin: "http://localhost:5173" }))) });
  }
  return { t, asMgr, asKiosk, asWaiter, keys, ...ids };
}
beforeEach(() => { vi.stubEnv("APP_ORIGIN", "http://localhost:5173"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("shared work device: naming the employee first", () => {
  it("identifies by employee number (any letter case) and by Staff PIN", async () => {
    const { asKiosk, asha } = await setup();
    const byCode = await asKiosk.mutation(api.kiosk.identify, { identifier: " e1 " });
    expect(byCode).toMatchObject({ ok: true, employeeName: "Asha", employeeCode: "E1", credentialIds: ["cred-asha"] });
    const byPin = await asKiosk.mutation(api.kiosk.identify, { identifier: "4321" });
    expect(byPin).toMatchObject({ ok: true, employeeName: "Asha" });
    expect(asha).toBeTruthy();
  });

  it("refuses unknown numbers and pauses after repeated wrong ones", async () => {
    const { asKiosk } = await setup();
    for (let i = 0; i < 5; i++) expect(await asKiosk.mutation(api.kiosk.identify, { identifier: `NOPE${i}` })).toMatchObject({ ok: false, locked: false });
    // Paused: even the right number is refused for now.
    expect(await asKiosk.mutation(api.kiosk.identify, { identifier: "E1" })).toMatchObject({ ok: false, locked: true });
    at("2026-10-26T05:06:00Z");
    expect(await asKiosk.mutation(api.kiosk.identify, { identifier: "E1" })).toMatchObject({ ok: true });
  });

  it("an employee with no fingerprint registered is told to see HR (and nothing is issued)", async () => {
    const { asKiosk, t, tenant } = await setup();
    await t.run(async (ctx) => { await ctx.db.insert("employees", { tenantId: tenant, employeeCode: "E9", name: "Mpya", startDate: "2026-01-01", basicSalary: 1, salaryType: "monthly", isActive: true }); });
    const r = await asKiosk.mutation(api.kiosk.identify, { identifier: "E9" });
    expect(r).toMatchObject({ ok: false, locked: false });
    expect(await t.run((ctx) => ctx.db.query("biometricChallenges").collect())).toHaveLength(0);
  });

  it("only accounts with the kiosk permission may use it", async () => {
    const { asWaiter } = await setup();
    await expect(asWaiter.mutation(api.kiosk.identify, { identifier: "E1" })).rejects.toThrow(/Forbidden/);
  });

  it("the kiosk account cannot open the 'any name' prompt, with or without a challenge", async () => {
    const { asKiosk, t, kiosk, keys } = await setup();
    await expect(asKiosk.mutation(api.biometric.authOptions, {})).rejects.toThrow(/namba yako kwanza/);
    const challenge = "open-challenge-1";
    await t.run(async (ctx) => { await ctx.db.insert("biometricChallenges", { challenge, purpose: "auth", userId: kiosk, expiresAt: Date.now() + 120000 }); });
    await expect(asKiosk.mutation(api.biometric.authenticate, { challenge, credentialId: "cred-asha", kind: "in", tzOffset: 0, ...(await assertion(keys.asha, challenge, 1)) })).rejects.toThrow(/namba yako kwanza/);
  });

  it("signs the employee in when the right fingerprint follows the number", async () => {
    const { asKiosk, t, keys, asha } = await setup();
    const id = await asKiosk.mutation(api.kiosk.identify, { identifier: "E1" });
    if (!id.ok) throw new Error("expected ok");
    const r = await asKiosk.mutation(api.biometric.authenticate, { challenge: id.challenge, credentialId: "cred-asha", kind: "in", tzOffset: 0, ...(await assertion(keys.asha, id.challenge, 1)) });
    expect(r).toMatchObject({ employeeName: "Asha", time: "08:00" });
    const rows = await t.run((ctx) => ctx.db.query("attendance").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employeeId: asha, signInTime: "08:00" });
  });

  it("refuses the fingerprint of a colleague even though a valid name was typed", async () => {
    const { asKiosk, t, keys } = await setup();
    const id = await asKiosk.mutation(api.kiosk.identify, { identifier: "E1" });
    if (!id.ok) throw new Error("expected ok");
    await expect(asKiosk.mutation(api.biometric.authenticate, { challenge: id.challenge, credentialId: "cred-juma", kind: "in", tzOffset: 0, ...(await assertion(keys.juma, id.challenge, 1)) })).rejects.toThrow(/si ya mfanyakazi aliyejitambulisha/);
    expect(await t.run((ctx) => ctx.db.query("attendance").collect())).toHaveLength(0);
  });

  it("a manager's own sign-in screen still works as before (open prompt, name picked afterwards)", async () => {
    const { asMgr, keys } = await setup();
    const { challenge } = await asMgr.mutation(api.biometric.authOptions, {});
    const r = await asMgr.mutation(api.biometric.authenticate, { challenge, credentialId: "cred-juma", kind: "in", tzOffset: 0, ...(await assertion(keys.juma, challenge, 1)) });
    expect(r.employeeName).toBe("Juma");
  });
});

describe("night shift: signing out after midnight", () => {
  it("closes yesterday's open sign-in and counts the hours across midnight", async () => {
    const { asMgr, t, asha } = await setup();
    at("2026-10-26T17:00:00Z"); // Monday 20:00
    await asMgr.mutation(api.attendance.recordManual, { employeeId: asha, kind: "in", tzOffset: 0 });
    at("2026-10-26T23:00:00Z"); // Tuesday 02:00
    const out = await asMgr.mutation(api.attendance.recordManual, { employeeId: asha, kind: "out", tzOffset: 0 });
    expect(out).toMatchObject({ hoursWorked: 6, overnight: true, date: "2026-10-26" });
    const rows = await t.run((ctx) => ctx.db.query("attendance").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-10-26", signInTime: "20:00", signOutTime: "02:00", hoursWorked: 6 });
    // Cannot be signed out twice.
    await expect(asMgr.mutation(api.attendance.recordManual, { employeeId: asha, kind: "out", tzOffset: 0 })).rejects.toThrow(/Hajaingia kazini leo/);
  });

  it("an ordinary day shift is unchanged", async () => {
    const { asMgr, asha } = await setup();
    await asMgr.mutation(api.attendance.recordManual, { employeeId: asha, kind: "in", tzOffset: 0 });
    at("2026-10-26T14:00:00Z"); // 17:00
    expect(await asMgr.mutation(api.attendance.recordManual, { employeeId: asha, kind: "out", tzOffset: 0 })).toMatchObject({ hoursWorked: 9, overnight: false });
  });

  it("a sign-in forgotten for more than 18 hours is not closed by the next day's sign-out", async () => {
    const { asMgr, asha } = await setup();
    await asMgr.mutation(api.attendance.recordManual, { employeeId: asha, kind: "in", tzOffset: 0 }); // Monday 08:00
    at("2026-10-27T05:00:00Z"); // Tuesday 08:00 (24 h later)
    await expect(asMgr.mutation(api.attendance.recordManual, { employeeId: asha, kind: "out", tzOffset: 0 })).rejects.toThrow(/Hajaingia kazini leo/);
  });

  it("today's list shows a night shift still at work as present, not absent", async () => {
    const { asMgr, asha } = await setup();
    at("2026-10-26T17:00:00Z"); // Monday 20:00
    await asMgr.mutation(api.attendance.recordManual, { employeeId: asha, kind: "in", tzOffset: 0 });
    at("2026-10-26T22:00:00Z"); // Tuesday 01:00
    const rows = await asMgr.query(api.attendance.today, { date: "2026-10-27" });
    const row = rows.find((r) => r.employeeId === asha);
    expect(row).toMatchObject({ signInTime: "20:00", carriedFrom: "2026-10-26", status: "present" });
    expect(rows.find((r) => r.name === "Juma")?.carriedFrom).toBeUndefined();
  });
});
