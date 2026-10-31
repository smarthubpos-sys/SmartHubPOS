import { num, round2 } from "@/pages/shared/report-utils.ts";

// Same reasons the server accepts in sales.voidInvoice.
export const CANCEL_REASONS = ["Kosa la kuingiza invoice", "Mteja amebadilisha mawazo", "Bidhaa ime-expire", "Kosa la bei au kiasi", "Mteja amebadilisha oda", "Sababu nyingine"];

/** Totals of an invoice being edited - the same arithmetic the server uses (it recalculates and is the authority). */
export function editedTotals(lines: Array<{ qty: string; price: string; discount: string }>, invoiceDiscount: string, taxRate: string) {
  const subtotal = round2(lines.reduce((n, l) => n + Math.max(0, round2(num(l.qty) * num(l.price) - num(l.discount))), 0));
  const discount = round2(num(invoiceDiscount));
  const taxable = round2(subtotal - discount);
  const tax = round2((taxable * num(taxRate)) / 100);
  return { subtotal, discount, tax, total: round2(taxable + tax) };
}
