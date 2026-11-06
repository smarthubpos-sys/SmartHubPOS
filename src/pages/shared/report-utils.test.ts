import { afterEach, describe, expect, it, vi } from "vitest";
import { daysAgo, monthStart, today } from "./report-utils.ts";

afterEach(() => vi.useRealTimers());

describe("report dates follow the East Africa business day (UTC+3), not UTC", () => {
  it("01:30 in Dar es Salaam is already the new day, although UTC is still the old one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T22:30:00Z")); // = 2026-11-06 01:30 EAT
    expect(today()).toBe("2026-11-06");
    expect(daysAgo(1)).toBe("2026-11-05");
    expect(monthStart()).toBe("2026-11-01");
  });

  it("23:30 EAT is still the same day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T20:30:00Z")); // = 2026-11-06 23:30 EAT
    expect(today()).toBe("2026-11-06");
  });
});
