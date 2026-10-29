import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { canAccessRecord, logAudit, requireManager, requirePermission, resolveWriteScope, scopedRows } from "./access";
import type { UserLike } from "./access";
import { DEFAULT_RULE, absentDates, businessNow, dayRate, isValidTime, leaveDates, scheduledDays } from "./attendanceMath";
import type { DaySchedule, Rule } from "./attendanceMath";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const asDays = (rows: Doc<"workSchedules">[]): DaySchedule[] => rows.map((r) => ({ weekday: r.weekday, isOff: r.isOff, startTime: r.startTime, endTime: r.endTime }));

/** The business's deduction rules (rules are business-wide). No saved rule = nothing is deducted. */
export async function loadRule(ctx: QueryCtx, tenantId: Id<"tenants"> | undefined): Promise<Rule> {
  if (!tenantId) return DEFAULT_RULE;
  const rows = await ctx.db.query("attendanceRules").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect();
  const row = rows.find((r) => !r.branchId) ?? rows[0];
  return row ? { lateMode: row.lateMode === "per_minute" ? "per_minute" : "fixed", lateAmount: row.lateAmount, graceMinutes: row.graceMinutes, absentEnabled: row.absentEnabled } : DEFAULT_RULE;
}

/** Weekly timetable of one employee (empty = no timetable, so never late or absent). */
export async function loadSchedule(ctx: QueryCtx, employeeId: Id<"employees">): Promise<DaySchedule[]> {
  return asDays(await ctx.db.query("workSchedules").withIndex("by_employee", (q) => q.eq("employeeId", employeeId)).collect());
}

/** Closed days (holidays) of the business. */
export async function loadClosedDays(ctx: QueryCtx, tenantId: Id<"tenants"> | undefined): Promise<Set<string>> {
  if (!tenantId) return new Set();
  return new Set((await ctx.db.query("offDays").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect()).map((d) => d.date));
}

export type Deduction = { lateCount: number; lateTotal: number; absentDays: number; absentAmount: number; absentDates: string[]; scheduledDays: number; dayRate: number };

/**
 * Lateness and absence of each employee in [from, to].
 *  - Lateness: the amounts saved at sign-in (a manager may have waived one).
 *  - Absence: scheduled days before today with no sign-in that were not a weekly off, closed day or approved leave.
 *    A full day's pay is deducted only for monthly salaries; daily and hourly staff are simply not paid for days they did not work.
 */
export async function attendanceDeductions(ctx: QueryCtx, user: UserLike, from: string, to: string, today: string, employees: Doc<"employees">[]): Promise<Map<string, Deduction>> {
  const tenantId = user.tenantId ?? employees[0]?.tenantId;
  const rule = await loadRule(ctx, tenantId);
  const closed = await loadClosedDays(ctx, tenantId);
  const schedules = new Map<string, DaySchedule[]>();
  for (const row of await scopedRows(ctx, user, "workSchedules")) {
    const list = schedules.get(String(row.employeeId)) ?? [];
    list.push({ weekday: row.weekday, isOff: row.isOff, startTime: row.startTime, endTime: row.endTime });
    schedules.set(String(row.employeeId), list);
  }
  const leaves = (await scopedRows(ctx, user, "leaveRequests")).filter((l) => l.status === "approved" && l.endDate >= from && l.startDate <= to);
  const out = new Map<string, Deduction>();
  for (const e of employees) {
    const id = String(e._id);
    const schedule = schedules.get(id) ?? [];
    const rows = await ctx.db.query("attendance").withIndex("by_employee_date", (q) => q.eq("employeeId", e._id).gte("date", from).lte("date", to)).collect();
    const attended = new Set(rows.filter((r) => r.signInTime).map((r) => r.date));
    const lateRows = rows.filter((r) => !r.lateWaived && (r.lateDeduction ?? 0) > 0);
    const days = scheduledDays(schedule, from, to, closed);
    const absent = absentDates({ schedule, from, to, today, startDate: e.startDate, attended, leave: leaveDates(leaves.filter((l) => String(l.employeeId) === id), from, to), closedDays: closed });
    const rate = e.salaryType === "monthly" ? dayRate(e.basicSalary, days) : 0;
    out.set(id, { lateCount: lateRows.length, lateTotal: round2(lateRows.reduce((n, r) => n + (r.lateDeduction ?? 0), 0)), absentDays: absent.length, absentAmount: rule.absentEnabled ? round2(rate * absent.length) : 0, absentDates: absent, scheduledDays: days, dayRate: rate });
  }
  return out;
}

