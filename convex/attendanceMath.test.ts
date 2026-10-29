import { describe, expect, it } from "vitest";
import { absentDates, businessNow, dayRate, dueOn, lateness, leaveDates, monthBounds, scheduledDays, weekdayOf } from "./attendanceMath";
import type { DaySchedule, Rule } from "./attendanceMath";

const fixed = (amount: number, grace = 0): Rule => ({ lateMode: "fixed", lateAmount: amount, graceMinutes: grace, absentEnabled: true });
/** Monday to Saturday 08:00-17:00, Sunday off. */
const week: DaySchedule[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, isOff: weekday === 0, startTime: weekday === 0 ? undefined : "08:00", endTime: weekday === 0 ? undefined : "17:00" }));

describe("lateness", () => {
  it("is not late at exactly the start time, and late from one minute after", () => {
    expect(lateness("08:00", 8 * 60, fixed(5000))).toEqual({ lateMinutes: 0, deduction: 0 });
    expect(lateness("08:00", 8 * 60 + 1, fixed(5000))).toEqual({ lateMinutes: 1, deduction: 5000 });
    expect(lateness("08:00", 7 * 60 + 30, fixed(5000))).toEqual({ lateMinutes: 0, deduction: 0 }); // early
  });
  it("charges one fixed amount, however late", () => {
    expect(lateness("08:00", 8 * 60 + 45, fixed(5000)).deduction).toBe(5000);
  });
  it("can charge per minute", () => {
    expect(lateness("08:00", 8 * 60 + 12, { ...fixed(300), lateMode: "per_minute" })).toEqual({ lateMinutes: 12, deduction: 3600 });
  });
  it("forgives lateness inside the grace period, but counts the whole delay beyond it", () => {
    expect(lateness("08:00", 8 * 60 + 5, fixed(5000, 5)).deduction).toBe(0);
    expect(lateness("08:00", 8 * 60 + 6, fixed(5000, 5))).toEqual({ lateMinutes: 6, deduction: 5000 });
  });
  it("never deducts when there is no valid start time", () => {
    expect(lateness(undefined, 900, fixed(5000)).deduction).toBe(0);
    expect(lateness("8am", 900, fixed(5000)).deduction).toBe(0);
  });
});

describe("timetable", () => {
  it("knows the weekday of a date and what is due", () => {
    expect(weekdayOf("2026-10-26")).toBe(1); // Monday
    expect(dueOn(week, "2026-10-26")).toEqual({ startTime: "08:00", endTime: "17:00" });
    expect(dueOn(week, "2026-10-25")).toBe("off"); // Sunday
    expect(dueOn(week, "2026-10-26", new Set(["2026-10-26"]))).toBe("off"); // closed day
    expect(dueOn([], "2026-10-26")).toBeUndefined(); // no timetable
  });
  it("counts scheduled working days of a period", () => {
    expect(scheduledDays(week, "2026-10-19", "2026-10-25")).toBe(6);
    expect(scheduledDays(week, "2026-10-19", "2026-10-25", new Set(["2026-10-21"]))).toBe(5);
  });
  it("spreads a monthly salary over the working days", () => {
    expect(dayRate(300000, 6)).toBe(50000);
    expect(dayRate(300000, 0)).toBe(0);
  });
  it("finds the business date and time (UTC+3)", () => {
    expect(businessNow(Date.parse("2026-10-26T05:10:00Z"))).toEqual({ date: "2026-10-26", time: "08:10", minutes: 490 });
    expect(businessNow(Date.parse("2026-10-26T22:00:00Z")).date).toBe("2026-10-27");
    expect(monthBounds("2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});

describe("absence", () => {
  const base = { schedule: week, from: "2026-10-19", to: "2026-10-25", today: "2026-10-27", leave: new Set<string>() };
  it("lists scheduled days with no sign-in, skipping the weekly off day", () => {
    expect(absentDates({ ...base, attended: new Set(["2026-10-19", "2026-10-21"]) })).toEqual(["2026-10-20", "2026-10-22", "2026-10-23", "2026-10-24"]);
  });
  it("does not count approved leave or closed days", () => {
    expect(absentDates({ ...base, attended: new Set(["2026-10-19", "2026-10-21"]), leave: new Set(["2026-10-20"]), closedDays: new Set(["2026-10-22"]) })).toEqual(["2026-10-23", "2026-10-24"]);
  });
  it("never counts today (still in progress) or the future", () => {
    expect(absentDates({ ...base, today: "2026-10-21", attended: new Set(["2026-10-19"]) })).toEqual(["2026-10-20"]);
  });
  it("ignores days before the employee started", () => {
    expect(absentDates({ ...base, startDate: "2026-10-23", attended: new Set() })).toEqual(["2026-10-23", "2026-10-24"]);
  });
  it("counts nothing without a timetable", () => {
    expect(absentDates({ ...base, schedule: [], attended: new Set() })).toEqual([]);
  });
  it("expands leave ranges inside the period", () => {
    expect([...leaveDates([{ startDate: "2026-10-18", endDate: "2026-10-20" }], "2026-10-19", "2026-10-25")]).toEqual(["2026-10-19", "2026-10-20"]);
  });
});
