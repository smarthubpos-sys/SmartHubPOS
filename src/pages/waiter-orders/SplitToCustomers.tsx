import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PaymentSplit from "@/components/PaymentSplit.tsx";
import type { PayMethod } from "@/hooks/use-payment-methods.ts";
import { errorText, tr } from "@/lib/i18n.ts";
import { newSplitLine, splitsTotal, toSplits, type SplitLine } from "@/lib/payment-split.ts";

type Part = { key: number; clientId: string; amount: string; payNow: boolean; lines: SplitLine[] };
const money = (n: number) => Number(n).toLocaleString();
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };

/**
 * Cashier: share the debt of the chosen waiter bills between 2, 3, 4 ... customers.
 * Each customer takes an amount; he may pay it now (cash, Tigo Pesa, any methods) or it stays his debt. Anything not given to a customer stays with the waiter.
 */
export default function SplitToCustomers({ orderIds, due, customers, methods, disabled, onDone }: {
  orderIds: Id<"waiterOrders">[];
  due: number;
  customers: Array<{ _id: Id<"clients">; name: string; owes: number }>;
  methods: PayMethod[];
  disabled?: boolean;
  onDone: () => void;
}) {
  const split = useMutation(api.customerDebt.splitDebtToCustomers);
  const keyRef = useRef(2);
  const blank = (key: number): Part => ({ key, clientId: "", amount: "", payNow: false, lines: [newSplitLine(methods)] });
  const [parts, setParts] = useState<Part[]>(() => [blank(0), blank(1)]);
  const [busy, setBusy] = useState(false);

  const patch = (key: number, p: Partial<Part>) => setParts((all) => all.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const allocated = r2(parts.reduce((n, p) => n + num(p.amount), 0));
  const left = r2(due - allocated);
  const chosenIds = parts.map((p) => p.clientId).filter(Boolean);
  const unique = new Set(chosenIds).size === chosenIds.length;
  const rowOk = (p: Part) => !!p.clientId && num(p.amount) > 0 && (!p.payNow || (splitsTotal(p.lines) > 0.005 && splitsTotal(p.lines) <= num(p.amount) + 0.005));
  const canSave = !busy && !disabled && orderIds.length > 0 && due > 0.005 && parts.every(rowOk) && unique && allocated > 0.005 && left > -0.005;
  const payingNow = r2(parts.reduce((n, p) => n + (p.payNow ? splitsTotal(p.lines) : 0), 0));

  function share() {
    const n = parts.length, each = Math.floor((due / n) * 100) / 100;
    setParts((all) => all.map((p, i) => ({ ...p, amount: String(i === n - 1 ? r2(due - each * (n - 1)) : each) })));
  }
  async function save() {
    if (!canSave) return;
    if (!window.confirm(tr("Gawanya {0} kwa wateja {1}? Mhudumu hatadaiwa kiasi hicho tena.", [money(allocated), String(parts.length)]))) return;
    setBusy(true);
    try {
      const res = await split({
        orderIds,
        parts: parts.map((p) => ({ clientId: p.clientId as Id<"clients">, amount: num(p.amount), ...(p.payNow ? { paid: toSplits(p.lines, methods) as never } : {}) })),
      });
      const paid = r2(res.parts.reduce((n, x) => n + x.paid, 0));
      toast.success(tr("Deni limegawanywa kwa wateja {0}. Limelipwa sasa: {1}. Deni lililobaki kwa mhudumu: {2}", [String(res.parts.length), money(paid), money(res.waiterLeft)]));
      onDone();
    } catch (e) {
      toast.error(errorText(e, tr("Imeshindikana kugawanya deni. Hakuna kilichorekodiwa; jaribu tena.")));
    } finally { setBusy(false); }
  }

  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">{tr("Gawanya deni kwa wateja wengi (mkopo na malipo ya papo hapo)")}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{tr("Kila mteja anachukua sehemu ya deni la bili zilizotiki ({0}). Anaweza kulipa sasa (Cash, Tigo Pesa, n.k.) au kinabaki deni lake. Usichompa mteja yeyote kinabaki kwa mhudumu.", [money(due)])}</p>
      <div className="mt-3 space-y-3">
        {parts.map((p, i) => (
          <div key={p.key} className="space-y-2 rounded-md border bg-background p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-xs text-muted-foreground">{i + 1}.</span>
              <select className="h-10 min-w-48 flex-1 rounded-md border bg-background px-3" value={p.clientId} disabled={busy} onChange={(e) => patch(p.key, { clientId: e.target.value })} aria-label={tr("Chagua mteja")}>
                <option value="">{tr("Chagua mteja")}</option>
                {customers.map((c) => <option key={String(c._id)} value={String(c._id)}>{c.name}{c.owes > 0 ? ` · ${tr("anadaiwa")} ${money(c.owes)}` : ""}</option>)}
              </select>
              <Input className="h-10 w-36" type="number" min="0" step="0.01" inputMode="decimal" placeholder={tr("Kiasi")} value={p.amount} disabled={busy} onChange={(e) => patch(p.key, { amount: e.target.value })} aria-label={tr("Kiasi")} />
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4" checked={p.payNow} disabled={busy} onChange={(e) => patch(p.key, { payNow: e.target.checked, lines: [newSplitLine(methods, p.amount || undefined)] })} />{tr("Analipa sasa")}</label>
              <Button type="button" size="sm" variant="ghost" disabled={busy || parts.length <= 1} onClick={() => setParts((all) => all.filter((x) => x.key !== p.key))}>{tr("Ondoa")}</Button>
            </div>
            {p.payNow && <PaymentSplit methods={methods} lines={p.lines} onChange={(lines) => patch(p.key, { lines })} due={num(p.amount)} disabled={busy} />}
            {p.payNow && num(p.amount) > 0 && splitsTotal(p.lines) > num(p.amount) + 0.005 && <p className="text-xs text-destructive">{tr("Malipo yamezidi kiasi cha mteja huyu.")}</p>}
          </div>
        ))}
        {!unique && <p className="text-xs text-destructive">{tr("Mteja mmoja amewekwa mara mbili.")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy || parts.length >= 20} onClick={() => { setParts((all) => [...all, blank(keyRef.current++)]); }}>{tr("Ongeza mteja")}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || due <= 0.005} onClick={share}>{tr("Gawanya sawa kwa wote")}</Button>
        </div>
        <div className="space-y-0.5 text-sm">
          <div>{tr("Jumla ya sehemu za wateja")}: <b>{money(allocated)}</b> / {money(due)}</div>
          {payingNow > 0 && <div>{tr("Wanalipa sasa")}: <b>{money(payingNow)}</b></div>}
          <div className={left < -0.005 ? "text-destructive" : "text-muted-foreground"}>{left < -0.005 ? tr("Umezidisha deni la bili kwa") : tr("Kinabaki kwa mhudumu")}: <b>{money(Math.abs(left))}</b></div>
        </div>
        <Button type="button" disabled={!canSave} onClick={() => void save()}>{busy ? tr("Inahifadhi…") : tr("Gawanya deni")}</Button>
      </div>
    </details>
  );
}
