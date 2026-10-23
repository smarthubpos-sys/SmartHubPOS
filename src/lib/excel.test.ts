// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { checkProductFile, markFileDuplicates, parseProductFile } from "./excel.ts";

async function fileFrom(build: (wb: ExcelJS.Workbook) => void) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buf = await wb.xlsx.writeBuffer();
  return { name: "x.xlsx", arrayBuffer: async () => buf } as unknown as File;
}

describe("product Excel parsing", () => {
  it("reads Kiswahili headers, text numbers, formulas and skips empty rows", async () => {
    const file = await fileFrom((wb) => {
      const ws = wb.addWorksheet("Bidhaa");
      ws.addRow(["Jina la bidhaa *", "Msimbo wa bidhaa", "Barcode", "Kundi", "Kipimo", "Bei ya kuuzia *", "Bei ya manunuzi", "Idadi", "Kiwango cha kuagiza upya"]);
      ws.addRow(["Sukari 1kg", "", "6001", "Chakula", "Kg", 3000, "2,400", 50, 10]);
      ws.addRow([]);
      ws.addRow(["Mafuta", null, null, null, null, { formula: "2500+2500", result: 5000 }, 4000, 20]);
      ws.addRow(["Chumvi", "", "", "", "", "abc"]);
      ws.addRow(["", "", "", "", "", 100]);
    });
    const { rows } = await parseProductFile(file);
    expect(rows).toHaveLength(4);
    expect(rows[0].row).toMatchObject({ name: "Sukari 1kg", barcode: "6001", group: "Chakula", unit: "Kg", sellingPrice: 3000, buyingPrice: 2400, quantity: 50, reorderLevel: 10 });
    expect(rows[0].line).toBe(2);
    expect(rows[1].row).toMatchObject({ name: "Mafuta", sellingPrice: 5000, buyingPrice: 4000, quantity: 20 });
    expect(rows[2].error).toBeTruthy(); // "abc" is not a number
    expect(rows[3].error).toBeTruthy(); // missing name
  });

  it("accepts English headers and reports a missing header row", async () => {
    const ok = await parseProductFile(await fileFrom((wb) => { const ws = wb.addWorksheet("Products"); ws.addRow(["Item Name", "Selling Price", "Cost", "Qty"]); ws.addRow(["Rice", 2000, 1500, 8]); }));
    expect(ok.rows[0].row).toMatchObject({ name: "Rice", sellingPrice: 2000, buyingPrice: 1500, quantity: 8 });
    const bad = await parseProductFile(await fileFrom((wb) => { wb.addWorksheet("x").addRow(["foo", "bar"]); }));
    expect(bad.rows).toHaveLength(0);
    expect(bad.missing.length).toBeGreaterThan(0);
  });
});

const HEAD = ["Jina la bidhaa *", "Msimbo wa bidhaa", "Barcode", "Kundi", "Kipimo", "Bei ya kuuzia *", "Bei ya manunuzi", "Idadi", "Kiwango cha kuagiza upya"];

describe("product Excel validation (regression)", () => {
  it("rejects unsupported file types and empty files before reading them", () => {
    expect(checkProductFile({ name: "bidhaa.xlsx", size: 1000 })).toBeNull();
    expect(checkProductFile({ name: "BIDHAA.XLSX", size: 1000 })).toBeNull();
    expect(checkProductFile({ name: "old.xls", size: 1000 })).toMatch(/\.xls/);
    expect(checkProductFile({ name: "data.csv", size: 10 })).toMatch(/\.xlsx/);
    expect(checkProductFile({ name: "notes.txt" })).toMatch(/\.xlsx/);
    expect(checkProductFile({ name: "x.xlsx", size: 0 })).toMatch(/tupu/);
    expect(checkProductFile({ name: "x.xlsx", size: 50 * 1024 * 1024 })).toMatch(/kubwa/);
  });

  it("names only the required headers that are really missing", async () => {
    const noPrice = await parseProductFile(await fileFrom((wb) => { const ws = wb.addWorksheet("a"); ws.addRow(["Jina la bidhaa", "Idadi"]); ws.addRow(["x", 1]); }));
    expect(noPrice.rows).toHaveLength(0);
    expect(noPrice.missing).toEqual(["Bei ya kuuzia"]);
    const noName = await parseProductFile(await fileFrom((wb) => { const ws = wb.addWorksheet("a"); ws.addRow(["Bei ya kuuzia", "Idadi"]); ws.addRow([5, 1]); }));
    expect(noName.missing).toEqual(["Jina la bidhaa"]);
    const neither = await parseProductFile(await fileFrom((wb) => { wb.addWorksheet("a").addRow(["foo", "bar"]); }));
    expect(neither.missing).toEqual(["Jina la bidhaa", "Bei ya kuuzia"]);
  });

  it("flags a blank selling price, negative numbers and date cells; whitespace-only rows are ignored", async () => {
    const { rows } = await parseProductFile(await fileFrom((wb) => {
      const ws = wb.addWorksheet("a");
      ws.addRow(HEAD);
      ws.addRow(["Hakuna bei"]);                                  // line 2: blank price
      ws.addRow(["Hasi", null, null, null, null, -5]);            // line 3: negative
      ws.addRow(["Tarehe", null, null, null, null, new Date("2026-01-02")]); // line 4: date in a number column
      ws.addRow(["   ", null, null, null, null, "  "]);          // line 5: whitespace only
      ws.addRow(["Sawa", null, null, null, null, 100, 80, 3]);    // line 6: valid
    }));
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4, 6]);
    expect(rows.map((r) => Boolean(r.error))).toEqual([true, true, true, false]);
    expect(rows[0].error).toMatch(/Bei ya kuuzia/);
    expect(rows[1].error).toMatch(/hasi/i);
    expect(rows[3].row).toMatchObject({ name: "Sawa", sellingPrice: 100, buyingPrice: 80, quantity: 3 });
  });

  it("keeps numeric codes and barcodes as text and finds a header row that is not the first row", async () => {
    const { rows } = await parseProductFile(await fileFrom((wb) => {
      const ws = wb.addWorksheet("a");
      ws.addRow(["Orodha ya bidhaa"]); ws.addRow([]); ws.addRow(HEAD);
      ws.addRow(["Z", 1001, 6001234567890, null, null, 5]);
    }));
    expect(rows[0]).toMatchObject({ line: 4, row: { itemCode: "1001", barcode: "6001234567890", sellingPrice: 5 } });
  });

  it("marks repeats across the whole file (name, code or barcode) and keeps the first one", () => {
    const mk = (line: number, name: string, itemCode?: string, barcode?: string) => ({ line, row: { name, itemCode, barcode, sellingPrice: 1 } });
    const out = markFileDuplicates([mk(2, "Sukari"), mk(3, " sukari "), mk(4, "Chai", "C1"), mk(5, "Chai ya rangi", "c1"), mk(6, "Maji", undefined, "111"), mk(7, "Soda", undefined, "111"), mk(8, "Kipekee")]);
    expect(out.map((r) => Boolean(r.error))).toEqual([false, true, false, true, false, true, false]);
    expect(out[1].error).toMatch(/2/); // points at the first occurrence
    const withError = markFileDuplicates([{ line: 2, row: { name: "A" }, error: "x" }, { line: 3, row: { name: "A", sellingPrice: 1 } }]);
    expect(withError[1].error).toBeUndefined(); // an invalid row does not "claim" the name
  });
});
