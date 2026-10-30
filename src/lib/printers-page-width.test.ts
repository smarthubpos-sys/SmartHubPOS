import { describe, expect, it } from "vitest";
import { qzHtmlPageWidthInches, qzPageOptions } from "./printers.ts";

describe("QZ Tray HTML receipt width", () => {
  it("keeps physical page width in millimetres", () => {
    expect(qzPageOptions("80mm").width).toBe(80);
    expect(qzPageOptions("58mm").width).toBe(58);
    expect(qzPageOptions("A4").width).toBe(210);
  });

  it("converts physical millimetres to inches for QZ Tray", () => {
    expect(qzHtmlPageWidthInches("80mm")).toBe(3.15);
    expect(qzHtmlPageWidthInches("58mm")).toBe(2.283);
    expect(qzHtmlPageWidthInches("A4")).toBe(8.268);
  });
});
