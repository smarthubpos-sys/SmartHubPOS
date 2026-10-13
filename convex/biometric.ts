import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { canAccessRecord, filterScoped, logAudit, requireActiveUser, requireManager, scopedRows } from "./access";
import { applyAttendance } from "./attendance";

/**
 * Fingerprint / Face ID / Windows Hello sign-in through WebAuthn (platform authenticators).
 * The device does the biometric match; the server verifies the signed assertion against the public key
 * saved when the employee was enrolled, so a sign-in cannot be faked from the network.
 */
const b64uToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const bytesToB64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const concat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
const sha256 = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", d as BufferSource));
const parseClientData = (b64: string) => { try { return JSON.parse(new TextDecoder().decode(b64uToBytes(b64))); } catch { throw new Error("Taarifa za kifaa si sahihi."); } };

/** DER ECDSA signature -> raw r||s (64 bytes) as WebCrypto expects. */
function derToRaw(der: Uint8Array) {
  if (der[0] !== 0x30) return der;
  let i = 2; if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const readInt = () => { if (der[i] !== 0x02) throw new Error("Saini si sahihi."); const len = der[i + 1]; let int = der.slice(i + 2, i + 2 + len); i += 2 + len; while (int.length > 32 && int[0] === 0) int = int.slice(1); const out = new Uint8Array(32); out.set(int, 32 - int.length); return out; };
  const r = readInt(), s = readInt();
  return concat(r, s);
}

async function verifySignature(cred: { publicKey: string; algorithm: number }, data: Uint8Array, signature: Uint8Array) {
  const spki = b64uToBytes(cred.publicKey) as BufferSource;
  if (cred.algorithm === -7) {
    const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(signature) as BufferSource, data as BufferSource);
  }
  if (cred.algorithm === -257) {
    const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature as BufferSource, data as BufferSource);
  }
  throw new Error("Aina ya ufunguo wa kifaa haitumiki.");
}

async function newChallenge(ctx: any, userId: any, purpose: string, employeeId?: any) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const challenge = bytesToB64u(bytes);
  await ctx.db.insert("biometricChallenges", { challenge, purpose, employeeId, userId, expiresAt: Date.now() + 120000 });
  return challenge;
}
async function consumeChallenge(ctx: any, challenge: string, purpose: string, userId: any) {
  const row = await ctx.db.query("biometricChallenges").withIndex("by_challenge", (q: any) => q.eq("challenge", challenge)).first();
  if (!row || row.purpose !== purpose || String(row.userId) !== String(userId)) throw new Error("Ombi la uthibitisho si sahihi. Jaribu tena.");
  await ctx.db.delete(row._id);
  if (row.expiresAt < Date.now()) throw new Error("Muda wa uthibitisho umeisha. Jaribu tena.");
  return row;
}
function checkClientData(cd: any, type: string, challenge: string) {
  if (cd.type !== type || cd.challenge !== challenge) throw new Error("Uthibitisho wa kifaa umeshindikana.");
  const expected = process.env.APP_ORIGIN;
  if (expected && cd.origin !== expected) throw new Error("Chanzo cha ombi si sahihi.");
}

export const listCredentials = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await scopedRows(ctx, user, "biometricCredentials")).map((c) => ({ _id: c._id, employeeId: c.employeeId, label: c.label, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt }));
  },
});

export const credentialIds = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx);
    const e = await ctx.db.get(a.employeeId);
    if (!e || !canAccessRecord(user, e)) return [];
    return (await ctx.db.query("biometricCredentials").withIndex("by_employee", (q) => q.eq("employeeId", a.employeeId)).collect()).map((c) => c.credentialId);
  },
});

export const registerOptions = mutation({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx);
    const employee = await ctx.db.get(a.employeeId);
    if (!employee || !canAccessRecord(user, employee)) throw new Error("Mfanyakazi hapatikani.");
    const challenge = await newChallenge(ctx, user._id, "register", employee._id);
    const existing = await ctx.db.query("biometricCredentials").withIndex("by_employee", (q) => q.eq("employeeId", employee._id)).collect();
    return { challenge, employee: { id: String(employee._id), name: employee.name, code: employee.employeeCode }, exclude: existing.map((c) => c.credentialId) };
  },
});

