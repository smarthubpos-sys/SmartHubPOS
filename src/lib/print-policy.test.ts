import { describe, expect, it } from "vitest";
import { paperFromSetting, shouldSchedulePrint, tokenAfterSave, tokenForManualPrint } from "./print-policy";

describe("auto-print policy", () => {
  it("auto-print on: each saved sale gets a new token; off: token is 0 so nothing prints", () => {
    expect(tokenAfterSave(0, true)).toBe(1);
    expect(tokenAfterSave(1, true)).toBe(2);
    expect(tokenAfterSave(5, false)).toBe(0);
  });
  it("manual reprint always asks for one new print", () => {
    expect(tokenForManualPrint(0)).toBe(1);
    expect(tokenForManualPrint(3)).toBe(4);
  });
  it("prints only when data is loaded, allowed, token > 0 and not already printed (no repeat on rerender)", () => {
    const base = { dataReady: true, allowed: true, token: 1, lastPrinted: 0 };
    expect(shouldSchedulePrint(base)).toBe(true);
    expect(shouldSchedulePrint({ ...base, lastPrinted: 1 })).toBe(false); // same token again (rerender)
    expect(shouldSchedulePrint({ ...base, token: 0 })).toBe(false);
    expect(shouldSchedulePrint({ ...base, dataReady: false })).toBe(false);
    expect(shouldSchedulePrint({ ...base, allowed: false })).toBe(false); // no sales.print permission
  });
  it("maps hardware paper settings, defaulting to 80mm", () => {
    expect(paperFromSetting("58mm")).toBe("58mm");
    expect(paperFromSetting("80mm")).toBe("80mm");
    expect(paperFromSetting("a4")).toBe("A4");
    expect(paperFromSetting(undefined)).toBe("80mm");
    expect(paperFromSetting("weird")).toBe("80mm");
  });
});
