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
import { allocateSettlement } from "@/lib/settlement.ts";
import BillSheet from "@/components/BillSheet.tsx";

const fmt = (n: number) => new Intl.NumberFormat("sw-TZ", { maximumFractionDigits: 2 }).format(n);

/** Cashier: type a staff code -> that person's sales, invoices, bills, payments and balances; record split settlement on their invoices. */
export default function StaffSettlement() {
  const methods = usePaymentMethods();
  const settleInvoices = useMutation(api.sales.settleInvoices); // ONE transaction: all invoices paid, or none
  const [code, setCode] = useState("");
  const [from, setFrom] = useState(localDate());
  const [to, setTo] = useState(localDate());
  const [picked, setPicked] = useState<string[]>([]);
  const [lines, setLines] = useState<SplitLine[]>(() => [newSplitLine(methods)]);
  const [busy, setBusy] = useState(false);
  const [reprint, setReprint] = useState<Id<"invoices"> | null>(null);
  const data = useQuery(api.waiterDirectory.byStaffCode, code.trim() && from <= to ? { code, from, to } : "skip");

  const open = (data?.invoices ?? []).filter((i) => i.outstanding > 0).sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNo.localeCompare(b.invoiceNo));
  const chosen = open.filter((i) => picked.includes(String(i._id)));
  const due = chosen.reduce((s, i) => s + i.outstanding, 0);
  const paying = splitsTotal(lines);

  async function settle() {
    if (busy) return;
    setBusy(true);
    try {
      const plan = allocateSettlement(chosen.map((i) => ({ id: String(i._id), invoiceNo: i.invoiceNo, outstanding: i.outstanding })), toSplits(lines, methods) as never);
      await settleInvoices({ staffId: data!.staff._id, paymentDate: localDate(), allocations: plan.map((a) => ({ invoiceId: a.invoiceId as Id<"invoices">, splits: a.splits as never })) });
      toast.success(tr("Malipo yamehifadhiwa."));
      setPicked([]); setLines([newSplitLine(methods)]);
    } catch (e) { toast.error(errorText(e, tr("Imeshindikana kuhifadhi malipo. Hakuna malipo yaliyorekodiwa; angalia salio kisha jaribu tena."))); }
    finally { setBusy(false); }
  }

  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <h2 className="text-lg font-semibold">{tr("Mauzo ya mhudumu (Staff code)")}</h2>
      <div className="flex flex-wrap gap-2">
        <Input className="w-48" placeholder={tr("Staff code")} value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setPicked([]); }} />
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {from > to && <p className="text-sm text-destructive">{tr("Tarehe ya mwisho lazima isiwe kabla ya ya kuanza.")}</p>}
      {code.trim() && data === null && <p className="text-sm text-muted-foreground">{tr("Hakuna mhudumu mwenye code hiyo.")}</p>}
      {data && (<div className="space-y-3">
        <p className="text-base font-bold">{data.staff.name} <span className="text-sm font-normal text-muted-foreground">({data.staff.staffCode})</span></p>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {([["Mauzo", data.totals.sales], ["Zimelipwa", data.totals.paid], ["Salio lililobaki", data.totals.outstanding], ["Invoice", data.totals.invoices], ["Bills/oda", data.bills.count], ["Jumla ya bills", data.bills.total]] as const).map(([k, v]) => (
            <div key={k} className="rounded-lg border p-2"><div className="text-muted-foreground">{tr(k)}</div><div className="font-bold">{fmt(v)}</div></div>))}
        </div>
        <div className="rounded-lg border p-2 text-sm"><span className="text-muted-foreground">{tr("Malipo kwa njia")}: </span>{Object.keys(data.paymentsByMethod).length ? Object.entries(data.paymentsByMethod).map(([m, a]) => `${m}: ${fmt(a)}`).join(" · ") : "—"}</div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="p-2" />{["Invoice", "Tarehe", "Mteja", "Jumla", "Imelipwa", "Deni", ""].map((h, i) => <th key={i} className="p-2">{tr(h)}</th>)}</tr></thead>
          <tbody>{data.invoices.map((i) => (
            <tr key={i._id} className="border-b">
              <td className="p-2">{i.outstanding > 0 && <input type="checkbox" className="h-5 w-5" aria-label={i.invoiceNo} checked={picked.includes(String(i._id))} onChange={() => setPicked((p) => p.includes(String(i._id)) ? p.filter((x) => x !== String(i._id)) : [...p, String(i._id)])} />}</td>
              <td className="p-2 font-medium">{i.invoiceNo}</td><td className="p-2">{i.date}</td><td className="p-2">{i.clientName}</td>
              <td className="p-2 tabular-nums">{fmt(i.total)}</td><td className="p-2 tabular-nums">{fmt(i.amountPaid)}</td><td className="p-2 tabular-nums">{fmt(i.outstanding)}</td>
              <td className="p-2"><button type="button" className="text-xs underline" onClick={() => setReprint(i._id)}>{tr("Chapisha tena")}</button></td>
            </tr>))}</tbody></table></div>
        {reprint && <div className="rounded-lg border p-3"><p className="mb-2 text-xs text-muted-foreground">{tr("Kuchapisha tena hakutengenezi mauzo, malipo wala kupunguza stock.")}</p>
          <BillSheet kind="invoice" key={reprint} invoiceIds={[reprint]} printToken={0} paper="80mm" whatsappEnabled={false} setWhatsappEnabled={() => undefined} /></div>}
        {open.length > 0 && <div className="space-y-2 rounded-xl border p-3">
          <h3 className="font-semibold">{tr("Weka malipo (settlement)")}</h3>
          <p className="text-sm">{tr("Deni la zilizochaguliwa")}: <strong>{fmt(due)}</strong> · {tr("Unalipa")}: <strong>{fmt(paying)}</strong> · {tr("Litakalobaki")}: <strong>{fmt(Math.max(0, due - paying))}</strong></p>
          <PaymentSplit methods={methods} lines={lines} onChange={setLines} due={due} disabled={busy} />
          <Button disabled={busy || !chosen.length || paying <= 0 || paying > due + 1e-8} onClick={() => void settle()}>{busy ? tr("Inahifadhi...") : tr("Hifadhi malipo")}</Button>
        </div>}
      </div>)}
    </section>
  );
}
