import { describe, expect, it } from "vitest";
import { paperFromSetting, resolvePaper } from "./print-policy.ts";
import { receiptCss, receiptScale } from "./receipt-layout.ts";

describe("one print layout for every business", () => {
  it("a business with no saved setting prints on 80mm with the normal text size", () => {
    expect(paperFromSetting(undefined)).toBe("80mm");
    expect(resolvePaper(undefined, { getItem: () => null })).toBe("80mm");
    expect(receiptScale("80mm").base).toBeGreaterThanOrEqual(15);
  });
  it("Hardware Setup saves a4 in lower case; it still means A4", () => {
    expect(paperFromSetting("a4")).toBe("A4");
    expect(receiptCss("A4")).toContain("190mm");
    expect(receiptCss(paperFromSetting("a4"))).toContain("size:190mm");
  });
});
