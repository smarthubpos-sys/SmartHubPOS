import { tr } from "./i18n.ts";

/** Columns of the product import template (the order is the order in the Excel file). */
type Col = { key: string; required?: boolean; width: number; label: () => string; aliases: readonly string[] };
export const PRODUCT_COLUMNS: readonly (Col & { key: Key })[] = [
  { key: "name", required: true, width: 32, label: () => tr("Jina la bidhaa"), aliases: ["jina la bidhaa", "jina", "item name", "product name", "name", "product", "item"] },
  { key: "itemCode", width: 16, label: () => tr("Msimbo wa bidhaa"), aliases: ["msimbo wa bidhaa", "msimbo", "item code", "code", "sku"] },
  { key: "barcode", width: 18, label: () => tr("Barcode"), aliases: ["barcode", "bar code"] },
  { key: "group", width: 18, label: () => tr("Kundi"), aliases: ["kundi", "group", "category", "kategoria"] },
  { key: "unit", width: 14, label: () => tr("Kipimo"), aliases: ["kipimo", "unit", "uom"] },
  { key: "sellingPrice", required: true, width: 18, label: () => tr("Bei ya kuuzia"), aliases: ["bei ya kuuzia", "selling price", "sale price", "price", "bei"] },
  { key: "buyingPrice", width: 18, label: () => tr("Bei ya manunuzi"), aliases: ["bei ya manunuzi", "buying price", "purchase price", "cost", "cost price"] },
  { key: "quantity", width: 12, label: () => tr("Idadi"), aliases: ["idadi", "quantity", "qty", "stock", "opening quantity"] },
  { key: "reorderLevel", width: 20, label: () => tr("Kiwango cha kuagiza upya"), aliases: ["kiwango cha kuagiza upya", "reorder level", "reorder"] },
];

type Key = "name" | "itemCode" | "barcode" | "group" | "unit" | "sellingPrice" | "buyingPrice" | "quantity" | "reorderLevel";
export type ImportRow = { name: string; itemCode?: string; barcode?: string; group?: string; unit?: string; sellingPrice?: number; buyingPrice?: number; quantity?: number; reorderLevel?: number };
export type ParsedRow = { line: number; row: ImportRow; error?: string };

