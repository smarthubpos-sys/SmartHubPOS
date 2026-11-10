import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { logAudit, requirePermission, resolveWriteScope } from "./access";
import { applyAttendance } from "./attendance";
import { addDaysIso, businessNow, rowToSignOut } from "./attendanceMath";

/**
 * Fingerprint attendance machines (ZKTeco and similar). The machine itself knows WHO touched it; this system only receives
 * the punches (employee code + real time) through POST /attendance/punches, authenticated with a per-machine secret.
 *
 * Safety rules, all enforced here on the server:
 *  - the same punch sent twice (a retry) is stored once;
 *  - a second touch within DUPLICATE_WINDOW_MS is ignored (people double-tap; it must not sign them out);
 *  - a punch older than the employee's latest accepted punch is refused (it would flip in/out the wrong way);
 *  - future punches (clock far ahead) and very old ones are refused and left for a manager to enter by hand.
 */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;
export const MAX_FUTURE_MS = 10 * 60_000;
export const MAX_AGE_MS = 14 * 86_400_000;
export const MAX_BATCH = 100;

export type PunchStatus = "in" | "out" | "duplicate" | "already_received" | "unknown_employee" | "out_of_order" | "rejected" | "bad_time";

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
/** Constant-time comparison of two hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ─────────────── Managers: register / list / switch off / new key ─────────────── */

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "payroll.manage", "payroll");
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    if (!scope.tenantId) throw new ConvexError("Akaunti haijaunganishwa na ofisi (tenant).");
    const name = a.name.trim();
    if (name.length < 2 || name.length > 60) throw new ConvexError("Weka jina la kifaa (herufi 2 hadi 60).");
    const secret = newSecret();
    const id = await ctx.db.insert("attendanceDevices", { tenantId: scope.tenantId, branchId: scope.branchId, name, secretHash: await sha256Hex(secret), isActive: true, registeredBy: user._id, createdAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: "attendance_device_created", module: "payroll", referenceId: String(id), details: name });
    return { deviceId: id, key: `${id}.${secret}` }; // shown once
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "payroll.manage", "payroll");
    if (!user.tenantId) return [];
    const tenantId = user.tenantId;
    const rows = await ctx.db.query("attendanceDevices").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
    return rows.map((d) => ({ _id: d._id, name: d.name, isActive: d.isActive, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt }));
  },
});

async function ownDevice(ctx: MutationCtx, id: Id<"attendanceDevices">) {
  const user = await requirePermission(ctx, "payroll.manage", "payroll");
  const device = await ctx.db.get("attendanceDevices", id);
  if (!device || device.tenantId !== user.tenantId) throw new ConvexError("Kifaa hakipatikana.");
  return { user, device };
}

export const setActive = mutation({
  args: { deviceId: v.id("attendanceDevices"), isActive: v.boolean() },
  handler: async (ctx, a) => {
    const { user, device } = await ownDevice(ctx, a.deviceId);
    await ctx.db.patch("attendanceDevices", device._id, { isActive: a.isActive });
    await logAudit(ctx, user, { action: a.isActive ? "attendance_device_on" : "attendance_device_off", module: "payroll", referenceId: String(device._id), details: device.name });
    return null;
  },
});

export const newKey = mutation({
  args: { deviceId: v.id("attendanceDevices") },
  handler: async (ctx, a) => {
    const { user, device } = await ownDevice(ctx, a.deviceId);
    const secret = newSecret();
    await ctx.db.patch("attendanceDevices", device._id, { secretHash: await sha256Hex(secret) });
    await logAudit(ctx, user, { action: "attendance_device_key_changed", module: "payroll", referenceId: String(device._id), details: device.name });
    return { key: `${device._id}.${secret}` }; // the old key stops working at once
  },
});

/* ─────────────── Used by the HTTP route only ─────────────── */

export const authInfo = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("attendanceDevices", a.deviceId);
    const device = id ? await ctx.db.get("attendanceDevices", id) : null;
    return device ? { deviceId: device._id, secretHash: device.secretHash, isActive: device.isActive } : null;
  },
});

const punchArg = v.object({ code: v.string(), at: v.number(), direction: v.optional(v.union(v.literal("in"), v.literal("out"))) });

async function findEmployee(ctx: MutationCtx, tenantId: Id<"tenants">, code: string): Promise<Doc<"employees"> | "ambiguous" | null> {
  const seen = new Map<string, Doc<"employees">>();
  for (const c of new Set([code, code.toUpperCase()])) {
    for (const e of await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("employeeCode", c)).take(20)) if (e.tenantId === tenantId) seen.set(String(e._id), e);
  }
  const rows = [...seen.values()].filter((e) => e.isActive);
  if (rows.length > 1) return "ambiguous";
  return rows[0] ?? null;
}

