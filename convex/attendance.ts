import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { canAccessRecord, filterScoped, logAudit, requireActiveUser, requireManager, scopedRows, requirePermission } from "./access";
import { businessNow, dueOn, lateness, toMinutes } from "./attendanceMath";
import { loadClosedDays, loadRule, loadSchedule } from "./schedules";

/** Local date/time of the person signing, from the browser's timezone offset (minutes, as Date.getTimezoneOffset). */
export function localNow(tzOffsetMinutes: number) {
  const offset = Number.isFinite(tzOffsetMinutes) ? Math.max(-840, Math.min(840, tzOffsetMinutes)) : 0;
  const d = new Date(Date.now() - offset * 60000);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Records a sign-in or sign-out for an employee. Shared by manual and biometric flows. */
export async function applyAttendance(ctx: MutationCtx, input: { employee: Doc<"employees">; kind: "in" | "out"; userId: Id<"users">; method: string; tzOffset: number }) {
  const { employee, kind, userId, method } = input;
  // Timetables and lateness money are judged on the business clock (server time), never on the device's own clock/time zone.
  const now = businessNow();
  if (!employee.isActive) throw new ConvexError("Mfanyakazi huyu hafanyi kazi tena.");
  const rec = await ctx.db.query("attendance").withIndex("by_employee_date", (q) => q.eq("employeeId", employee._id).eq("date", now.date)).first();
  if (kind === "in") {
    if (rec?.signInTime) throw new ConvexError("Tayari ameshaingia kazini leo.");
    // What was he due to do today? No timetable, a weekly off day or a closed day means he can never be late.
    const due = dueOn(await loadSchedule(ctx, employee._id), now.date, await loadClosedDays(ctx, employee.tenantId));
    const late = due && due !== "off" ? lateness(due.startTime, now.minutes, await loadRule(ctx, employee.tenantId)) : { lateMinutes: 0, deduction: 0 };
    await ctx.db.insert("attendance", {
      tenantId: employee.tenantId, branchId: employee.branchId, employeeId: employee._id, date: now.date, signInTime: now.time,
      status: late.lateMinutes > 0 ? "late" : "present", notes: method, recordedBy: userId,
      scheduledStart: due && due !== "off" ? due.startTime : undefined, lateMinutes: late.lateMinutes, lateDeduction: late.deduction,
    });
    return { date: now.date, time: now.time, scheduledStart: due && due !== "off" ? due.startTime : undefined, lateMinutes: late.lateMinutes, lateDeduction: late.deduction };
  }
  if (!rec?.signInTime) throw new ConvexError("Hajaingia kazini leo; ingia kwanza.");
  if (rec.signOutTime) throw new ConvexError("Tayari ameshatoka kazini leo.");
  const hours = Math.max(0, Math.round(((now.minutes - toMinutes(rec.signInTime)) / 60) * 100) / 100);
  await ctx.db.patch("attendance", rec._id, { signOutTime: now.time, hoursWorked: hours, notes: `${rec.notes ?? ""}${rec.notes ? " / " : ""}${method}` });
  return { date: now.date, time: now.time, hoursWorked: hours };
}

export const today = query({
  args: { date: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "payroll.view", "payroll");
    const employees = (await scopedRows(ctx, user, "employees")).filter((e) => e.isActive);
    const records = filterScoped(user, await ctx.db.query("attendance").withIndex("by_date", (q) => q.eq("date", a.date)).collect());
    const byEmp = new Map(records.map((r) => [String(r.employeeId), r]));
    const closed = await loadClosedDays(ctx, user.tenantId);
    const schedules = new Map<string, { weekday: number; isOff: boolean; startTime?: string; endTime?: string }[]>();
    for (const row of await scopedRows(ctx, user, "workSchedules")) schedules.set(String(row.employeeId), [...(schedules.get(String(row.employeeId)) ?? []), { weekday: row.weekday, isOff: row.isOff, startTime: row.startTime, endTime: row.endTime }]);
    return employees.map((e) => {
      const r = byEmp.get(String(e._id));
      const due = dueOn(schedules.get(String(e._id)) ?? [], a.date, closed);
      return { employeeId: e._id, code: e.employeeCode, name: e.name, position: e.position, signInTime: r?.signInTime, signOutTime: r?.signOutTime, hoursWorked: r?.hoursWorked, status: r?.status ?? "absent", scheduledStart: due && due !== "off" ? due.startTime : undefined, scheduledEnd: due && due !== "off" ? due.endTime : undefined, dayOff: due === "off", attendanceId: r?._id, lateMinutes: r?.lateMinutes ?? 0, lateDeduction: r?.lateWaived ? 0 : r?.lateDeduction ?? 0, lateWaived: !!r?.lateWaived };
    }).sort((x, y) => x.name.localeCompare(y.name));
  },
});

export const range = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "payroll.view", "payroll");
    const records = filterScoped(user, await ctx.db.query("attendance").withIndex("by_date", (q) => q.gte("date", a.from).lte("date", a.to)).collect());
    const names = new Map((await scopedRows(ctx, user, "employees")).map((e) => [String(e._id), e]));
    return records.map((r) => ({ ...r, employeeName: names.get(String(r.employeeId))?.name ?? "-", employeeCode: names.get(String(r.employeeId))?.employeeCode ?? "" })).sort((x, y) => y.date.localeCompare(x.date) || x.employeeName.localeCompare(y.employeeName));
  },
});

export const recordManual = mutation({
  args: { employeeId: v.id("employees"), kind: v.union(v.literal("in"), v.literal("out")), tzOffset: v.number() },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "payroll");
    const employee = await ctx.db.get("employees", a.employeeId);
    if (!employee || !canAccessRecord(user, employee)) throw new ConvexError("Mfanyakazi hapatikani.");
    const result = await applyAttendance(ctx, { employee, kind: a.kind, userId: user._id, method: "manual", tzOffset: a.tzOffset });
    await logAudit(ctx, user, { action: a.kind === "in" ? "staff_sign_in" : "staff_sign_out", module: "payroll", referenceId: String(employee._id), details: `manual ${result.time}` });
    return { ...result, employeeName: employee.name };
  },
});
