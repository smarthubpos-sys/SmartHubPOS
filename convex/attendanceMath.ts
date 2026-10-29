/**
 * Pure rules for lateness and absence (no database access, so they are easy to test).
 * Times are "HH:MM" in the business time zone. Everything is compared at minute precision.
 */

/** East Africa Time (UTC+3), the same zone the rest of the system uses for "today" (see plans.ts). */
export const BUSINESS_UTC_OFFSET_MINUTES = 180;

export type LateMode = "fixed" | "per_minute";
export type Rule = { lateMode: LateMode; lateAmount: number; graceMinutes: number; absentEnabled: boolean };
export const DEFAULT_RULE: Rule = { lateMode: "fixed", lateAmount: 0, graceMinutes: 0, absentEnabled: true };

export type DaySchedule = { weekday: number; isOff: boolean; startTime?: string; endTime?: string };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const isValidTime = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Current business date, "HH:MM" and minutes since midnight. */
export function businessNow(nowMs: number = Date.now()) {
  const iso = new Date(nowMs + BUSINESS_UTC_OFFSET_MINUTES * 60000).toISOString();
  const time = iso.slice(11, 16);
  return { date: iso.slice(0, 10), time, minutes: toMinutes(time) };
}

export function addDaysIso(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** What was due on a date: undefined when the person has no timetable, "off" on a weekly day off or closed day. */
export function dueOn(schedule: DaySchedule[], date: string, closedDays: ReadonlySet<string> = new Set()): { startTime: string; endTime?: string } | "off" | undefined {
  if (schedule.length === 0) return undefined;
  if (closedDays.has(date)) return "off";
  const day = schedule.find((d) => d.weekday === weekdayOf(date));
  if (!day || day.isOff || !isValidTime(day.startTime)) return "off";
  return { startTime: day.startTime, endTime: day.endTime };
}

/** Lateness of a sign-in. Within the grace period nothing is deducted; beyond it the whole delay counts. */
export function lateness(startTime: string | undefined, signInMinutes: number, rule: Rule): { lateMinutes: number; deduction: number } {
  if (!isValidTime(startTime)) return { lateMinutes: 0, deduction: 0 };
  const delay = signInMinutes - toMinutes(startTime);
  if (delay <= Math.max(0, rule.graceMinutes)) return { lateMinutes: 0, deduction: 0 };
  const amount = Math.max(0, rule.lateAmount);
  return { lateMinutes: delay, deduction: round2(rule.lateMode === "per_minute" ? amount * delay : amount) };
}

/** Number of days in [from, to] on which the person is due to work. */
export function scheduledDays(schedule: DaySchedule[], from: string, to: string, closedDays: ReadonlySet<string> = new Set()) {
  let n = 0;
  for (let d = from; d <= to; d = addDaysIso(d, 1)) { const due = dueOn(schedule, d, closedDays); if (due && due !== "off") n++; }
  return n;
}

/**
 * Scheduled days with no sign-in that were not an off day or approved leave.
 * Only days BEFORE `today` can be absent (today is still in progress); days before the start date are ignored.
 */
export function absentDates(args: { schedule: DaySchedule[]; from: string; to: string; today: string; startDate?: string; attended: ReadonlySet<string>; leave: ReadonlySet<string>; closedDays?: ReadonlySet<string> }): string[] {
  const first = args.startDate && args.startDate > args.from ? args.startDate : args.from;
  const lastDay = addDaysIso(args.today, -1);
  const last = args.to < lastDay ? args.to : lastDay;
  const out: string[] = [];
  for (let d = first; d <= last; d = addDaysIso(d, 1)) {
    const due = dueOn(args.schedule, d, args.closedDays ?? new Set());
    if (!due || due === "off") continue;
    if (args.attended.has(d) || args.leave.has(d)) continue;
    out.push(d);
  }
  return out;
}

/** A full day's pay for a monthly salary: the salary of the period spread over its scheduled working days. */
export const dayRate = (basicSalary: number, scheduledDayCount: number) => (scheduledDayCount > 0 ? round2(basicSalary / scheduledDayCount) : 0);

/** Dates covered by approved leave of any kind inside [from, to]. */
export function leaveDates(leaves: ReadonlyArray<{ startDate: string; endDate: string }>, from: string, to: string) {
  const out = new Set<string>();
  for (const l of leaves) for (let d = l.startDate > from ? l.startDate : from; d <= l.endDate && d <= to; d = addDaysIso(d, 1)) out.add(d);
  return out;
}

/** First and last day of the month that contains `date`. */
export function monthBounds(date: string) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return { start: `${date.slice(0, 8)}01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}
