import { describe, expect, it } from "vitest";
import { qzHtmlPageWidthInches, qzHtmlPrintSettings, qzPageOptions, receiptHeightMm } from "./printers.ts";

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


describe("QZ Tray HTML print settings", () => {
  it("sends exact 80mm width and content-derived 118mm height to both render layers", () => {
    const settings = qzHtmlPrintSettings("80mm", 423);
    expect(settings.widthMm).toBe(80);
    expect(settings.heightMm).toBe(118);
    expect(settings.config.units).toBe("in");
    expect(settings.config.size).toEqual({ width: 3.15, height: 4.646 });
    expect(settings.pixelOptions).toEqual({ pageWidth: 3.15, pageHeight: 4.646 });
  });

  it("does not force rotation or scale content", () => {
    const settings = qzHtmlPrintSettings("80mm", 423);
    expect(settings.config.orientation).toBeNull();
    expect(settings.config.margins).toBe(0);
    expect(settings.config.scaleContent).toBe(false);
    expect(settings.config).not.toHaveProperty("rasterize");
  });

  it("keeps fixed A4 dimensions", () => {
    const settings = qzHtmlPrintSettings("A4", 423);
    expect(settings.widthMm).toBe(210);
    expect(settings.heightMm).toBe(297);
    expect(settings.config.size).toEqual({ width: 8.268, height: 11.693 });
    expect(settings.pixelOptions).toEqual({ pageWidth: 8.268, pageHeight: 11.693 });
  });
});
