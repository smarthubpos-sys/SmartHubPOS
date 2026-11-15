import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PaymentSplit from "@/components/PaymentSplit.tsx";
import { usePaymentMethods } from "@/hooks/use-payment-methods.ts";
import { errorText, tr } from "@/lib/i18n.ts";
import { localDate } from "@/lib/format.ts";
import { newSplitLine, splitsTotal, toSplits, type SplitLine } from "@/lib/payment-split.ts";
import { printElement } from "@/lib/print-area.ts";

type Mode = "summary" | "people" | "detail";
const money = (n: number) => Number(n).toLocaleString();
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Sales > Staff Sales Report: debts of waiters whose day was already closed (they left the cashier's screen when the day report was saved).
 * Pick the period (by the day the bills were sold), view it as a summary / per person / in detail and print what is shown.
 * The cashier can receive the money here: it is a REPAYMENT counted on the (still open) day chosen below.
 */
export default function WaiterDebtsCard() {
  const [from, setFrom] = useState(() => localDate(-30));
  const [to, setTo] = useState(() => localDate());
  const [mode, setMode] = useState<Mode>("people");
  const valid = isDate(from) && isDate(to) && to >= from;
  const data = useQuery(api.waiterDebts.closedReport, valid ? { from, to } : "skip");
  const collect = useMutation(api.waiterCollections.collect);
  const methods = usePaymentMethods();
  const printRef = useRef<HTMLDivElement>(null);

  const [staffId, setStaffId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [lines, setLines] = useState<SplitLine[]>(() => [newSplitLine(methods)]);
  const [payDate, setPayDate] = useState(() => localDate());
  const [busy, setBusy] = useState(false);

  const today = localDate();
  const waiter = (data?.waiters ?? []).find((w) => String(w.staffId) === staffId);
  const chosen = (waiter?.orders ?? []).filter((o) => picked.includes(String(o._id)));
  const due = Math.round(chosen.reduce((n, o) => n + o.total, 0) * 100) / 100;
  const paying = splitsTotal(lines);
  const debtLeft = Math.round((due - paying) * 100) / 100;
  const oldestSale = chosen.map((o) => o.saleDay).sort()[0] ?? today;
  const dateOk = isDate(payDate) && payDate <= today && payDate >= oldestSale;
  const canSave = !busy && chosen.length > 0 && paying > 0.005 && debtLeft > -0.005 && dateOk;

  const preset = (a: number, b = 0) => { setFrom(localDate(a)); setTo(localDate(b)); };
  const monthStart = () => `${today.slice(0, 8)}01`;
  const startCollect = (w: NonNullable<typeof data>["waiters"][number]) => {
    setStaffId(String(w.staffId)); setPicked(w.orders.map((o) => String(o._id)));
    setLines([newSplitLine(methods, String(w.total))]); setPayDate(localDate());
  };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  async function receive() {
    if (!waiter || !canSave) return;
    setBusy(true);
    try {
      const res = await collect({ staffId: waiter.staffId as Id<"users">, orderIds: chosen.map((o) => o._id), splits: toSplits(lines, methods) as never, paymentDate: payDate });
      toast.success(res.debt > 0 ? tr("Fedha zimepokelewa kama marejesho ya {0}. Deni lililobaki kwa mhudumu: {1}", [payDate, money(res.debt)]) : tr("Fedha zimepokelewa kama marejesho ya {0}.", [payDate]));
      setStaffId(""); setPicked([]); setLines([newSplitLine(methods)]); setPayDate(localDate());
    } catch (e) { toast.error(errorText(e, tr("Imeshindikana kupokea fedha. Hakuna kilichorekodiwa; jaribu tena."))); }
    finally { setBusy(false); }
  }

  const modeBtn = (m: Mode, label: string) => <Button key={m} type="button" size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>{label}</Button>;
  const period = from === to ? from : `${from} - ${to}`;

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4" aria-label={tr("Madeni ya wahudumu")}>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="mr-auto">
          <h3 className="text-base font-semibold">{tr("Madeni ya wahudumu (siku zilizofungwa)")}</h3>
          <p className="text-xs text-muted-foreground">{tr("Madeni yaliyoondolewa kwa cashier baada ya kufunga hesabu ya siku. Yanaonekana kwenye ripoti ya siku husika.")}</p>
        </div>
        <label className="grid gap-1 text-xs">{tr("Kuanzia")}<Input type="date" className="h-9" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="grid gap-1 text-xs">{tr("Hadi")}<Input type="date" className="h-9" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <Button type="button" size="sm" variant="outline" onClick={() => preset(0)}>{tr("Leo")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => preset(-1, -1)}>{tr("Jana")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => preset(-6)}>{tr("Siku 7")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => preset(-29)}>{tr("Siku 30")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => { setFrom(monthStart()); setTo(today); }}>{tr("Mwezi huu")}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {modeBtn("summary", tr("Muhtasari"))}{modeBtn("people", tr("Jumla ya kila mtu"))}{modeBtn("detail", tr("Maelezo kamili"))}
        <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={!data || data.waiters.length === 0} onClick={() => printElement(printRef.current, "A4")}><Printer className="mr-1 h-4 w-4" />{tr("Chapisha")}</Button>
      </div>
      {!valid && <p className="text-sm text-destructive print:hidden">{tr("Tarehe za ripoti si sahihi.")}</p>}
      {data?.truncated && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">{tr("Kipindi hiki kina data nyingi sana; baadhi ya rekodi hazijaonyeshwa. Chagua kipindi kifupi zaidi ili kupata jumla kamili.")}</p>}

      <div ref={printRef} className="space-y-3">
        <div>
          <div className="text-sm font-semibold">{tr("Madeni ya wahudumu")} — {mode === "summary" ? tr("Muhtasari") : mode === "people" ? tr("Jumla ya kila mtu") : tr("Maelezo kamili")}</div>
          <div className="text-xs text-muted-foreground">{tr("Bili zilizouzwa")}: {period}</div>
        </div>
        {data && data.waiters.length === 0 && <p className="text-sm text-muted-foreground">{tr("Hakuna deni la mhudumu lililofungwa kwenye kipindi hiki.")}</p>}
        {data && data.waiters.length > 0 && mode === "summary" && (
          <table className="w-full max-w-md text-sm"><tbody>
            <tr className="border-b"><td className="py-1.5">{tr("Wahudumu wanaodaiwa")}</td><td className="py-1.5 text-right tabular-nums">{data.waiters.length}</td></tr>
            <tr className="border-b"><td className="py-1.5">{tr("Bili zinazodaiwa")}</td><td className="py-1.5 text-right tabular-nums">{data.orderCount}</td></tr>
            <tr><td className="py-1.5 font-semibold">{tr("Jumla ya madeni")}</td><td className="py-1.5 text-right font-semibold tabular-nums">{money(data.total)}</td></tr>
          </tbody></table>
        )}
        {data && data.waiters.length > 0 && mode === "people" && (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-1.5">{tr("Mhudumu")}</th><th className="py-1.5 text-right">{tr("Bili")}</th><th className="py-1.5 text-right">{tr("Deni")}</th>{data.canCollect && <th className="w-24 print:hidden" />}</tr></thead>
            <tbody>
              {data.waiters.map((w) => (
                <tr key={String(w.staffId)} className="border-b">
                  <td className="py-1.5">{w.staffName}</td><td className="py-1.5 text-right tabular-nums">{w.orders.length}</td><td className="py-1.5 text-right tabular-nums">{money(w.total)}</td>
                  {data.canCollect && <td className="py-1.5 text-right print:hidden"><Button type="button" size="sm" variant="outline" onClick={() => startCollect(w)}>{tr("Lipisha")}</Button></td>}
                </tr>
              ))}
              <tr><td className="py-1.5 font-semibold">{tr("JUMLA")}</td><td className="py-1.5 text-right font-semibold tabular-nums">{data.orderCount}</td><td className="py-1.5 text-right font-semibold tabular-nums">{money(data.total)}</td>{data.canCollect && <td className="print:hidden" />}</tr>
            </tbody>
          </table>
        )}
        {data && data.waiters.length > 0 && mode === "detail" && (
          <div className="space-y-4">
            {data.waiters.map((w) => (
              <div key={String(w.staffId)} className="print:break-inside-avoid">
                <div className="flex items-center justify-between border-b py-1.5 text-sm font-semibold"><span>{w.staffName}</span><span className="flex items-center gap-2"><span className="tabular-nums">{money(w.total)}</span>{data.canCollect && <Button type="button" size="sm" variant="outline" className="print:hidden" onClick={() => startCollect(w)}>{tr("Lipisha")}</Button>}</span></div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="py-1">{tr("Siku")}</th><th className="py-1">{tr("Bidhaa")}</th><th className="py-1 text-right">{tr("Bili")}</th><th className="py-1 text-right">{tr("Imelipwa")}</th><th className="py-1 text-right">{tr("Deni")}</th></tr></thead>
                  <tbody>{w.orders.map((o) => (
                    <tr key={String(o._id)} className="border-t"><td className="py-1 whitespace-nowrap">{o.saleDay}{o.tableNumber ? ` · ${o.tableNumber}` : ""}</td><td className="py-1">{o.lines}</td><td className="py-1 text-right tabular-nums">{money(o.orderTotal)}</td><td className="py-1 text-right tabular-nums">{money(o.paid)}</td><td className="py-1 text-right tabular-nums">{money(o.total)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-sm font-semibold"><span>{tr("JUMLA")}</span><span className="tabular-nums">{money(data.total)}</span></div>
          </div>
        )}
      </div>

      {waiter && (
        <div className="space-y-3 rounded-lg border bg-background p-3 print:hidden">
          <div className="flex items-center justify-between"><div className="font-medium">{tr("Pokea fedha kutoka kwa")} {waiter.staffName}</div><Button type="button" size="sm" variant="ghost" onClick={() => { setStaffId(""); setPicked([]); }}>{tr("Funga")}</Button></div>
          <div className="max-h-48 overflow-auto rounded-md border">
            {waiter.orders.map((o) => (
              <label key={String(o._id)} className="flex items-center gap-2 border-b px-2 py-1.5 text-sm last:border-b-0">
                <input type="checkbox" checked={picked.includes(String(o._id))} onChange={() => toggle(String(o._id))} />
                <span className="whitespace-nowrap">{o.saleDay}</span><span className="flex-1 truncate text-muted-foreground">{o.lines}</span><span className="tabular-nums">{money(o.total)}</span>
              </label>
            ))}
          </div>
          <PaymentSplit methods={methods} lines={lines} onChange={setLines} due={due} disabled={busy} />
          <label className="grid max-w-xs gap-1 text-sm">{tr("Siku ya marejesho (hesabu zake hazijafungwa)")}
            <Input type="date" value={payDate} min={oldestSale} max={today} onChange={(e) => setPayDate(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">{tr("Fedha hizi zitahesabiwa kama marejesho (repayment) kwenye mauzo ya siku hiyo. Siku iliyofungwa kwenye ripoti haikubaliki.")}</p>
          {debtLeft > 0.005 && paying > 0.005 && <p className="text-sm">{tr("Deni litakalobaki kwa mhudumu")}: <b>{money(debtLeft)}</b></p>}
          <Button type="button" disabled={!canSave} onClick={() => void receive()}>{busy ? tr("Inahifadhi…") : tr("Pokea fedha")}</Button>
        </div>
      )}
    </section>
  );
}
