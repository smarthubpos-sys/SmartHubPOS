import { toast } from "sonner";
import { tr } from "./i18n.ts";

export type PrintableOrder = {
  customerName: string;
  waiterName: string;
  total: number;
  tableNumber?: string;
  notes?: string;
  lines: Array<{ productName: string; qty: number; lineTotal: number }>;
};

/** Prints a waiter order slip (browser print dialog). Never changes stock. */
export function printWaiterOrder(order: PrintableOrder) {
  const content = [
    "SMARTHUB POS - ODA",
    `Mteja: ${order.customerName}`,
    `Meza: ${order.tableNumber || "-"}`,
    `Waiter: ${order.waiterName}`,
    "------------------------------",
    ...order.lines.map((line) =>
      `${line.productName} x ${line.qty} = ${Number(line.lineTotal).toLocaleString()}`
    ),
    "------------------------------",
    `JUMLA: ${Number(order.total).toLocaleString()}`,
    order.notes ? `Maelezo: ${order.notes}` : "",
  ].filter(Boolean).join("\n");

  const win = window.open("", "_blank", "width=420,height=650");
  if (!win) {
    toast.error(tr("Ruhusu popup ili kuchapisha oda."));
    return;
  }
  win.document.write(`<html><head><title>Oda</title><style>body{font:14px monospace;padding:20px;white-space:pre-wrap}</style></head><body></body></html>`);
  win.document.body.textContent = content;
  win.document.close();
  win.focus();
  win.print();
  win.close();
}
