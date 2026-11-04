import { round2 } from "@/pages/shared/report-utils.ts";

/** End-of-day check: sales = money received by each method + debt (debt is information only, never taken out of Cash). */
export function dayEndRows(payments: Array<{ method: string; amount: number }>, sales: number, debt: number) {
  const byMethod = new Map<string, number>();
  for (const p of payments) byMethod.set(p.method, round2((byMethod.get(p.method) ?? 0) + p.amount));
  const methods = [...byMethod.entries()].sort((a, b) => b[1] - a[1]);
  const received = round2(methods.reduce((n, [, v]) => n + v, 0));
  const difference = round2(sales - received - debt);
  return { methods, received, difference };
}
