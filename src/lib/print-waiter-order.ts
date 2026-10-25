import { toast } from "sonner";
import { tr } from "./i18n.ts";
import { printHtmlViaQz } from "./printers.ts";

export type PrintableOrder = {
  customerName: string;
  waiterName: string;
  total: number;
  tableNumber?: string;
  notes?: string;
  lines: Array<{ productName: string; qty: number; lineTotal: number }>;
};

type HardwareSettings = { printerSource?: string; receiptPrinter?: string; paperWidth?: string };

/**
 * The QZ Tray printer saved under Maintenance > Hardware. One rule for waiter, cashier and Bills printing.
 * "direct" (USB/Bluetooth) printers are not QZ printers; everything else with a saved name is used as-is.
 */
export function qzPrinterFrom(hardware?: HardwareSettings | null): string | undefined {
  if (!hardware || hardware.printerSource === "direct") return undefined;
  return hardware.receiptPrinter?.trim() || undefined;
}

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c] as string);

/**
 * Print waiter order slips through the configured QZ Tray printer only.
 * Resolving true means QZ Tray accepted the job; it cannot prove paper physically emerged.
 */
export async function printWaiterOrder(order: PrintableOrder, printerName?: string, paperWidth = "80mm"): Promise<boolean> {
  if (!printerName?.trim()) {
    toast.error(tr("Chagua printer ya QZ Tray kwenye mipangilio ya vifaa kabla ya kuchapa."));
    return false;
  }
  const rows = order.lines.map((line) => `<tr>
    <td class="name">${escapeHtml(line.productName)}</td>
    <td class="qty">${escapeHtml(Number(line.qty).toLocaleString())}</td>
    <td class="amount">${escapeHtml(Number(line.lineTotal).toLocaleString())}</td>
  </tr>`).join("");
  const width = paperWidth === "58mm" ? "58mm" : paperWidth === "A4" ? "190mm" : "80mm";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:${width} auto;margin:3mm}*{box-sizing:border-box}
    body{font:12px/1.35 monospace;margin:0;width:100%;overflow-wrap:anywhere}
    h2,p{margin:0 0 5px}h2{text-align:center;font-size:14px}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th,td{padding:3px 1px;border-bottom:1px dashed #999;vertical-align:top}
    th{text-align:left} .name{width:52%;overflow-wrap:anywhere;word-break:normal}
    .qty{width:14%;text-align:right;white-space:normal}
    .amount{width:34%;text-align:right;overflow-wrap:anywhere}
    .total{font-weight:bold;text-align:right;margin-top:8px}
  </style></head><body>
    <h2>SMARTHUB POS - ODA</h2>
    <p>${escapeHtml(tr("Mteja"))}: ${escapeHtml(order.customerName)}</p>
    <p>${escapeHtml(tr("Meza"))}: ${escapeHtml(order.tableNumber || "-")}</p>
    <p>${escapeHtml(tr("Waiter"))}: ${escapeHtml(order.waiterName)}</p>
    <table><thead><tr><th class="name">${escapeHtml(tr("Bidhaa"))}</th><th class="qty">${escapeHtml(tr("Idadi"))}</th><th class="amount">${escapeHtml(tr("Jumla"))}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="total">${escapeHtml(tr("JUMLA"))}: ${escapeHtml(Number(order.total).toLocaleString())}</p>
    ${order.notes ? `<p>${escapeHtml(tr("Maelezo"))}: ${escapeHtml(order.notes)}</p>` : ""}
  </body></html>`;
  try {
    await printHtmlViaQz(printerName.trim(), html);
    return true;
  } catch (error) {
    toast.error(`${tr("Imeshindikana kuchapa kupitia QZ Tray. Hakikisha QZ Tray imewashwa, printer imechaguliwa, na mipangilio ya cheti/signature imekamilika.")} ${error instanceof Error ? error.message : String(error ?? "")}`);
    return false;
  }
}
