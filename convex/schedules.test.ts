import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

/** Monday 2026-10-26 is 05:xx UTC = 08:xx business time. */
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const DAYS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, isOff: weekday === 0, startTime: weekday === 0 ? undefined : "08:00", endTime: weekday === 0 ? undefined : "17:00" }));

async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-10-26T04:00:00Z");
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenant = await ctx.db.insert("tenants", { name: "Duka", code: "D", isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId: tenant, isActive: true });
    const waiter = await ctx.db.insert("users", { name: "Wai", username: "wai", role: "waiter", tenantId: tenant, isActive: true });
    const mk = (code: string, name: string, salaryType = "monthly", basicSalary = 300000) => ctx.db.insert("employees", { tenantId: tenant, employeeCode: code, name, startDate: "2026-01-01", basicSalary, salaryType, isActive: true });
    return { tenant, mgr, waiter, asha: await mk("E1", "Asha"), juma: await mk("E2", "Juma"), daily: await mk("E3", "Daudi", "daily", 20000) };
  });
  const as = t.withIdentity({ subject: ids.mgr, tokenIdentifier: "x|1" });
  const asWaiter = t.withIdentity({ subject: ids.waiter, tokenIdentifier: "x|2" });
  await as.mutation(api.schedules.saveRules, { lateMode: "fixed", lateAmount: 5000, graceMinutes: 0, absentEnabled: true });
  await as.mutation(api.schedules.save, { employeeIds: [ids.asha, ids.juma, ids.daily] as Id<"employees">[], days: DAYS });
  return { t, as, asWaiter, ...ids };
}
afterEach(() => { vi.useRealTimers(); });

describe("sign-in lateness", () => {
  it("does not deduct at the exact start time but deducts from one minute after", async () => {
    const { t, as, asha, juma } = await setup();
    at("2026-10-26T05:00:30Z"); // 08:00
    const onTime = await as.mutation(api.attendance.recordManual, { employeeId: asha, kind: "in", tzOffset: 0 });
    expect([onTime.lateMinutes, onTime.lateDeduction, onTime.scheduledStart]).toEqual([0, 0, "08:00"]);
    at("2026-10-26T05:01:00Z"); // 08:01
    const late = await as.mutation(api.attendance.recordManual, { employeeId: juma, kind: "in", tzOffset: 0 });
    expect([late.lateMinutes, late.lateDeduction]).toEqual([1, 5000]);
    const rows = await t.run((ctx) => ctx.db.query("attendance").collect());
    expect(rows.map((r) => r.status).sort()).toEqual(["late", "present"]);
  });

  it("ignores the device's own time zone: the business clock decides", async () => {
    const { as, asha } = await setup();
    at("2026-10-26T05:00:00Z");
    const r = await as.mutation(api.attendance.recordManual, { employeeId: asha, kind: "in", tzOffset: -600 }); // a phone set to another zone
    expect([r.time, r.lateMinutes]).toEqual(["08:00", 0]);
  });

  it("is never late on the weekly day off, on a closed day, or without a timetable", async () => {
    const { as, asha, juma, daily, t } = await setup();
    at("2026-10-25T07:00:00Z"); // Sunday 10:00 = off day
    expect((await as.mutation(api.attendance.recordManual, { employeeId: asha, kind: "in", tzOffset: 0 })).lateDeduction).toBe(0);
    await as.mutation(api.schedules.addClosedDay, { date: "2026-10-26", reason: "Sikukuu" });
    at("2026-10-26T09:00:00Z"); // Monday 12:00 but closed
    expect((await as.mutation(api.attendance.recordManual, { employeeId: juma, kind: "in", tzOffset: 0 })).lateDeduction).toBe(0);
    await as.mutation(api.schedules.clear, { employeeId: daily });
    await t.run(async (ctx) => { for (const x of await ctx.db.query("offDays").collect()) await ctx.db.delete("offDays", x._id); });
    expect((await as.mutation(api.attendance.recordManual, { employeeId: daily, kind: "in", tzOffset: 0 })).lateDeduction).toBe(0);
  });

  it("can charge per minute and forgive a grace period", async () => {
    const { as, asha } = await setup();
    await as.mutation(api.schedules.saveRules, { lateMode: "per_minute", lateAmount: 100, graceMinutes: 5, absentEnabled: true });
    at("2026-10-26T05:05:00Z"); // 08:05, inside grace
    const r = await as.mutation(api.attendance.recordManual, { employeeId: asha, kind: "in", tzOffset: 0 });
    expect(r.lateDeduction).toBe(0);
  });
});

