import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tr, errorText } from "@/lib/i18n.ts";
import { localDate } from "@/lib/format.ts";
import { usePaymentMethods } from "@/hooks/use-payment-methods.ts";
import PaymentSplit from "@/components/PaymentSplit.tsx";
import { newSplitLine, splitsTotal, toSplits, type SplitLine } from "@/lib/payment-split.ts";
import { allocateRepayment } from "@/lib/repayment.ts";

const money = (n: number) => Number(n).toLocaleString();
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Open = { _id: Id<"invoices">; invoiceNo: string; invoiceDate: string; outstanding: number };

/** Cashier: repayments book. Pick a saved customer, tick his debts (or type what he pays), choose how he pays. The money counts in the cash of the day it is received. */
export default function CustomerRepayments() {
  const methods = usePaymentMethods();
  const customers = useQuery(api.customerDebt.customersForCashier);
  const receive = useMutation(api.customerDebt.receiveRepayment);
  const [clientId, setClientId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [lines, setLines] = useState<SplitLine[]>(() => [newSplitLine(methods)]);
  const [changeDate, setChangeDate] = useState(false);
  const [payDate, setPayDate] = useState(() => localDate());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const data = useQuery(api.customerDebt.openInvoicesOfCustomer, clientId ? { clientId: clientId as Id<"clients"> } : "skip");

  const today = localDate();
  const open: Open[] = data?.invoices ?? [];
  const ticked = open.filter((i) => picked.includes(String(i._id)));
  const tickedDue = r2(ticked.reduce((n, i) => n + i.outstanding, 0));
  const paying = splitsTotal(lines);
  const targets = ticked.length ? ticked : open; // nothing ticked: the amount typed is shared over all his debts, oldest first
  const plan = allocateRepayment(targets.map((i) => ({ id: String(i._id), outstanding: i.outstanding })), paying);
  const dateOk = !changeDate || (/^\d{4}-\d{2}-\d{2}$/.test(payDate) && payDate <= today);
  const canSave = !busy && !!data && paying > 0.005 && plan.allocations.length > 0 && plan.leftover <= 0.005 && dateOk;

  function pickClient(id: string) { setClientId(id); setPicked([]); setLines([newSplitLine(methods)]); setChangeDate(false); setPayDate(localDate()); setNote(""); }
  function toggle(id: string) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    const sum = r2(open.filter((i) => next.includes(String(i._id))).reduce((n, i) => n + i.outstanding, 0));
    setLines([newSplitLine(methods, sum > 0 ? String(sum) : "")]); // ticking fills the amount; he may type a smaller one
  }

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    try {
      const res = await receive({
        clientId: clientId as Id<"clients">,
        splits: toSplits(lines, methods) as never,
        allocations: plan.allocations.map((a) => ({ invoiceId: a.id as Id<"invoices">, amount: a.amount })),
        paymentDate: changeDate ? payDate : undefined,
        notes: note.trim() || undefined,
      });
      toast.success(tr("Marejesho ya {0} kutoka kwa {1} yamepokelewa.", [money(res.total), res.clientName]));
      setPicked([]); setLines([newSplitLine(methods)]); setNote(""); setChangeDate(false); setPayDate(localDate());
    } catch (e) {
      toast.error(errorText(e, tr("Imeshindikana kupokea marejesho. Hakuna kilichorekodiwa; jaribu tena.")));
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <h2 className="text-lg font-semibold">{tr("Marejesho ya madeni (Repayments)")}</h2>
      <p className="text-sm text-muted-foreground">{tr("Chagua mteja, tiki madeni anayolipa (au andika kiasi), kisha chagua njia ya malipo. Fedha inaingia kwenye cash ya siku ya leo, na ripoti zinaonyesha ni marejesho ya mteja huyo.")}</p>
      <select className="h-10 w-full max-w-md rounded-md border bg-background px-3" value={clientId} disabled={busy} onChange={(e) => pickClient(e.target.value)}>
        <option value="">{tr("Chagua mteja")}</option>
        {(customers ?? []).map((c) => <option key={String(c._id)} value={String(c._id)}>{c.name}{c.owes > 0 ? ` · ${tr("anadaiwa")} ${money(c.owes)}` : ""}</option>)}
      </select>
      {clientId && data && open.length === 0 && <p className="text-sm text-muted-foreground">{tr("Mteja huyu hana deni kwa sasa.")}</p>}
      {clientId && data && open.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm">{tr("Jumla anayodaiwa")}: <strong>{money(data.owes)}</strong></p>
          <ul className="space-y-1">
            {open.map((i) => (
              <li key={String(i._id)}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
                  <input type="checkbox" className="h-5 w-5" checked={picked.includes(String(i._id))} disabled={busy} onChange={() => toggle(String(i._id))} />
                  <span className="flex-1 text-sm">{i.invoiceDate} · {i.invoiceNo}</span>
                  <strong className="tabular-nums">{money(i.outstanding)}</strong>
                </label>
              </li>
            ))}
          </ul>
          {ticked.length > 0 && <p className="text-sm">{tr("Madeni yaliyotiki")}: <strong>{money(tickedDue)}</strong></p>}
          <PaymentSplit methods={methods} lines={lines} onChange={setLines} due={ticked.length ? tickedDue : data.owes} disabled={busy} />
          {paying > 0.005 && plan.leftover > 0.005 && <p className="text-xs text-destructive">{tr("Kiasi kinazidi madeni yaliyochaguliwa kwa {0}.", [money(plan.leftover)])}</p>}
          {paying > 0.005 && plan.leftover <= 0.005 && <p className="text-xs text-muted-foreground">{ticked.length ? tr("Kiasi kitagawanywa kwenye madeni yaliyotiki, la zamani kwanza.") : tr("Hujatiki deni: kiasi kitalipa madeni ya zamani kwanza.")}</p>}
          <label className="grid max-w-md gap-1 text-sm">{tr("Maelezo (hiari)")}<Input value={note} maxLength={120} disabled={busy} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="h-4 w-4" checked={changeDate} disabled={busy} onChange={(e) => { setChangeDate(e.target.checked); setPayDate(localDate()); }} />{tr("Badilisha tarehe ya malipo (kawaida ni leo)")}</label>
            {changeDate && <Input type="date" className="max-w-xs" value={payDate} max={today} disabled={busy} onChange={(e) => setPayDate(e.target.value)} />}
            {changeDate && !dateOk && <p className="text-xs text-destructive">{tr("Tarehe ya malipo haiwezi kuwa ya baadaye.")}</p>}
          </div>
          <Button disabled={!canSave} onClick={() => void submit()}>{busy ? tr("Inahifadhi...") : tr("Pokea marejesho")}</Button>
        </div>
      )}
    </section>
  );
}
