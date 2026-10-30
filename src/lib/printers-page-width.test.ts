import { describe, expect, it } from "vitest";
import { qzHtmlPageWidthPixels, qzPageOptions } from "./printers.ts";

describe("QZ Tray HTML receipt width", () => {
  it("keeps physical page width in millimetres", () => {
    expect(qzPageOptions("80mm").width).toBe(80);
    expect(qzPageOptions("58mm").width).toBe(58);
    expect(qzPageOptions("A4").width).toBe(210);
  });

  it("converts physical millimetres to CSS pixels for HTML rasterization", () => {
    expect(qzHtmlPageWidthPixels("80mm")).toBe(302);
    expect(qzHtmlPageWidthPixels("58mm")).toBe(219);
    expect(qzHtmlPageWidthPixels("A4")).toBe(794);
  });
});