export const finishRegistration = mutation({
  args: { employeeId: v.id("employees"), challenge: v.string(), credentialId: v.string(), publicKey: v.string(), algorithm: v.number(), clientDataJSON: v.string(), label: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx);
    const row = await consumeChallenge(ctx, a.challenge, "register", user._id);
    if (String(row.employeeId) !== String(a.employeeId)) throw new Error("Ombi la uthibitisho si sahihi. Jaribu tena.");
    checkClientData(parseClientData(a.clientDataJSON), "webauthn.create", a.challenge);
    if (![-7, -257].includes(a.algorithm)) throw new Error("Aina ya ufunguo wa kifaa haitumiki.");
    const employee = await ctx.db.get(a.employeeId);
    if (!employee || !canAccessRecord(user, employee)) throw new Error("Mfanyakazi hapatikani.");
    const dup = await ctx.db.query("biometricCredentials").withIndex("by_credential", (q) => q.eq("credentialId", a.credentialId)).first();
    if (dup) throw new Error("Kifaa hiki tayari kimesajiliwa.");
    const id = await ctx.db.insert("biometricCredentials", { tenantId: employee.tenantId, branchId: employee.branchId, employeeId: employee._id, credentialId: a.credentialId, publicKey: a.publicKey, algorithm: a.algorithm, counter: 0, label: a.label, createdAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: "enroll_biometric", module: "payroll", referenceId: String(employee._id), details: employee.name });
    return id;
  },
});

export const removeCredential = mutation({
  args: { id: v.id("biometricCredentials") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx);
    const c = await ctx.db.get(a.id);
    if (!c || !canAccessRecord(user, c)) throw new Error("Kifaa hakipatikani.");
    await ctx.db.delete(a.id);
    await logAudit(ctx, user, { action: "remove_biometric", module: "payroll", referenceId: String(c.employeeId) });
    return true;
  },
});

export const authOptions = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    const challenge = await newChallenge(ctx, user._id, "auth");
    return { challenge };
  },
});

export const authenticate = mutation({
  args: { challenge: v.string(), credentialId: v.string(), authenticatorData: v.string(), clientDataJSON: v.string(), signature: v.string(), kind: v.union(v.literal("in"), v.literal("out")), tzOffset: v.number() },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx);
    await consumeChallenge(ctx, a.challenge, "auth", user._id);
    const cd = parseClientData(a.clientDataJSON);
    checkClientData(cd, "webauthn.get", a.challenge);
    const cred = await ctx.db.query("biometricCredentials").withIndex("by_credential", (q) => q.eq("credentialId", a.credentialId)).first();
    if (!cred || !canAccessRecord(user, cred)) throw new Error("Alama hii haijasajiliwa kwenye biashara hii.");
    const authData = b64uToBytes(a.authenticatorData);
    if (authData.length < 37) throw new Error("Taarifa za kifaa si sahihi.");
    // The assertion must be bound to the origin that asked for it.
    const host = (() => { try { return new URL(cd.origin).hostname; } catch { throw new Error("Chanzo cha ombi si sahihi."); } })();
    const rpIdHash = await sha256(new TextEncoder().encode(host));
    if (!rpIdHash.every((b, i) => b === authData[i])) throw new Error("Uthibitisho wa kifaa umeshindikana.");
    const flags = authData[32];
    if (!(flags & 0x01) || !(flags & 0x04)) throw new Error("Alama ya kidole au uso haikuthibitishwa kwenye kifaa.");
    const counter = (authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36];
    if ((counter > 0 || cred.counter > 0) && counter <= cred.counter) throw new Error("Uthibitisho umekataliwa (huenda umerudiwa).");
    const signed = concat(authData, await sha256(b64uToBytes(a.clientDataJSON)));
    const ok = await verifySignature(cred, signed, b64uToBytes(a.signature));
    if (!ok) throw new Error("Uthibitisho wa alama umeshindikana.");
    const employee = await ctx.db.get(cred.employeeId);
    if (!employee) throw new Error("Mfanyakazi hapatikani.");
    const result = await applyAttendance(ctx, { employee, kind: a.kind, userId: user._id, method: "biometric", tzOffset: a.tzOffset });
    await ctx.db.patch(cred._id, { counter, lastUsedAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: a.kind === "in" ? "staff_sign_in" : "staff_sign_out", module: "payroll", referenceId: String(employee._id), details: `biometric ${result.time}` });
    return { ...result, employeeName: employee.name, employeeCode: employee.employeeCode };
  },
});
