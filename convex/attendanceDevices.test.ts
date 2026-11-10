import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";
import { parsePunchTime } from "./http";

/** Monday 2026-10-26 05:00 UTC = 08:00 business time (East Africa, UTC+3). */
const T0 = Date.parse("2026-10-26T05:00:00Z");
const min = (n: number) => n * 60_000;

async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0 + min(30))); // the system clock is 08:30; punches may be older than that
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenant = await ctx.db.insert("tenants", { name: "Hotel", code: "H", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const other = await ctx.db.insert("tenants", { name: "Duka", code: "D", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId: tenant, isActive: true });
    const waiter = await ctx.db.insert("users", { name: "Wai", username: "wai", role: "waiter", tenantId: tenant, isActive: true });
    const mk = (tenantId: typeof tenant, code: string, name: string) => ctx.db.insert("employees", { tenantId, employeeCode: code, name, startDate: "2026-01-01", basicSalary: 300000, salaryType: "monthly", isActive: true });
    const asha = await mk(tenant, "E1", "Asha");
    const juma = await mk(tenant, "E2", "Juma");
    const outsider = await mk(other, "X9", "Mgeni");
    return { tenant, mgr, waiter, asha, juma, outsider };
  });
  const asMgr = t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|1" });
  const asWaiter = t.withIdentity({ subject: ids.waiter, tokenIdentifier: "x|2" });
  const { key, deviceId } = await asMgr.mutation(api.attendanceDevices.create, { name: "Mlango Mkuu" });
  const post = (punches: unknown, bearer: string | null = key) =>
    t.fetch("/attendance/punches", { method: "POST", headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify({ punches }) });
  const rows = (employeeId: typeof ids.asha) => t.run((ctx) => ctx.db.query("attendance").withIndex("by_employee", (q) => q.eq("employeeId", employeeId)).collect());
  return { t, asMgr, asWaiter, key, deviceId, post, rows, ...ids };
}
beforeEach(() => { /* each test builds its own world */ });
afterEach(() => { vi.useRealTimers(); });

describe("fingerprint machine punches", () => {
  it("signs a person in with the time of the touch, then out on the next touch", async () => {
    const s = await setup();
    const r1 = await s.post([{ code: "E1", at: T0 + min(5) }]); // touched at 08:05, delivered at 08:30
    expect(r1.status).toBe(200);
    expect((await r1.json()).results[0].status).toBe("in");
    let rec = (await s.rows(s.asha))[0];
    expect(rec.signInTime).toBe("08:05");
    expect(rec.status).toBe("present");
    expect(rec.notes).toContain("fingerprint machine");

    vi.setSystemTime(new Date(T0 + min(600)));
    const r2 = await s.post([{ code: "e1", at: T0 + min(560) }]); // lower-case code, touched at 17:20
    expect((await r2.json()).results[0].status).toBe("out");
    rec = (await s.rows(s.asha))[0];
    expect(rec.signOutTime).toBe("17:20");
    expect(rec.hoursWorked).toBeCloseTo(9.25, 2);
  });

  it("ignores a double-tap and a repeated delivery of the same punch", async () => {
    const s = await setup();
    await s.post([{ code: "E1", at: T0 + min(5) }]);
    const tap = await s.post([{ code: "E1", at: T0 + min(6) }]);
    expect((await tap.json()).results[0].status).toBe("duplicate");
    const retry = await s.post([{ code: "E1", at: T0 + min(5) }]);
    expect((await retry.json()).results[0].status).toBe("already_received");
    const rec = await s.rows(s.asha);
    expect(rec).toHaveLength(1);
    expect(rec[0].signOutTime).toBeUndefined(); // the double-tap did not sign him out
  });

  it("refuses a punch older than the latest one already applied", async () => {
    const s = await setup();
    await s.post([{ code: "E1", at: T0 + min(20) }]);
    const old = await s.post([{ code: "E1", at: T0 + min(5) }]);
    expect((await old.json()).results[0].status).toBe("out_of_order");
  });

  it("applies a batch oldest first whatever order it arrives in", async () => {
    const s = await setup();
    vi.setSystemTime(new Date(T0 + min(400))); // delivered at 14:40, after the touches
    const res = await s.post([{ code: "E1", at: T0 + min(300) }, { code: "E1", at: T0 + min(5) }, { code: "E2", at: T0 + min(7) }]);
    const body = await res.json();
    expect(body.results.map((r: { status: string }) => r.status)).toEqual(["out", "in", "in"]);
    expect((await s.rows(s.asha))[0].signOutTime).toBe("13:00");
  });

  it("does not match a person from another business, nor an unknown number", async () => {
    const s = await setup();
    const res = await s.post([{ code: "X9", at: T0 + min(5) }, { code: "NOPE", at: T0 + min(5) }]);
    expect((await res.json()).results.map((r: { status: string }) => r.status)).toEqual(["unknown_employee", "unknown_employee"]);
    expect(await s.rows(s.outsider)).toHaveLength(0);
  });

  it("refuses punches from the future and very old ones", async () => {
    const s = await setup();
    const res = await s.post([{ code: "E1", at: T0 + min(30) + min(60) }, { code: "E2", at: T0 - 20 * 86_400_000 }]);
    expect((await res.json()).results.map((r: { status: string }) => r.status)).toEqual(["bad_time", "bad_time"]);
  });

  it("honours a direction sent by the machine, and says why when the rules refuse it", async () => {
    const s = await setup();
    const res = await s.post([{ code: "E1", at: T0 + min(5), direction: "out" }]);
    const r = (await res.json()).results[0];
    expect(r.status).toBe("rejected");
    expect(r.message).toMatch(/Hajaingia/);
    expect(await s.rows(s.asha)).toHaveLength(0);
  });
});

