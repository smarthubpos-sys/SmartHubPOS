import { useEffect, useState } from "react";
import { tr } from "@/lib/i18n.ts";
import { fmtQty, readDisplay, subscribeDisplay, type DisplayState } from "@/lib/customer-display.ts";

const money = (n: number) => Number(n).toLocaleString();

/** Full-screen view for the customer: the items bought so far with their quantities, and the total to pay. Updates by itself as items are added. */
export default function CustomerDisplayPage() {
  const [state, setState] = useState<DisplayState | null>(() => readDisplay());
  useEffect(() => subscribeDisplay(setState), []);
  const lines = state?.lines ?? [];
  const numbersOnly = state?.numbersOnly === true; // number-only machines: no product names, just the quantity and the total
  return (
    <main className="flex min-h-screen flex-col bg-slate-950 p-6 text-white">
      <h1 className="text-center text-3xl font-bold">{state?.businessName || "SmartHub POS"}</h1>
      {lines.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-4xl font-semibold text-slate-300">{tr("Karibu")}</div>
      ) : (
        <>
          {!numbersOnly && <ul className="mt-6 flex-1 space-y-2 overflow-y-auto">
            {lines.map((l, i) => (
              <li key={`${l.name}-${i}`} className="flex items-center justify-between gap-4 rounded-xl bg-slate-900 px-5 py-3 text-2xl">
                <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                <span className="shrink-0 text-slate-300 tabular-nums">{money(l.price)} × {fmtQty(l.qty)}</span>
                <span className="w-40 shrink-0 text-right font-bold tabular-nums">{money(l.total)}</span>
              </li>
            ))}
          </ul>}
          <div className={`grid grid-cols-2 gap-4 rounded-2xl bg-emerald-600 px-6 py-4 ${numbersOnly ? "my-auto py-12" : "mt-4"}`}>
            <div><div className="text-lg text-emerald-100">{tr("Idadi ya vitu")}</div><div className="text-5xl font-extrabold tabular-nums">{fmtQty(state?.itemCount ?? 0)}</div></div>
            <div className="text-right"><div className="text-lg text-emerald-100">{tr("Jumla ya kulipa")}</div><div className="text-5xl font-extrabold tabular-nums">{money(state?.total ?? 0)}</div></div>
          </div>
        </>
      )}
    </main>
  );
}
