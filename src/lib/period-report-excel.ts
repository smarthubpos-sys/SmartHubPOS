import { safeCell } from "@/lib/safe-cell.ts";

/** One line of the report as the Excel / e-mail rows: [description, amount]. A row whose amount is "" is a section heading. */
export type ReportLine = Record<string, string | number | boolean | null>;

/**
 * Saves a period report as an Excel file (.xlsx): business, report title and period on top, then the lines
 * (summary, money received by method, debts, expenses). Headings are bold; amounts are real numbers (they can be added up in Excel).
 */
export async function downloadPeriodReportExcel(opts: { business: string; title: string; from: string; to: string; lines: ReportLine[]; fileName: string; headings: { description: string; amount: string } }) {
  const ExcelJS = (await import("exceljs")).default; // loaded only when the file is saved, so opening the report page stays light
  const wb = new ExcelJS.Workbook();
  wb.creator = "SmartHubPOS";
  const ws = wb.addWorksheet("Report");
  ws.columns = [{ width: 58 }, { width: 20 }];
  const head = ws.addRow([opts.business]); head.font = { bold: true, size: 14 };
  ws.addRow([opts.title]).font = { bold: true };
  ws.addRow([opts.from === opts.to ? opts.from : `${opts.from} - ${opts.to}`]);
  ws.addRow([]);
  const cols = ws.addRow([opts.headings.description, opts.headings.amount]);
  cols.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cols.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  cols.getCell(2).alignment = { horizontal: "right" };
  for (const line of opts.lines) {
    const [label, amount] = Object.values(line);
    const isHeading = amount === "" || amount === null || amount === undefined;
    const row = ws.addRow([safeCell(label ?? ""), isHeading ? "" : amount]);
    if (isHeading) { row.font = { bold: true }; row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } }; }
    else if (typeof amount === "number") { row.getCell(2).numFmt = "#,##0.00;[Red](#,##0.00)"; row.getCell(2).alignment = { horizontal: "right" }; }
  }
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer).buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `${opts.fileName.replace(/[^\w.-]+/g, "-")}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}
