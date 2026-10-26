import { toast } from "sonner";
import { tr } from "./i18n.ts";
import { printHtmlViaQz } from "./printers.ts";
import { stamp, type ReceiptBranding } from "./receipt-branding.ts";

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
export async function printWaiterOrder(order: PrintableOrder, printerName?: string, paperWidth = "80mm", branding: ReceiptBranding = {}): Promise<boolean> {
  if (!printerName?.trim()) {
    toast.error(tr("Chagua printer ya QZ Tray kwenye mipangilio ya vifaa kabla ya kuchapa."));
    return false;
  }
  const rows = order.lines.map((line) => `<tr>
    <td class="qty">${escapeHtml(Number(line.qty).toLocaleString())}</td>
    <td class="name">${escapeHtml(line.productName)}</td>
    <td class="amount">${escapeHtml(Number(line.lineTotal).toLocaleString())}/=</td>
  </tr>`).join("");
  const width = paperWidth === "58mm" ? "58mm" : paperWidth === "A4" ? "190mm" : "80mm";
  const info = (label: string, value?: string) => value ? `<div class="row"><span class="lab">${escapeHtml(label)}</span><span>: ${escapeHtml(value)}</span></div>` : "";
  const company = (branding.companyName ?? "").trim();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:${width} auto;margin:3mm}*{box-sizing:border-box}
    body{font:12px/1.35 Arial,Helvetica,sans-serif;font-weight:600;margin:0;width:100%;overflow-wrap:anywhere;color:#000}
    .c{text-align:center}p{margin:0 0 3px}.title{font-size:15px;font-weight:800;margin:6px 0 2px}
    .logo{display:block;margin:0 auto 4px;max-width:60%;max-height:70px;object-fit:contain;filter:grayscale(1)}
    hr{border:0;border-top:1px dashed #000;margin:6px 0}
    .row{display:flex;gap:2px}.lab{display:inline-block;min-width:22mm}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th,td{padding:2px 1px;vertical-align:top;text-align:left}th{font-weight:800}
    .qty{width:12%;overflow-wrap:anywhere}.name{width:56%;overflow-wrap:anywhere;word-break:normal}
    .amount{width:32%;text-align:right;overflow-wrap:anywhere}th.amount{text-align:right}
    .total{display:flex;justify-content:space-between;font-weight:800;font-size:14px;margin:2px 0}
    .sign{display:flex;gap:2px;margin:10px 0 2px}.line{flex:1;border-bottom:1px solid #000}
  </style></head><body>
    ${branding.logoUrl ? `<img class="logo" alt="" src="${escapeHtml(branding.logoUrl)}">` : ""}
    <p class="c title">${escapeHtml(branding.title || tr("ODA"))}</p>
    ${company ? `<p class="c">${escapeHtml(company.toUpperCase())}</p>` : ""}
    ${branding.address ? `<p class="c">${escapeHtml(branding.address)}</p>` : ""}
    ${branding.phone ? `<p class="c">TEL : ${escapeHtml(branding.phone)}</p>` : ""}
    <hr>
    ${info(tr("Muda wa kufungua"), branding.openTime)}
    ${info(tr("Muda wa kuchapa"), stamp(new Date()))}
    ${info(tr("Namba ya bili"), branding.billId)}
    ${info(tr("Mhudumu"), order.waiterName)}
    ${info(tr("Mteja"), order.customerName)}
    ${info(tr("Namba ya meza"), order.tableNumber)}
    <hr>
    <table><thead><tr><th class="qty">${escapeHtml(tr("IDADI"))}</th><th class="name">${escapeHtml(tr("BIDHAA"))}</th><th class="amount">${escapeHtml(tr("KIASI"))}</th></tr></thead></table>
    <hr>
    <table><tbody>${rows}</tbody></table>
    <hr>
    <div class="total"><span>${escapeHtml(tr("JUMLA INAYODAIWA"))}</span><span>${escapeHtml(Number(order.total).toLocaleString())}/=</span></div>
    <hr>
    ${order.notes ? `<p>${escapeHtml(tr("Maelezo"))}: ${escapeHtml(order.notes)}</p>` : `<div class="sign"><span>${escapeHtml(tr("Mteja"))}</span><span>:</span><span class="line"></span></div><div class="sign"><span>${escapeHtml(tr("Maelezo"))}</span><span>:</span><span class="line"></span></div>`}
    <hr>
    ${(branding.paymentInfo ?? []).map((l) => `<p class="c">${escapeHtml(l)}</p>`).join("")}
    ${branding.footer ? `<p class="c">${escapeHtml(branding.footer)}</p>` : ""}
  </body></html>`;
  try {
    await printHtmlViaQz(printerName.trim(), html);
    return true;
  } catch (error) {
    toast.error(`${tr("Imeshindikana kuchapa kupitia QZ Tray. Hakikisha QZ Tray imewashwa, printer imechaguliwa, na mipangilio ya cheti/signature imekamilika.")} ${error instanceof Error ? error.message : String(error ?? "")}`);
    return false;
  }
}
