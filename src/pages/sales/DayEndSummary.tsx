import { fmt } from "@/pages/shared/report-utils.ts";
import { dayEndRows } from "./day-end.ts";
import { tr, trValue } from "@/lib/i18n.ts";

/**
 * End-of-day check: sales = money received by each method + what is still owed (debt).
 * Debt is only shown here as information; it is never taken out of Cash (or any method), so the drawer, bank and mobile money
 * figures stay exactly what was received.   Example: sales 10,000 = Cash 5,000 + Bank 3,000 + Mobile 1,000 + Debt (John) 1,000.
 */
export default function DayEndSummary({ payments, sales, debt, debtors, waiterDebt }: {
  payments: Array<{ method: string; amount: number }>; sales: number; debt: number;
  debtors?: Array<{ name: string; amount: number }>; waiterDebt?: number; // Selling Point: debt waiters were left with (information only, those sales are counted when paid)
}) {
  const { methods, received, difference } = dayEndRows(payments, sales, debt);
  const row = (k: string, v: number, strong = false) => <div key={k} className={`flex justify-between gap-6 ${strong ? "border-t pt-1 font-semibold" : ""}`}><span>{k}</span><span className="tabular-nums">{fmt(v)}</span></div>;
  return (
    <section className="space-y-2 rounded-xl border p-4 text-sm sm:max-w-md">
      <h3 className="font-semibold">{tr("Muhtasari wa hesabu (malipo kwa njia + deni)")}</h3>
      {row(tr("Mauzo (jumla)"), sales, true)}
      {methods.map(([m, v]) => row(trValue(m), v))}
      {row(tr("Jumla iliyopokelewa"), received, true)}
      {row(tr("Deni (taarifa tu, halitolewi kwenye cash)"), debt)}
      {(debtors ?? []).slice(0, 8).map((d) => <div key={d.name} className="flex justify-between pl-4 text-xs text-muted-foreground"><span>{d.name}</span><span className="tabular-nums">{fmt(d.amount)}</span></div>)}
      {(waiterDebt ?? 0) > 0 && row(tr("Madeni ya wahudumu (taarifa tu)"), waiterDebt ?? 0)}
      {Math.abs(difference) > 0.009 && <p className="text-xs text-amber-700">{tr("Tofauti {0}: mara nyingi ni malipo ya madeni ya siku zilizopita au marekebisho ya invoice.", [fmt(difference)])}</p>}
    </section>
  );
}
