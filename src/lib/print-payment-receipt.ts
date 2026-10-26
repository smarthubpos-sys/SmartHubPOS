import { toast } from "sonner";
import { tr } from "./i18n.ts";
import { printHtmlViaQz } from "./printers.ts";
import { stamp, type ReceiptBranding } from "./receipt-branding.ts";

/** What a payment receipt (risiti ya malipo) shows. Everything is optional except the money. */
export type PaymentReceipt = {
  receiptNo?: string;
  cashierName?: string;
  /** Waiter who handed the money over (money received from a waiter). */
  fromName?: string;
  customerName?: string;
  tableNumber?: string;
  /** Items sold (counter sale). */
  items?: Array<{ name: string; qty: number; amount: number }>;
  /** Orders settled (money received from a waiter). */
  orders?: Array<{ label: string; amount: number }>;
  payments: Array<{ method: string; amount: number }>;
  total: number;
};

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c] as string);

const num = (n: number) => Number(n).toLocaleString();

/** Builds the HTML of a payment receipt. Pure (no printing), so it can be tested. */
export function paymentReceiptHtml(r: PaymentReceipt, paperWidth = "80mm", branding: ReceiptBranding = {}, at = new Date()): string {
  const width = paperWidth === "58mm" ? "58mm" : paperWidth === "A4" ? "190mm" : "80mm";
  const info = (label: string, value?: string) => value ? `<div class="row"><span class="lab">${escapeHtml(label)}</span><span>: ${escapeHtml(value)}</span></div>` : "";
  const company = (branding.companyName ?? "").trim();
  const itemRows = (r.items ?? []).map((i) => `<tr><td class="qty">${escapeHtml(num(i.qty))}</td><td class="name">${escapeHtml(i.name)}</td><td class="amount">${escapeHtml(num(i.amount))}/=</td></tr>`).join("");
  const orderRows = (r.orders ?? []).map((o) => `<tr><td class="name wide">${escapeHtml(o.label)}</td><td class="amount">${escapeHtml(num(o.amount))}/=</td></tr>`).join("");
  const payRows = r.payments.map((p) => `<div class="row between"><span>${escapeHtml(p.method)}</span><span>${escapeHtml(num(p.amount))}/=</span></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:${width} auto;margin:3mm}*{box-sizing:border-box}
    body{font:12px/1.35 Arial,Helvetica,sans-serif;font-weight:600;margin:0;width:100%;overflow-wrap:anywhere;color:#000}
    .c{text-align:center}p{margin:0 0 3px}
    .title{font-size:15px;font-weight:800;margin:6px 0 2px;padding:3px 0;border-top:1px solid #000;border-bottom:1px solid #000}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:4px}
    .co{flex:1;min-width:0;text-align:left}.cname{font-size:13px;font-weight:800;line-height:1.2}
    .logo{flex:none;max-width:${paperWidth === "58mm" ? "28%" : "30%"};max-height:${paperWidth === "58mm" ? "11mm" : paperWidth === "A4" ? "26mm" : "16mm"};object-fit:contain;filter:grayscale(1)}
    hr{border:0;border-top:1px dashed #000;margin:6px 0}
    .row{display:flex;gap:2px}.lab{display:inline-block;min-width:22mm}.between{justify-content:space-between}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th,td{padding:2px 1px;vertical-align:top;text-align:left}th{font-weight:800}
    .qty{width:12%;overflow-wrap:anywhere}.name{width:56%;overflow-wrap:anywhere;word-break:normal}.name.wide{width:68%}
    .amount{width:32%;text-align:right;overflow-wrap:anywhere}th.amount{text-align:right}
    .total{display:flex;justify-content:space-between;font-weight:800;font-size:14px;margin:2px 0}
  </style></head><body>
    <div class="head">
      <div class="co">
        ${company ? `<p class="cname">${escapeHtml(company.toUpperCase())}</p>` : ""}
        ${branding.address ? `<p>${escapeHtml(branding.address)}</p>` : ""}
        ${branding.phone ? `<p>TEL : ${escapeHtml(branding.phone)}</p>` : ""}
      </div>
      ${branding.logoUrl ? `<img class="logo" alt="" src="${escapeHtml(branding.logoUrl)}">` : ""}
    </div>
    <p class="c title">${escapeHtml(branding.title || tr("RISITI YA MALIPO"))}</p>
    <hr>
    ${info(tr("Muda wa kuchapa"), stamp(at))}
    ${info(tr("Namba ya risiti"), r.receiptNo)}
    ${info(tr("Cashier"), r.cashierName)}
    ${info(tr("Imepokelewa kutoka"), r.fromName)}
    ${info(tr("Mteja"), r.customerName)}
    ${info(tr("Namba ya meza"), r.tableNumber)}
    <hr>
    ${itemRows ? `<table><thead><tr><th class="qty">${escapeHtml(tr("IDADI"))}</th><th class="name">${escapeHtml(tr("BIDHAA"))}</th><th class="amount">${escapeHtml(tr("KIASI"))}</th></tr></thead><tbody>${itemRows}</tbody></table><hr>` : ""}
    ${orderRows ? `<table><tbody>${orderRows}</tbody></table><hr>` : ""}
    <div class="total"><span>${escapeHtml(tr("JUMLA"))}</span><span>${escapeHtml(num(r.total))}/=</span></div>
    <p>${escapeHtml(tr("Imelipwa kwa"))}:</p>
    ${payRows}
    <hr>
    ${branding.footer ? `<p class="c">${escapeHtml(branding.footer)}</p>` : `<p class="c">${escapeHtml(tr("Asante kwa kutuchagua"))}</p>`}
  </body></html>`;
}

/**
 * Prints a payment receipt on the QZ Tray printer saved under Maintenance > Hardware (same printer rule as order slips and bills).
 * Resolves true when QZ Tray accepted the job. It never changes money or stock: it only prints what was already saved.
 */
export async function printPaymentReceipt(r: PaymentReceipt, printerName?: string, paperWidth = "80mm", branding: ReceiptBranding = {}): Promise<boolean> {
  if (!printerName?.trim()) {
    toast.error(tr("Chagua printer ya QZ Tray kwenye mipangilio ya vifaa kabla ya kuchapa."));
    return false;
  }
  try {
    await printHtmlViaQz(printerName.trim(), paymentReceiptHtml(r, paperWidth, branding));
    return true;
  } catch (error) {
    toast.error(`${tr("Imeshindikana kuchapa kupitia QZ Tray. Hakikisha QZ Tray imewashwa, printer imechaguliwa, na mipangilio ya cheti/signature imekamilika.")} ${error instanceof Error ? error.message : String(error ?? "")}`);
    return false;
  }
}
