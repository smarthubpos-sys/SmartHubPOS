import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { MAX_BATCH, safeEqual, sha256Hex } from "./attendanceDevices";

const http = httpRouter();
auth.addHttpRoutes(http);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A time sent by the bridge: epoch milliseconds, or an ISO text that names its time zone (Z or +03:00). Anything else is refused. */
export function parsePunchTime(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value === "string" && /(Z|[+-]\d\d:\d\d)$/.test(value.trim())) {
    const ms = Date.parse(value.trim());
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * POST /attendance/punches   Authorization: Bearer <deviceId>.<secret>
 * Body: { "punches": [ { "code": "E12", "at": 1766000000000, "direction": "in" | "out" (optional) } ] }
 * Answer: { ok: true, results: [ { index, code, at, status, message? } ] }
 */
http.route({
  path: "/attendance/punches",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
    const dot = bearer.indexOf(".");
    const deviceId = dot > 0 ? bearer.slice(0, dot) : "";
    const secret = dot > 0 ? bearer.slice(dot + 1) : "";
    // One answer for every kind of credential failure, so nothing is learned from it.
    const denied = () => json(401, { ok: false, error: "unauthorized" });
    if (!deviceId || !secret || secret.length > 200) return denied();
    const device = await ctx.runQuery(internal.attendanceDevices.authInfo, { deviceId });
    const hash = await sha256Hex(secret);
    if (!device || !safeEqual(hash, device.secretHash) || !device.isActive) return denied();

    let body: unknown;
    try { body = await request.json(); } catch { return json(400, { ok: false, error: "invalid_json" }); }
    const list = (body as { punches?: unknown } | null)?.punches;
    if (!Array.isArray(list) || list.length === 0) return json(400, { ok: false, error: "punches_required" });
    if (list.length > MAX_BATCH) return json(413, { ok: false, error: `too_many_punches (max ${MAX_BATCH})` });

    const punches: { code: string; at: number; direction?: "in" | "out" }[] = [];
    for (const raw of list) {
      const r = raw as { code?: unknown; at?: unknown; direction?: unknown } | null;
      const at = parsePunchTime(r?.at);
      const code = typeof r?.code === "string" || typeof r?.code === "number" ? String(r.code) : "";
      if (!code || at === null || (r?.direction !== undefined && r.direction !== "in" && r.direction !== "out")) return json(400, { ok: false, error: "invalid_punch" });
      punches.push({ code, at, ...(r?.direction ? { direction: r.direction as "in" | "out" } : {}) });
    }
    const results = await ctx.runMutation(internal.attendanceDevices.ingest, { deviceId: device.deviceId, punches });
    return json(200, { ok: true, results });
  }),
});

export default http;
