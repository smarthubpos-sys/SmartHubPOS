import { describe, expect, it } from "vitest";
import { fitSize, isLogoFile } from "./logo-image.ts";

describe("logo file recognition", () => {
  it("accepts the logo file by type or by name when the browser gives no type", () => {
    expect(isLogoFile({ name: "RUDY_S_FARM_LOGO_JPG.jpeg", type: "image/jpeg" })).toBe(true);
    expect(isLogoFile({ name: "RUDY_S_FARM_LOGO_JPG.jpeg", type: "" })).toBe(true);
    expect(isLogoFile({ name: "logo.JFIF", type: "application/octet-stream" })).toBe(true);
    expect(isLogoFile({ name: "logo.png", type: "image/png" })).toBe(true);
  });
  it("refuses files that are not pictures", () => {
    expect(isLogoFile({ name: "SmartHubPOS.zip", type: "application/zip" })).toBe(false);
    expect(isLogoFile({ name: "notes.txt", type: "" })).toBe(false);
  });
  it("shrinks a 2576 px logo to 480 px and never enlarges a small one", () => {
    expect(fitSize(2576, 2576)).toEqual({ width: 480, height: 480 });
    expect(fitSize(1200, 600)).toEqual({ width: 480, height: 240 });
    expect(fitSize(200, 100)).toEqual({ width: 200, height: 100 });
  });
});