const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/* ───────────── Rules ───────────── */

export const getRules = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "payroll.view", "payroll");
    const rule = await loadRule(ctx, user.tenantId);
    return { ...rule, businessTime: businessNow().time };
  },
});

export const saveRules = mutation({
  args: { lateMode: v.union(v.literal("fixed"), v.literal("per_minute")), lateAmount: v.number(), graceMinutes: v.number(), absentEnabled: v.boolean() },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "payroll");
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    if (!Number.isFinite(a.lateAmount) || a.lateAmount < 0 || a.lateAmount > 1e9) throw new ConvexError("Kiasi cha kukata kwa kuchelewa si sahihi.");
    if (!Number.isInteger(a.graceMinutes) || a.graceMinutes < 0 || a.graceMinutes > 120) throw new ConvexError("Dakika za kuvumilia lazima ziwe 0 hadi 120.");
    const tenantId = scope.tenantId;
    const rows = await ctx.db.query("attendanceRules").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect();
    const existing = rows.find((r) => !r.branchId) ?? rows[0];
    const data = { lateMode: a.lateMode, lateAmount: round2(a.lateAmount), graceMinutes: a.graceMinutes, absentEnabled: a.absentEnabled, updatedBy: user._id, updatedAt: new Date().toISOString() };
    if (existing) await ctx.db.patch("attendanceRules", existing._id, data);
    else await ctx.db.insert("attendanceRules", { tenantId, ...data });
    await logAudit(ctx, user, { action: "save_attendance_rules", module: "payroll", details: `${a.lateMode} ${data.lateAmount} grace=${a.graceMinutes} absent=${a.absentEnabled}` });
    return true;
  },
});

/* ───────────── Timetables ───────────── */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "payroll.view", "payroll");
    const employees = (await scopedRows(ctx, user, "employees")).filter((e) => e.isActive);
    const byEmp = new Map<string, Doc<"workSchedules">[]>();
    for (const row of await scopedRows(ctx, user, "workSchedules")) byEmp.set(String(row.employeeId), [...(byEmp.get(String(row.employeeId)) ?? []), row]);
    return employees.map((e) => ({ employeeId: e._id, code: e.employeeCode, name: e.name, department: e.department, days: asDays(byEmp.get(String(e._id)) ?? []).sort((x, y) => x.weekday - y.weekday) })).sort((x, y) => x.name.localeCompare(y.name));
  },
});

const dayArg = v.object({ weekday: v.number(), isOff: v.boolean(), startTime: v.optional(v.string()), endTime: v.optional(v.string()) });

/** Saves the same weekly timetable for one or many employees (replaces what they had). */
export const save = mutation({
  args: { employeeIds: v.array(v.id("employees")), days: v.array(dayArg) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "payroll");
    if (a.employeeIds.length === 0 || a.employeeIds.length > 200) throw new ConvexError("Chagua mfanyakazi mmoja au zaidi (hadi 200).");
    if (a.days.length !== 7 || new Set(a.days.map((d) => d.weekday)).size !== 7 || a.days.some((d) => !Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6)) throw new ConvexError("Ratiba lazima iwe na siku zote 7 za wiki.");
    for (const d of a.days) {
      if (d.isOff) continue;
      if (!isValidTime(d.startTime) || !isValidTime(d.endTime)) throw new ConvexError("Weka muda sahihi wa kuingia na kutoka (HH:MM) kwa kila siku ya kazi.");
    }
    if (a.days.every((d) => d.isOff)) throw new ConvexError("Angalau siku moja lazima iwe siku ya kazi.");
    let saved = 0;
    for (const id of new Set(a.employeeIds)) {
      const e = await ctx.db.get("employees", id);
      if (!e || !canAccessRecord(user, e)) throw new ConvexError("Mfanyakazi hapatikani.");
      for (const old of await ctx.db.query("workSchedules").withIndex("by_employee", (q) => q.eq("employeeId", id)).collect()) await ctx.db.delete("workSchedules", old._id);
      for (const d of a.days) await ctx.db.insert("workSchedules", { tenantId: e.tenantId, branchId: e.branchId, employeeId: id, weekday: d.weekday, isOff: d.isOff, startTime: d.isOff ? undefined : d.startTime, endTime: d.isOff ? undefined : d.endTime });
      saved++;
    }
    await logAudit(ctx, user, { action: "save_work_schedule", module: "payroll", details: `employees=${saved}` });
    return saved;
  },
});