export const ingest = internalMutation({
  args: { deviceId: v.id("attendanceDevices"), punches: v.array(punchArg) },
  handler: async (ctx, a) => {
    const device = await ctx.db.get("attendanceDevices", a.deviceId);
    if (!device || !device.isActive) throw new ConvexError("Kifaa hakijaruhusiwa.");
    if (a.punches.length > MAX_BATCH) throw new ConvexError(`Rekodi nyingi sana kwa mara moja (juu ni ${MAX_BATCH}).`);
    const receivedAt = Date.now();
    await ctx.db.patch("attendanceDevices", device._id, { lastSeenAt: receivedAt });

    // Oldest first, so a batch is applied in the order the people touched the machine.
    const ordered = a.punches.map((p, index) => ({ ...p, index })).sort((x, y) => x.at - y.at || x.index - y.index);
    const out: { index: number; code: string; at: number; status: PunchStatus; message?: string }[] = [];

    for (const p of ordered) {
      const code = p.code.trim().toUpperCase();
      const log = async (status: PunchStatus, message?: string) => {
        if (status !== "already_received") await ctx.db.insert("devicePunches", { tenantId: device.tenantId, deviceId: device._id, employeeCode: code, punchedAt: p.at, result: status, message, receivedAt });
        out.push({ index: p.index, code, at: p.at, status, message });
      };
      if (!code || code.length > 32) { await log("unknown_employee", "Namba ya mfanyakazi si sahihi."); continue; }
      if (!Number.isFinite(p.at) || p.at > receivedAt + MAX_FUTURE_MS || p.at < receivedAt - MAX_AGE_MS) { await log("bad_time", "Saa ya rekodi si sahihi (mbele sana au zamani sana). Manager aiingize kwa mkono."); continue; }

      // The same punch again (the bridge retried after a network failure): nothing to do.
      const same = await ctx.db.query("devicePunches").withIndex("by_device_code_time", (q) => q.eq("deviceId", device._id).eq("employeeCode", code).eq("punchedAt", p.at)).first();
      if (same) { await log("already_received"); continue; }

      const employee = await findEmployee(ctx, device.tenantId, code);
      if (employee === "ambiguous") { await log("unknown_employee", "Namba hii inalingana na wafanyakazi zaidi ya mmoja."); continue; }
      if (!employee) { await log("unknown_employee", "Namba hii haipo kwenye wafanyakazi wanaofanya kazi."); continue; }

      // Latest punch of this employee that was really applied (in/out) or ignored as a double-tap.
      const recent = await ctx.db.query("devicePunches").withIndex("by_tenant_code_time", (q) => q.eq("tenantId", device.tenantId).eq("employeeCode", code)).order("desc").take(20);
      const lastApplied = recent.find((r) => r.result === "in" || r.result === "out");
      if (lastApplied && p.at < lastApplied.punchedAt) { await log("out_of_order", "Rekodi ni ya zamani kuliko ya mwisho iliyokubaliwa."); continue; }
      if (lastApplied && p.at - lastApplied.punchedAt < DUPLICATE_WINDOW_MS) { await log("duplicate", "Kugusa mara mbili kwa haraka; imepuuzwa."); continue; }

      // In or out? Without a direction from the machine: a person with an open shift signs out, anyone else signs in.
      const now = businessNow(p.at);
      let kind: "in" | "out";
      if (p.direction) kind = p.direction;
      else {
        const today = await ctx.db.query("attendance").withIndex("by_employee_date", (q) => q.eq("employeeId", employee._id).eq("date", now.date)).first();
        const yesterday = today?.signInTime ? null : await ctx.db.query("attendance").withIndex("by_employee_date", (q) => q.eq("employeeId", employee._id).eq("date", addDaysIso(now.date, -1))).first();
        const open = rowToSignOut(today, yesterday, now.date, now.minutes);
        kind = open?.signInTime && !open.signOutTime ? "out" : "in";
      }
      try {
        await applyAttendance(ctx, { employee, kind, userId: device.registeredBy, method: `fingerprint machine: ${device.name}`, tzOffset: 0, atMs: p.at });
        await log(kind);
      } catch (e) {
        // A rule said no (already signed in today, already signed out, left the company…). Nothing was written for this punch.
        await log("rejected", e instanceof ConvexError && typeof e.data === "string" ? e.data : "Imekataliwa.");
      }
    }
    return out.sort((x, y) => x.index - y.index);
  },
});
