import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { localDate } from "@/lib/format.ts";
import BillSheet from "@/components/BillSheet.tsx";
import type { Paper } from "@/lib/print-area.ts";

const fmt = (n: number) => new Intl.NumberFormat("sw-TZ", { maximumFractionDigits: 2 }).format(n);
const STATUS_SW: Record<string, string> = { placed: "Imewekwa", pending: "Inasubiri", accepted: "Imepokelewa", printed: "Imechapishwa", cancelled: "Imefutwa" };

/** Cashier / manager view: find a waiter and read their sales, payments, customer debts and orders. Read-only. */
export default function WaiterDirectory() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Id<"users"> | null>(null);
  const [from, setFrom] = useState(localDate());
  const [to, setTo] = useState(localDate());
  const waiters = useQuery(api.waiterDirectory.list, { search });
  const valid = from <= to;
  const summary = useQuery(api.waiterDirectory.summary, selected && valid ? { waiterId: selected, from, to } : "skip");
  const [invSearch, setInvSearch] = useState("");
  const [invoiceId, setInvoiceId] = useState<Id<"invoices"> | null>(null);
  const invoices = useQuery(api.waiterDirectory.invoices, selected && valid ? { waiterId: selected, from, to, search: invSearch } : "skip");
  const payments = useQuery(api.waiterDirectory.invoicePayments, invoiceId ? { invoiceId } : "skip");
  const settings = useQuery(api.maintenance.getSettings, {});
  const width = (settings?.app?.hardware as { paperWidth?: string } | undefined)?.paperWidth;
  const paper: Paper = width === "a4" ? "A4" : width === "58mm" ? "58mm" : "80mm";
  const preset = (days: number) => { setFrom(localDate(-days)); setTo(localDate()); };

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">Wahudumu</h2>
      <Input placeholder="Tafuta mhudumu kwa jina au username" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        {(waiters ?? []).map((w) => (
          <button key={w._id} type="button" onClick={() => { setSelected(w._id); setInvoiceId(null); }} className={`rounded-lg border px-3 py-1 text-sm ${selected === w._id ? "bg-primary text-primary-foreground" : ""}`}>{w.name}</button>
        ))}
        {waiters && waiters.length === 0 && <p className="text-sm text-muted-foreground">Hakuna mhudumu aliyepatikana.</p>}
      </div>
      {selected && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" className="rounded border px-2 py-1" onClick={() => preset(0)}>Leo</button>
            <button type="button" className="rounded border px-2 py-1" onClick={() => preset(6)}>Siku 7</button>
            <button type="button" className="rounded border px-2 py-1" onClick={() => preset(29)}>Siku 30</button>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {!valid && <p className="text-sm text-destructive">Tarehe ya mwisho lazima isiwe kabla ya ya kuanza.</p>}
          {summary && (
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {([["Mauzo halisi", summary.netSales], ["Punguzo", summary.discounts], ["Kilicholipwa", summary.paid], ["Mauzo ya mkopo", summary.creditSales], ["Madeni ya wateja", summary.customerOutstanding]] as const).map(([k, v]) => (
                <div key={k} className="rounded-lg border p-2"><div className="text-muted-foreground">{k}</div><div className="font-bold">{fmt(v)}</div></div>
              ))}
              <div className="rounded-lg border p-2"><div className="text-muted-foreground">Invoice</div><div className="font-bold">{summary.invoices} (zilizofutwa: {summary.cancelledInvoices})</div></div>
              <div className="col-span-2 rounded-lg border p-2 sm:col-span-3"><div className="text-muted-foreground">Malipo kwa njia</div>
                <div>{Object.keys(summary.paymentsByMethod).length ? Object.entries(summary.paymentsByMethod).map(([m, a]) => `${m}: ${fmt(a)}`).join(" · ") : "—"}</div></div>
              <div className="col-span-2 rounded-lg border p-2 sm:col-span-3"><div className="text-muted-foreground">Oda</div>
                <div>{Object.keys(summary.orders).length ? Object.entries(summary.orders).map(([s, n]) => `${STATUS_SW[s] ?? s}: ${n}`).join(" · ") : "—"}</div></div>
            </div>
          )}
          <div className="space-y-2">
            <h3 className="font-semibold">Invoice na risiti</h3>
            <Input placeholder="Tafuta kwa namba ya invoice au mteja" value={invSearch} onChange={(e) => setInvSearch(e.target.value)} />
            {invoices && invoices.length === 0 && <p className="text-sm text-muted-foreground">Hakuna invoice kwenye kipindi hiki.</p>}
            {invoices && invoices.length > 0 && (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left">{["Invoice", "Tarehe", "Mteja", "Jumla", "Imelipwa", "Deni", "Hali"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
                <tbody>{invoices.map((i) => (
                  <tr key={i._id} className={`cursor-pointer border-b ${invoiceId === i._id ? "bg-primary/10" : "hover:bg-muted/50"}`} onClick={() => setInvoiceId(i._id)}>
                    <td className="p-2 font-medium">{i.invoiceNo}</td><td className="p-2">{i.date}</td><td className="p-2">{i.clientName}</td>
                    <td className="p-2 tabular-nums">{fmt(i.total)}</td><td className="p-2 tabular-nums">{fmt(i.amountPaid)}</td><td className="p-2 tabular-nums">{fmt(i.outstanding)}</td>
                    <td className="p-2">{i.status === "cancelled" ? "Imefutwa" : i.paymentStatus}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
            {invoiceId && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="text-sm"><span className="font-semibold">Historia ya malipo: </span>
                  {payments && payments.length ? payments.map((p) => `${p.date} ${p.method} ${fmt(p.amount)}`).join(" · ") : "Hakuna malipo yaliyorekodiwa."}</div>
                <p className="text-xs text-muted-foreground">Kuchapisha tena kunatumia data ya invoice asili; hakutengenezi mauzo, hakupunguzi stock wala hakurekodi malipo.</p>
                <BillSheet kind="invoice" key={invoiceId} invoiceIds={[invoiceId]} paper={paper} whatsappEnabled={false} setWhatsappEnabled={() => undefined} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