/** Removes an employee's timetable: from then on the person is never late or absent. */
export const clear = mutation({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "payroll");
    const e = await ctx.db.get("employees", a.employeeId);
    if (!e || !canAccessRecord(user, e)) throw new ConvexError("Mfanyakazi hapatikani.");
    for (const old of await ctx.db.query("workSchedules").withIndex("by_employee", (q) => q.eq("employeeId", a.employeeId)).collect()) await ctx.db.delete("workSchedules", old._id);
    await logAudit(ctx, user, { action: "clear_work_schedule", module: "payroll", referenceId: String(a.employeeId) });
    return true;
  },
});

/* ───────────── Closed days (holidays) ───────────── */

export const listClosedDays = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "payroll.view", "payroll");
    if (!user.tenantId) return [];
    const tenantId = user.tenantId;
    return (await ctx.db.query("offDays").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect()).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 120);
  },
});

export const addClosedDay = mutation({
  args: { date: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "payroll");
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    if (!validDate(a.date)) throw new ConvexError("Tarehe si sahihi.");
    const tenantId = scope.tenantId;
    if ((await ctx.db.query("offDays").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect()).some((d) => d.date === a.date)) throw new ConvexError("Tarehe hii tayari ni siku ya mapumziko.");
    await ctx.db.insert("offDays", { tenantId, date: a.date, reason: a.reason?.trim() || undefined });
    await logAudit(ctx, user, { action: "add_closed_day", module: "payroll", details: a.date });
    return true;
  },
});

export const removeClosedDay = mutation({
  args: { id: v.id("offDays") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "payroll");
    const d = await ctx.db.get("offDays", a.id);
    if (!d || d.tenantId !== user.tenantId) throw new ConvexError("Siku ya mapumziko haipatikani.");
    await ctx.db.delete("offDays", a.id);
    await logAudit(ctx, user, { action: "remove_closed_day", module: "payroll", details: d.date });
    return true;
  },
});

/* ───────────── Waiving a late deduction ───────────── */

export const waiveLate = mutation({
  args: { attendanceId: v.id("attendance") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "payroll");
    const rec = await ctx.db.get("attendance", a.attendanceId);
    if (!rec || !canAccessRecord(user, rec)) throw new ConvexError("Rekodi ya mahudhurio haipatikani.");
    if (!(rec.lateDeduction && rec.lateDeduction > 0) || rec.lateWaived) throw new ConvexError("Rekodi hii haina makato ya kuchelewa.");
    const covered = (await ctx.db.query("payrollPeriods").withIndex("by_scope", (q) => q.eq("tenantId", rec.tenantId).eq("branchId", rec.branchId)).collect()).find((p) => p.status !== "cancelled" && p.startDate <= rec.date && p.endDate >= rec.date);
    if (covered) throw new ConvexError("Tarehe hii tayari imo kwenye payroll ya kipindi; huwezi kufuta kato.");
    await ctx.db.patch("attendance", a.attendanceId, { lateWaived: true });
    await logAudit(ctx, user, { action: "waive_late_deduction", module: "payroll", referenceId: String(a.attendanceId), details: `${rec.date} ${rec.lateDeduction}` });
    return true;
  },
});

/* ───────────── Report: lateness & absence in a period ───────────── */

export const report = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "payroll.reports.view", "payroll");
    if (!validDate(a.from) || !validDate(a.to) || a.to < a.from) throw new ConvexError("Kipindi si sahihi.");
    const employees = (await scopedRows(ctx, user, "employees")).filter((e) => e.isActive);
    const ded = await attendanceDeductions(ctx, user, a.from, a.to, businessNow().date, employees);
    const rows = [];
    for (const e of employees) {
      const d = ded.get(String(e._id));
      if (!d || d.scheduledDays === 0) continue;
      const late = (await ctx.db.query("attendance").withIndex("by_employee_date", (q) => q.eq("employeeId", e._id).gte("date", a.from).lte("date", a.to)).collect()).filter((r) => (r.lateMinutes ?? 0) > 0).map((r) => ({ id: r._id, date: r.date, scheduledStart: r.scheduledStart, signInTime: r.signInTime, lateMinutes: r.lateMinutes ?? 0, deduction: r.lateWaived ? 0 : r.lateDeduction ?? 0, waived: !!r.lateWaived })).sort((x, y) => x.date.localeCompare(y.date));
      rows.push({ employeeId: e._id, code: e.employeeCode, name: e.name, scheduledDays: d.scheduledDays, late, lateTotal: d.lateTotal, absentDates: d.absentDates, absentAmount: d.absentAmount, salaryType: e.salaryType });
    }
    return rows.sort((x, y) => x.name.localeCompare(y.name));
  },
});
