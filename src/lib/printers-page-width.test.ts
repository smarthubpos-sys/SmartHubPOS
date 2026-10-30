import { describe, expect, it } from "vitest";
import { qzHtmlPageWidthInches, qzPageOptions, receiptHeightMm } from "./printers.ts";

describe("QZ Tray HTML receipt width", () => {
  it("keeps physical page width in millimetres", () => {
    expect(qzPageOptions("80mm").width).toBe(80);
    expect(qzPageOptions("58mm").width).toBe(58);
    expect(qzPageOptions("A4").width).toBe(210);
  });

  it("gives QZ Tray pageWidth in inches (not CSS pixels)", () => {
    expect(qzHtmlPageWidthInches("58mm")).toBe(2.283);
    expect(qzHtmlPageWidthInches("80mm")).toBe(3.15);
    expect(qzHtmlPageWidthInches("A4")).toBe(8.268);
  });

  it("defaults to the 80mm width when the paper is unknown", () => {
    expect(qzHtmlPageWidthInches(undefined)).toBe(3.15);
    expect(qzHtmlPageWidthInches("")).toBe(3.15);
  });

  it("fits the page height to the real receipt length (no endless paper)", () => {
    expect(receiptHeightMm(377)).toBe(100 + 6); // 377px ~ 99.7mm -> 100mm + 6mm tail
    expect(receiptHeightMm(0)).toBe(30);
    expect(receiptHeightMm(Number.NaN)).toBe(30);
  });
});