describe("waiving a late deduction", () => {
  it("cancels the amount, and is refused once payroll has covered that date", async () => {
    const { t, as, juma } = await setup();
    at("2026-10-26T05:10:00Z");
    await as.mutation(api.attendance.recordManual, { employeeId: juma, kind: "in", tzOffset: 0 });
    const rec = (await t.run((ctx) => ctx.db.query("attendance").collect()))[0];
    await as.mutation(api.schedules.waiveLate, { attendanceId: rec._id });
    await expect(as.mutation(api.schedules.waiveLate, { attendanceId: rec._id })).rejects.toThrow(/haina makato/);
    const today = await as.query(api.attendance.today, { date: "2026-10-26" });
    expect(today.find((e) => e.name === "Juma")!.lateDeduction).toBe(0);
    await t.run((ctx) => ctx.db.patch("attendance", rec._id, { lateWaived: false }));
    at("2026-10-28T06:00:00Z");
    await as.mutation(api.payroll.processPayroll, { name: "Wiki", startDate: "2026-10-26", endDate: "2026-10-26", deductionRatePercent: 0 });
    await expect(as.mutation(api.schedules.waiveLate, { attendanceId: rec._id })).rejects.toThrow(/payroll/);
  });
});

describe("payroll with attendance rules", () => {
  it("deducts late amounts and a full day for each unexcused absence, but not leave, off days or holidays", async () => {
    const { t, as, tenant, asha, daily } = await setup();
    // Week Mon 19 - Sun 25 Oct: 6 working days -> a day is 300000 / 6 = 50000.
    const mgrId = (await t.run((ctx) => ctx.db.query("users").collect())).find((u) => u.username === "mgr")!._id;
    await t.run(async (ctx) => {
      const base = { tenantId: tenant, signInTime: "08:00", status: "present", recordedBy: mgrId };
      await ctx.db.insert("attendance", { ...base, employeeId: asha, date: "2026-10-19", signInTime: "08:10", status: "late", scheduledStart: "08:00", lateMinutes: 10, lateDeduction: 5000 }); // Mon, late
      await ctx.db.insert("attendance", { ...base, employeeId: asha, date: "2026-10-20" }); // Tue ok
      // Wed 21: approved leave (below). Thu 22: absent. Fri 23: holiday. Sat 24: absent. Sun 25: off.
      await ctx.db.insert("leaveRequests", { tenantId: tenant, employeeId: asha, leaveType: "sick", startDate: "2026-10-21", endDate: "2026-10-21", days: 1, status: "approved", createdBy: mgrId });
      await ctx.db.insert("attendance", { ...base, employeeId: daily, date: "2026-10-19" });
    });
    await as.mutation(api.schedules.addClosedDay, { date: "2026-10-23" });
    at("2026-10-28T06:00:00Z");
    const res = await as.mutation(api.payroll.processPayroll, { name: "Wiki 43", startDate: "2026-10-19", endDate: "2026-10-25", deductionRatePercent: 0 });
    expect(res.employees).toBe(3);
    const recs = await as.query(api.payroll.listRecords, {});
    const a = recs.find((r) => r.employeeName === "Asha")!;
    // Closed day removes one working day: 5 working days -> 60000 a day; absent Thu + Sat = 120000.
    expect([a.lateDeductions, a.lateCount, a.absentDays, a.absentDeductions]).toEqual([5000, 1, 2, 120000]);
    expect([a.otherDeductions, a.totalDeductions, a.netPay]).toEqual([125000, 125000, 175000]);
    const d = recs.find((r) => r.employeeName === "Daudi")!;
    expect(d.absentDeductions).toBe(0); // paid by the day: simply not paid for days not worked
    expect(d.grossPay).toBe(20000);
  });

  it("never lets deductions take pay below zero, and ignores today", async () => {
    const { t, as, tenant, juma } = await setup();
    const mgrId = (await t.run((ctx) => ctx.db.query("users").collect())).find((u) => u.username === "mgr")!._id;
    await t.run((ctx) => ctx.db.insert("attendance", { tenantId: tenant, employeeId: juma, date: "2026-10-26", signInTime: "09:00", status: "late", recordedBy: mgrId, lateMinutes: 60, lateDeduction: 999999999 }));
    at("2026-10-26T09:00:00Z"); // Monday in progress: other days absent but today is not
    await as.mutation(api.payroll.processPayroll, { name: "Wiki", startDate: "2026-10-26", endDate: "2026-10-26", deductionRatePercent: 0 });
    const j = (await as.query(api.payroll.listRecords, {})).find((r) => r.employeeName === "Juma")!;
    expect([j.netPay >= 0, j.absentDays]).toEqual([true, 0]);
  });
});

