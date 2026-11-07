const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Share a payment over invoices, OLDEST FIRST. Returns what each invoice receives and what is left over (> 0 = more than the debts).
 * 
 */
export function allocateRepayment(invoices: Array<{ id: string; outstanding: number }>, paying: number) {
  let left = r2(paying);
  const out: Array<{ id: string; amount: number }> = [];
  for (const i of invoices) {
    if (left <= 0.001) break;
    const amount = r2(Math.min(left, i.outstanding));
    if (amount > 0) { out.push({ id: i.id, amount }); left = r2(left - amount); }
  }
  return { allocations: out, leftover: left };
}
