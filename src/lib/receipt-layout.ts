import type { PaperChoice } from "./print-policy.ts";

/**
 * ONE size system for every printed bill, invoice, order slip and payment receipt.
 * The text size follows the paper chosen in Hardware Setup (58mm / 80mm / A4), so a bill and an invoice always
 * come out the same size, filling the paper width, instead of each document using its own small font.
 */
export type ReceiptScale = {
  /** CSS width of the page (A4 is printed on a 190mm column inside the 210mm sheet). */
  width: string;
  base: number;
  company: number;
  title: number;
  total: number;
  /** Width of the "Label" column in "Label : value" rows. */
  label: string;
  logoMax: string;
  padX: string;
};

export function receiptScale(paperIn: PaperChoice | string): ReceiptScale {
  const paper = String(paperIn).toLowerCase() === "a4" ? "A4" : String(paperIn).toLowerCase();
  if (paper === "58mm") return { width: "58mm", base: 12, company: 14, title: 16, total: 15, label: "21mm", logoMax: "12mm", padX: "2mm" };
  if (paper === "A4") return { width: "190mm", base: 14, company: 20, title: 24, total: 18, label: "42mm", logoMax: "26mm", padX: "0" };
  return { width: "80mm", base: 15, company: 18, title: 20, total: 18, label: "30mm", logoMax: "18mm", padX: "0" };
}

/** Stylesheet shared by every QZ Tray receipt. Class names: head, co, cname, logo, title, row, lab, between, qty, name, amount, total, sign, line, c. */
export function receiptCss(paperIn: PaperChoice | string): string {
  const s = receiptScale(paperIn);
  const paper = String(paperIn).toLowerCase();
  const logoPct = paper === "58mm" ? "28%" : "30%";
  return `@page{size:${s.width} auto;margin:0}*{box-sizing:border-box}
    body{font:${s.base}px/1.35 Arial,Helvetica,sans-serif;font-weight:600;margin:0 auto;width:${paper === "80mm" ? "72mm" : s.width};padding:0 ${s.padX};overflow-wrap:anywhere;color:#000}
    .c{text-align:center}p{margin:0 0 3px}
    .title{font-size:${s.title}px;font-weight:800;margin:6px 0 2px;padding:3px 0;border-top:1px solid #000;border-bottom:1px solid #000}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:4px}
    .co{flex:1;min-width:0;text-align:left}.cname{font-size:${s.company}px;font-weight:800;line-height:1.2}
    .logo{flex:none;max-width:${logoPct};max-height:${s.logoMax};object-fit:contain;filter:grayscale(1)}
    hr{border:0;border-top:1px dashed #000;margin:6px 0}
    .row{display:flex;gap:2px}.lab{display:inline-block;min-width:${s.label}}.between{justify-content:space-between}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th,td{padding:2px 1px;vertical-align:top;text-align:left;font-size:${s.base}px}th{font-weight:800}
    .qty{width:12%;overflow-wrap:anywhere}.name{width:56%;overflow-wrap:anywhere;word-break:normal}.name.wide{width:68%}
    .amount{width:32%;text-align:right;overflow-wrap:anywhere}th.amount{text-align:right}
    .total{display:flex;justify-content:space-between;font-weight:800;font-size:${s.total}px;margin:2px 0}
    .sign{display:flex;gap:2px;margin:12px 0 2px}.line{flex:1;border-bottom:1px solid #000}`;
}