describe("who may send punches and who may manage machines", () => {
  it("answers 401 to a missing, malformed, wrong or switched-off key", async () => {
    const s = await setup();
    const punch = [{ code: "E1", at: T0 + min(5) }];
    expect((await s.post(punch, null)).status).toBe(401);
    expect((await s.post(punch, "garbage")).status).toBe(401);
    expect((await s.post(punch, `${s.deviceId}.wrong-secret`)).status).toBe(401);
    await s.asMgr.mutation(api.attendanceDevices.setActive, { deviceId: s.deviceId, isActive: false });
    expect((await s.post(punch)).status).toBe(401);
    expect(await s.rows(s.asha)).toHaveLength(0);
    await s.asMgr.mutation(api.attendanceDevices.setActive, { deviceId: s.deviceId, isActive: true });
    expect((await s.post(punch)).status).toBe(200);
  });

  it("a new key stops the old one at once", async () => {
    const s = await setup();
    const fresh = await s.asMgr.mutation(api.attendanceDevices.newKey, { deviceId: s.deviceId });
    expect(fresh.key).not.toBe(s.key);
    expect((await s.post([{ code: "E1", at: T0 + min(5) }], s.key)).status).toBe(401);
    expect((await s.post([{ code: "E1", at: T0 + min(5) }], fresh.key)).status).toBe(200);
  });

  it("rejects bad bodies", async () => {
    const s = await setup();
    expect((await s.post([])).status).toBe(400);
    expect((await s.post([{ code: "E1", at: "yesterday" }])).status).toBe(400);
    expect((await s.post([{ code: "E1", at: T0, direction: "sideways" }])).status).toBe(400);
    expect((await s.post(Array.from({ length: 101 }, (_, i) => ({ code: "E1", at: T0 + i })))).status).toBe(413);
  });

  it("only a person with payroll management can register machines; the list never shows the key", async () => {
    const s = await setup();
    await expect(s.asWaiter.mutation(api.attendanceDevices.create, { name: "Kifaa" })).rejects.toThrow();
    await expect(s.asWaiter.query(api.attendanceDevices.list, {})).rejects.toThrow();
    const list = await s.asMgr.query(api.attendanceDevices.list, {});
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(s.key.split(".")[1]);
    expect(list[0].lastSeenAt).toBeUndefined();
    await s.post([{ code: "E1", at: T0 + min(5) }]);
    expect((await s.asMgr.query(api.attendanceDevices.list, {}))[0].lastSeenAt).toBeTypeOf("number");
  });
});

describe("parsePunchTime", () => {
  it("accepts epoch milliseconds and ISO text with a zone, nothing else", () => {
    expect(parsePunchTime(1766000000000)).toBe(1766000000000);
    expect(parsePunchTime("2026-10-26T08:05:00+03:00")).toBe(Date.parse("2026-10-26T05:05:00Z"));
    expect(parsePunchTime("2026-10-26T05:05:00Z")).toBe(Date.parse("2026-10-26T05:05:00Z"));
    expect(parsePunchTime("2026-10-26 08:05:00")).toBeNull(); // no zone: ambiguous
    expect(parsePunchTime(NaN)).toBeNull();
    expect(parsePunchTime(undefined)).toBeNull();
  });
});
