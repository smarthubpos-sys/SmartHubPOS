import { describe, expect, it } from "vitest";
import { createScanBuffer, scannerSuffix } from "./scanner.ts";

const feed = (b: ReturnType<typeof createScanBuffer>, text: string, gap: number, start = 0, editable = false) => {
  let t = start; let out: string | null = null;
  for (const ch of text) { out = b.push(ch, t, editable) ?? out; t += gap; }
  return { out, t };
};

describe("barcode scanner buffer", () => {
  it("a fast burst followed by Enter is a scan, even with no box focused", () => {
    const b = createScanBuffer();
    const { out, t } = feed(b, "6001234567890", 10);
    expect(out).toBeNull();
    expect(b.push("Enter", t, false)).toBe("6001234567890");
  });
  it("slow typing is not a scan", () => {
    const b = createScanBuffer();
    const { t } = feed(b, "ab12", 400);
    expect(b.push("Enter", t, false)).toBeNull(); // the slow gaps keep resetting it, so what is left is too short
  });
  it("typing inside an input box is ignored", () => {
    const b = createScanBuffer();
    const { t } = feed(b, "600123", 5, 0, true);
    expect(b.push("Enter", t, true)).toBeNull();
  });
  it("Tab suffix works when the scanner is set to Tab", () => {
    const b = createScanBuffer(scannerSuffix("Tab"));
    const { t } = feed(b, "12345", 5);
    expect(b.push("Tab", t, false)).toBe("12345");
  });
  it("too short is not a scan", () => {
    const b = createScanBuffer();
    const { t } = feed(b, "12", 5);
    expect(b.push("Enter", t, false)).toBeNull();
  });
});