describe("access and alerts", () => {
  it("only managers change rules and timetables", async () => {
    const { asWaiter, asha } = await setup();
    await expect(asWaiter.mutation(api.schedules.saveRules, { lateMode: "fixed", lateAmount: 1, graceMinutes: 0, absentEnabled: true })).rejects.toThrow();
    await expect(asWaiter.mutation(api.schedules.save, { employeeIds: [asha], days: DAYS })).rejects.toThrow();
    await expect(asWaiter.query(api.schedules.getRules, {})).rejects.toThrow();
  });

  it("validates timetables and rules", async () => {
    const { as, asha } = await setup();
    await expect(as.mutation(api.schedules.save, { employeeIds: [asha], days: DAYS.slice(1) })).rejects.toThrow(/siku zote 7/);
    await expect(as.mutation(api.schedules.save, { employeeIds: [asha], days: DAYS.map((d) => ({ ...d, isOff: false, startTime: "25:00", endTime: "17:00" })) })).rejects.toThrow(/muda sahihi/);
    await expect(as.mutation(api.schedules.save, { employeeIds: [asha], days: DAYS.map((d) => ({ ...d, isOff: true })) })).rejects.toThrow(/siku moja/);
    await expect(as.mutation(api.schedules.saveRules, { lateMode: "fixed", lateAmount: -1, graceMinutes: 0, absentEnabled: true })).rejects.toThrow(/Kiasi/);
    await expect(as.mutation(api.schedules.saveRules, { lateMode: "fixed", lateAmount: 10, graceMinutes: 500, absentEnabled: true })).rejects.toThrow(/Dakika/);
  });

  it("tells the manager who is late, not in yet, or was absent", async () => {
    const { t, as, tenant, asha, juma } = await setup();
    const mgrId = (await t.run((ctx) => ctx.db.query("users").collect())).find((u) => u.username === "mgr")!._id;
    await t.run((ctx) => ctx.db.insert("attendance", { tenantId: tenant, employeeId: juma, date: "2026-10-28", signInTime: "08:20", status: "late", recordedBy: mgrId, scheduledStart: "08:00", lateMinutes: 20, lateDeduction: 5000 }));
    at("2026-10-28T06:00:00Z"); // Wednesday 09:00; Tuesday nobody signed in
    const feed = await as.query(api.notifications.feed, { today: "2026-10-28" });
    const codes = feed.items.filter((i) => i.code.startsWith("staff_")).map((i) => `${i.code}:${i.params.name}`).sort();
    expect(codes).toContain("staff_not_in:Asha");
    expect(codes).toContain("staff_late:Juma");
    expect(codes).toContain("staff_absent:Asha"); // Tuesday
    expect(feed.items.find((i) => i.code === "staff_absent" && i.params.name === "Asha")!.params.amount).toBe(11111.11); // alerts estimate a day as the calendar month: 300000 / 27 working days in October 2026
    void asha;
  });
});
