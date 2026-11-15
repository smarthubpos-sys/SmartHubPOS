import { describe, expect, it } from "vitest";
import { safeCell } from "./safe-cell.ts";

describe("safeCell: exported text can never run as a spreadsheet formula", () => {
  it("prefixes text that starts like a formula", () => {
    expect(safeCell("=HYPERLINK(\"http://evil\",\"x\")")).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
    expect(safeCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(safeCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(safeCell("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(safeCell("\t=1+1")).toBe("'\t=1+1");
  });
  it("leaves normal names, numbers and numeric text alone", () => {
    expect(safeCell("Mama Neema")).toBe("Mama Neema");
    expect(safeCell(1500)).toBe(1500);
    expect(safeCell(-1500)).toBe(-1500);
    expect(safeCell("-1,500.50")).toBe("-1,500.50");
    expect(safeCell("+255 712 345 678")).toBe("+255 712 345 678");
    expect(safeCell("")).toBe("");
    expect(safeCell(null)).toBe(null);
  });
});
