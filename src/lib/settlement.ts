export type OutstandingInvoice = { id: string; invoiceNo: string; outstanding: number };
export type SplitPart = { method: string; methodId?: never; amount: number; reference?: string };
export type Allocation = { invoiceId: string; invoiceNo: string; splits: SplitPart[]; total: number };

const cents = (x: number) => Math.round(x * 100);
const money = (c: number) => c / 100;

/**
 * Spreads a (possibly split) staff settlement over the chosen invoices, in the order given (oldest first).
 * Each invoice is paid up to its outstanding balance, and each payment method is consumed in order, so
 * "part cash + part mobile money" lands on the right invoices and the totals always match to the cent.
 * Throws when the money is more than the selected invoices owe, so nothing is silently overpaid or lost.
 */
export function allocateSettlement(invoices: OutstandingInvoice[], splits: SplitPart[]): Allocation[] {
  const due = invoices.reduce((s, i) => s + cents(i.outstanding), 0);
  const paying = splits.reduce((s, p) => s + cents(p.amount), 0);
  if (paying <= 0) throw new Error("Weka kiasi cha malipo.");
  if (paying > due) throw new Error("Malipo yanazidi deni la invoice ulizochagua.");
  const left = splits.map((p) => ({ ...p, c: cents(p.amount) }));
  const out: Allocation[] = [];
  let k = 0;
  for (const inv of invoices) {
    let need = cents(inv.outstanding);
    const parts: SplitPart[] = [];
    while (need > 0 && k < left.length) {
      const take = Math.min(need, left[k].c);
      if (take > 0) {
        // a reference may be used only once by the backend, so extra pieces of the same payment get a suffix
        const ref = left[k].reference ? (out.length + parts.length === 0 && take === cents(left[k].amount) ? left[k].reference : `${left[k].reference}-${inv.invoiceNo}`) : undefined;
        parts.push({ method: left[k].method, methodId: left[k].methodId, amount: money(take), reference: ref });
        left[k].c -= take; need -= take;
      }
      if (left[k].c === 0) k++;
    }
    if (parts.length) out.push({ invoiceId: inv.id, invoiceNo: inv.invoiceNo, splits: parts, total: money(parts.reduce((s, p) => s + cents(p.amount), 0)) });
    if (k >= left.length) break;
  }
  return out;
}
