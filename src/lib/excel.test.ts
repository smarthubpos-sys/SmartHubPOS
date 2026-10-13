// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseProductFile } from "./excel.ts";

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