const norm = (s: unknown) => String(s ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

function cellValue(v: unknown): unknown {
  if (v && typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: unknown };
    if ("result" in o) return o.result;
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if ("text" in o) return o.text;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return v;
}
function toNumber(v: unknown): number | undefined | "bad" {
  const raw = cellValue(v);
  if (raw === null || raw === undefined || String(raw).trim() === "") return undefined;
  if (typeof raw === "number") return raw;
  const n = Number(String(raw).replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : "bad";
}
const toText = (v: unknown) => { const r = cellValue(v); const s = r === null || r === undefined ? "" : String(r).trim(); return s || undefined; };

/** Downloads the template: a data sheet with the headers, an instructions sheet with an example, and drop-down lists. */
export async function downloadProductTemplate(groups: string[], units: string[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(tr("Bidhaa"), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = PRODUCT_COLUMNS.map((c) => ({ header: c.label() + (c.required ? " *" : ""), key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.height = 24;
  head.eachCell((cell, i) => {
    const required = PRODUCT_COLUMNS[i - 1].required;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: required ? "FF4F46E5" : "FF0891B2" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  for (const k of ["sellingPrice", "buyingPrice", "quantity", "reorderLevel"] as Key[]) ws.getColumn(k).numFmt = "#,##0.##";
  ws.getColumn("barcode").numFmt = "@";
  ws.getColumn("itemCode").numFmt = "@";

  const lists = wb.addWorksheet("Lists", { state: "hidden" });
  lists.getCell("A1").value = "groups"; lists.getCell("B1").value = "units";
  groups.forEach((g, i) => { lists.getCell(i + 2, 1).value = g; });
  units.forEach((u, i) => { lists.getCell(i + 2, 2).value = u; });
  const dv = (col: string, listCol: string, n: number) => {
    if (!n) return;
    for (let r = 2; r <= 1000; r++) ws.getCell(`${col}${r}`).dataValidation = { type: "list", allowBlank: true, showErrorMessage: false, formulae: [`Lists!$${listCol}$2:$${listCol}$${n + 1}`] };
  };
  dv("D", "A", groups.length);
  dv("E", "B", units.length);

  const help = wb.addWorksheet(tr("Maelekezo"));
  help.getColumn(1).width = 28; help.getColumn(2).width = 80;
  const title = help.addRow([tr("Jinsi ya kujaza")]); title.font = { bold: true, size: 14 };
  help.addRow([]);
  const lines: string[][] = [
    [tr("Jina la bidhaa") + " *", tr("Lazima. Jina la bidhaa kama litakavyoonekana kwenye mauzo.")],
    [tr("Msimbo wa bidhaa"), tr("Hiari. Ukiacha wazi, mfumo utatengeneza msimbo (ITM-0001, ITM-0002...).")],
    [tr("Barcode"), tr("Hiari. Isijirudie kwa bidhaa nyingine.")],
    [tr("Kundi"), tr("Hiari. Jina la kundi (mf. Vinywaji). Likikosekana kwenye mfumo, litatengenezwa.")],
    [tr("Kipimo"), tr("Hiari. Mf. Kipande, Kg, Lita. Kikikosekana kwenye mfumo, kitatengenezwa.")],
    [tr("Bei ya kuuzia") + " *", tr("Lazima. Bei ambayo mteja analipa kwa kipimo kimoja.")],
    [tr("Bei ya manunuzi"), tr("Hiari. Bei uliyonunulia kwa kipimo kimoja; hutumika kuhesabu thamani ya stoo na faida.")],
    [tr("Idadi"), tr("Hiari. Idadi uliyonayo sasa; huingia stoo kama stoo ya kuanzia.")],
    [tr("Kiwango cha kuagiza upya"), tr("Hiari. Ukifika kiwango hiki utapewa taarifa ya stoo kuisha.")],
    [],
    [tr("Muhimu"), tr("Futa safu hii ya maelekezo si lazima. Jaza bidhaa kwenye ukurasa wa kwanza, kisha pakia faili kwenye mfumo.")],
    [tr("Bidhaa iliyopo tayari"), tr("Bei na taarifa zake zitaboreshwa; idadi haitaguswa (tumia Manunuzi au Marekebisho ya Kiasi).")],
  ];
  for (const l of lines) { const r = help.addRow(l); r.getCell(1).font = { bold: true }; r.getCell(2).alignment = { wrapText: true, vertical: "top" }; }
  help.addRow([]);
  const ex = help.addRow([tr("Mfano")]); ex.font = { bold: true };
  const exHead = help.addRow(PRODUCT_COLUMNS.map((c) => c.label()));
  exHead.font = { bold: true };
  help.addRow([tr("Sukari 1kg"), "", "6001234567890", tr("Chakula"), "Kg", 3000, 2400, 50, 10]);
  for (let c = 3; c <= 9; c++) help.getColumn(c).width = 18;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "SmartHubPOS-products-template.xlsx"; a.click();
  URL.revokeObjectURL(url);
}

/** Reads an uploaded .xlsx: finds the header row (Kiswahili or English names), returns one entry per filled row. */
export async function parseProductFile(file: File): Promise<{ rows: ParsedRow[]; missing: string[] }> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const aliasToKey = new Map<string, Key>();
  for (const c of PRODUCT_COLUMNS) for (const a of c.aliases) aliasToKey.set(a, c.key);

  let bestMatch = new Set<Key>(); // the best partial header row seen, so the error names only what is really missing
  for (const ws of wb.worksheets) {
    if (ws.state === "hidden") continue;
    let headerRow = 0;
    const colOf = new Map<Key, number>();
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (headerRow) return;
      const found = new Map<Key, number>();
      row.eachCell((cell, col) => { const k = aliasToKey.get(norm(cellValue(cell.value))); if (k && !found.has(k)) found.set(k, col); });
      if (found.size > bestMatch.size) bestMatch = new Set(found.keys());
      if (found.has("name") && found.has("sellingPrice")) { headerRow = rowNumber; found.forEach((c, k) => colOf.set(k, c)); }
    });
    if (!headerRow) continue;
    const rows: ParsedRow[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (k: Key) => (colOf.has(k) ? row.getCell(colOf.get(k)!).value : undefined);
      const name = toText(get("name"));
      const values = [...colOf.keys()].map((k) => toText(get(k)));
      if (!values.some(Boolean)) continue; // empty row
      const item: ImportRow = { name: name ?? "", itemCode: toText(get("itemCode")), barcode: toText(get("barcode")), group: toText(get("group")), unit: toText(get("unit")) };
      let error: string | undefined;
      for (const k of ["sellingPrice", "buyingPrice", "quantity", "reorderLevel"] as const) {
        const n = toNumber(get(k));
        const label = PRODUCT_COLUMNS.find((c) => c.key === k)!.label();
        if (n === "bad") error = tr("Namba si sahihi kwenye safu ya {0}.", [label]);
        else if (n !== undefined && n < 0) error = tr("Namba hasi haikubaliki kwenye safu ya {0}.", [label]);
        else if (n !== undefined) item[k] = n;
      }
      if (item.sellingPrice === undefined && !error) error = tr("Bei ya kuuzia inahitajika.");
      if (!name) error = tr("Jina la bidhaa linahitajika.");
      rows.push({ line: r, row: item, error });
    }
    return { rows, missing: [] };
  }
  return { rows: [], missing: PRODUCT_COLUMNS.filter((c) => c.required && !bestMatch.has(c.key)).map((c) => c.label()) };
}

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Checks the chosen file before it is read. Returns a user-facing message, or null when the file may be parsed. */
export function checkProductFile(file: { name: string; size?: number }): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) return tr("Faili la .xls la zamani halitumiki. Lifungue kwenye Excel, kisha Save As .xlsx.");
  if (!name.endsWith(".xlsx")) return tr("Tumia faili la Excel (.xlsx) lililotolewa na mfumo.");
  if (file.size === 0) return tr("Faili ni tupu.");
  if (file.size !== undefined && file.size > MAX_IMPORT_BYTES) return tr("Faili ni kubwa mno (kikomo 10 MB).");
  return null;
}

/**
 * Flags repeats inside ONE file (same name, item code or barcode) across the WHOLE file. The server only sees 400 rows at a time,
 * so a repeat in two different batches would otherwise pass the preview and fail (or double-create) while importing.
 * The first occurrence is kept; later ones get an error. Rows that already have an error are left as they are.
 */
export function markFileDuplicates(rows: ParsedRow[]): ParsedRow[] {
  const names = new Map<string, number>(), codes = new Map<string, number>(), barcodes = new Map<string, number>();
  const key = (s?: string) => (s ?? "").trim().toLowerCase();
  return rows.map((p) => {
    if (p.error) return p;
    const n = key(p.row.name), c = key(p.row.itemCode), bc = key(p.row.barcode);
    const first = names.get(n) ?? (c ? codes.get(c) : undefined) ?? (bc ? barcodes.get(bc) : undefined);
    if (first !== undefined) return { ...p, error: tr("Bidhaa hii imerudiwa kwenye faili (safu {0}).", [first]) };
    names.set(n, p.line); if (c) codes.set(c, p.line); if (bc) barcodes.set(bc, p.line);
    return p;
  });
}

