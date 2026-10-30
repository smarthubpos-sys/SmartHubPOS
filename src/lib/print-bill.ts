import { stamp } from "./receipt-branding.ts";
import { receiptCss } from "./receipt-layout.ts";

/** What the customer bill / sales invoice needs to print. Mirrors the data the Bills and Sales screens already load. */
export type PrintableBill = {
  heading: string;
  kind: "bill" | "invoice";
  company: { name?: string; address?: string; phone?: string; taxId?: string; logoUrl?: string };
  openedAt?: string;
  printedAt: Date;
  billId?: string;
  cashier?: string;
  customer?: string;
  department?: string;
  lines: Array<{ qty: string; name: string; amount: string }>;
  discount?: string;
  tax?: string;
  totalLabel: string;
  total: string;
  paid?: { label: string; amount: string; outstanding: string };
  paymentInfo?: string[];
  footer?: string;
  labels: Record<"openTime" | "printTime" | "billNo" | "waiter" | "customer" | "department" | "qty" | "item" | "amount" | "discount" | "tax" | "outstanding" | "notes", string>;
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * HTML of a customer bill or sales invoice for QZ Tray. It is built from data (not copied from the screen),
 * so the size always comes from the shared receipt layout for the paper chosen in Hardware Setup.
 */
export function billReceiptHtml(b: PrintableBill, paper: string): string {
  const info = (label: string, value?: string) => value ? `<div class="row"><span class="lab">${esc(label)}</span><span>: ${esc(value)}</span></div>` : "";
  const rows = b.lines.map((l) => `<tr><td class="qty">${esc(l.qty)}</td><td class="name">${esc(l.name)}</td><td class="amount">${esc(l.amount)}/=</td></tr>`).join("");
  const money = (label: string, value: string, strong = false) => `<div class="${strong ? "total" : "row between"}"><span>${esc(label)}</span><span>${esc(value)}/=</span></div>`;
  const company = (b.company.name ?? "").trim();
  const L = b.labels;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${receiptCss(paper)}</style></head><body>
    <div class="head">
      <div class="co">
        ${company ? `<p class="cname">${esc(company.toUpperCase())}</p>` : ""}
        ${b.company.address ? `<p>${esc(b.company.address)}</p>` : ""}
        ${b.company.phone ? `<p>TEL : ${esc(b.company.phone)}</p>` : ""}
        ${b.company.taxId ? `<p>TIN : ${esc(b.company.taxId)}</p>` : ""}
      </div>
      ${b.company.logoUrl ? `<img class="logo" alt="" src="${esc(b.company.logoUrl)}">` : ""}
    </div>
    <p class="c title">${esc(b.heading)}</p>
    <hr>
    ${info(L.openTime, b.openedAt)}
    ${info(L.printTime, stamp(b.printedAt))}
    ${info(L.billNo, b.billId)}
    ${info(L.waiter, b.cashier)}
    ${info(L.customer, b.customer)}
    ${b.kind === "bill" ? info(L.department, b.department) : ""}
    <hr>
    <table><thead><tr><th class="qty">${esc(L.qty)}</th><th class="name">${esc(L.item)}</th><th class="amount">${esc(L.amount)}</th></tr></thead></table>
    <hr>
    <table><tbody>${rows}</tbody></table>
    <hr>
    ${b.discount ? money(L.discount, `-${b.discount}`) : ""}
    ${b.tax ? money(L.tax, b.tax) : ""}
    ${money(b.totalLabel, b.total, true)}
    ${b.paid ? `${money(b.paid.label, b.paid.amount)}${money(L.outstanding, b.paid.outstanding, true)}` : ""}
    <hr>
    ${b.kind === "bill" ? `<div class="sign"><span>${esc(L.customer)}</span><span>:</span><span class="line"></span></div><div class="sign"><span>${esc(L.notes)}</span><span>:</span><span class="line"></span></div><hr>` : ""}
    ${(b.paymentInfo ?? []).map((l) => `<p class="c">${esc(l)}</p>`).join("")}
    ${b.footer?.trim() ? `<p class="c">${esc(b.footer)}</p>` : ""}
  </body></html>`;
}
