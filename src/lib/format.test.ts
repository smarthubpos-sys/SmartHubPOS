import { describe, expect, it } from "vitest";
import { localDate } from "./format";

describe("localDate (business date in East Africa Time)", () => {
  it("rolls to the next day at 21:00 UTC (00:00 EAT)", () => {
    expect(localDate(0, Date.UTC(2026, 9, 24, 20, 59, 59))).toBe("2026-10-24");
    expect(localDate(0, Date.UTC(2026, 9, 24, 21, 0, 0))).toBe("2026-10-25");
  });
  it("supports day offsets", () => {
    expect(localDate(-1, Date.UTC(2026, 9, 24, 12, 0, 0))).toBe("2026-10-23");
  });
});
