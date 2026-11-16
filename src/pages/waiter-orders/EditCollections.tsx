import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tr, errorText } from "@/lib/i18n.ts";
import { localDate } from "@/lib/format.ts";
import { usePaymentMethods, type PayMethod } from "@/hooks/use-payment-methods.ts";
import PaymentSplit from "@/components/PaymentSplit.tsx";
import { splitsTotal, toSplits, type SplitLine } from "@/lib/payment-split.ts";
import { orderStamp } from "@/lib/order-stamp.ts";

const money = (n: number) => Number(n).toLocaleString();
type StoredSplit = { method: string; methodId?: string; amount: number; reference?: string };

/** Saved payment lines -> form lines (a method that is no longer in the list falls back to the one with the same name, then the first). */
function toLines(splits: StoredSplit[], methods: PayMethod[]): SplitLine[] {
  return splits.map((s) => {
    const byId = s.methodId ? methods.find((m) => m.key === String(s.methodId)) : undefined;
    const byName = methods.find((m) => m.name.toLowerCase() === s.method.toLowerCase());
    return { methodKey: (byId ?? byName ?? methods[0])?.key ?? s.method, amount: String(s.amount), reference: s.reference ?? "" };
  });
}

/** Receipts of waiter money: fix the payment methods (the amount received stays the same). */
function ReceiptsEditor({ methods }: { methods: PayMethod[] }) {
  const [date, setDate] = useState(() => localDate());
  const receipts = useQuery(api.waiterCollections.receipts, { date });
  const save = useMutation(api.waiterCollections.editReceipt);
  const [editId, setEditId] = useState("");
  const [lines, setLines] = useState<SplitLine[]>([]);
  const [busy, setBusy] = useState(false);
  const today = localDate();
  const submit = async (id: string, total: number) => {
    if (Math.abs(splitsTotal(lines) - total) > 0.005) return toast.error(tr("Jumla ya njia za malipo lazima iwe {0}.", [money(total)]));
    setBusy(true);
    try {
      await save({ collectionId: id as Id<"waiterCollections">, splits: toSplits(lines, methods) as never });
      toast.success(tr("Malipo yamebadilishwa. Ripoti na akaunti za fedha zimerekebishwa."));
      setEditId("");
    } catch (e) { toast.error(errorText(e, tr("Imeshindikana kubadilisha malipo. Hakuna kilichobadilishwa."))); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{tr("Badilisha njia ya malipo (Cash, Tigo Pesa, Benki...) ya fedha ulizopokea kutoka kwa wahudumu. Kiasi kilichopokelewa hakibadiliki.")}</p>
        <Input type="date" className="h-9 w-40" value={date} max={today} aria-label={tr("Tarehe")} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
      {receipts && receipts.length === 0 && <p className="text-sm text-muted-foreground">{tr("Hakuna fedha zilizopokelewa siku hii.")}</p>}
      {(receipts ?? []).map((r) => (
        <div key={String(r._id)} className="space-y-2 rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{orderStamp(r.createdAt)} · {r.staffName} · {r.orders} {tr("oda")} · {r.methods}</span>
            <span className="flex items-center gap-2"><strong className="tabular-nums">{money(r.total)}</strong>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (editId === String(r._id)) setEditId(""); else { setEditId(String(r._id)); setLines(toLines(r.splits, methods)); } }}>{tr("Hariri")}</Button>
            </span>
          </div>
          {editId === String(r._id) && (
            <div className="space-y-2">
              <PaymentSplit methods={methods} lines={lines} onChange={setLines} due={r.total} disabled={busy} />
              <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit(String(r._id), r.total)}>{busy ? tr("Inahifadhi...") : tr("Hifadhi mabadiliko")}</Button><Button variant="outline" disabled={busy} onClick={() => setEditId("")}>{tr("Ghairi")}</Button></div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Customer payments: fix methods, amount or day. */
function CustomerPaymentsEditor({ methods }: { methods: PayMethod[] }) {
  const rows = useQuery(api.customerDebt.recentCustomerPayments);
  const save = useMutation(api.customerDebt.editCustomerPayment);
  const [editKey, setEditKey] = useState("");
  const [lines, setLines] = useState<SplitLine[]>([]);
  const [payDate, setPayDate] = useState("");
  const [busy, setBusy] = useState(false);
  const today = localDate();
  const submit = async (r: NonNullable<typeof rows>[number]) => {
    if (!r.receiptNo) return;
    setBusy(true);
    try {
      const res = await save({ invoiceId: r.invoiceId, receiptNo: r.receiptNo, splits: toSplits(lines, methods) as never, paymentDate: payDate || undefined });
      toast.success(tr("Malipo ya {0} yamebadilishwa. Deni lililobaki: {1}.", [res.invoiceNo, money(res.outstanding)]));
      setEditKey("");
    } catch (e) { toast.error(errorText(e, tr("Imeshindikana kubadilisha malipo. Hakuna kilichobadilishwa."))); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{tr("Malipo ya wateja ya karibuni. Unaweza kubadilisha njia za malipo, kiasi na tarehe; deni la mteja litarekebishwa lenyewe.")}</p>
      {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">{tr("Hakuna malipo ya wateja ya karibuni.")}</p>}
      {(rows ?? []).map((r) => {
        const key = `${r.invoiceId}|${r.receiptNo ?? ""}|${r.date}`;
        return (
          <div key={key} className="space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{r.date} · {r.clientName} · {r.invoiceNo} · {r.splits.map((s) => `${s.method} ${money(s.amount)}`).join(" + ")} · {tr("Deni lililobaki")}: {money(r.outstanding)}</span>
              <span className="flex items-center gap-2"><strong className="tabular-nums">{money(r.total)}</strong>
                {r.editable ? <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (editKey === key) setEditKey(""); else { setEditKey(key); setLines(toLines(r.splits, methods)); setPayDate(r.date); } }}>{tr("Hariri")}</Button> : <span className="text-xs text-muted-foreground">{tr("Malipo ya zamani, hayahaririwi")}</span>}
              </span>
            </div>
            {editKey === key && (
              <div className="space-y-2">
                <PaymentSplit methods={methods} lines={lines} onChange={setLines} due={Math.round((r.outstanding + r.total) * 100) / 100} disabled={busy} />
                <label className="flex items-center gap-2 text-xs">{tr("Tarehe ya malipo")}<Input type="date" className="h-9 w-40" value={payDate} max={today} disabled={busy} onChange={(e) => setPayDate(e.target.value)} /></label>
                <div className="flex gap-2"><Button disabled={busy || splitsTotal(lines) <= 0} onClick={() => void submit(r)}>{busy ? tr("Inahifadhi...") : tr("Hifadhi mabadiliko")}</Button><Button variant="outline" disabled={busy} onClick={() => setEditKey("")}>{tr("Ghairi")}</Button></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Debts directed to customers: move one to the right customer. */
function DebtsEditor() {
  const debts = useQuery(api.customerDebt.assignedDebts);
  const customers = useQuery(api.customerDebt.customersForCashier);
  const move = useMutation(api.customerDebt.reassignDebt);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (invoiceId: Id<"invoices">, clientId: string, name: string) => {
    if (!clientId) return;
    if (!window.confirm(tr("Hamishia deni hili kwa mteja {0}?", [name]))) return;
    setBusy(true);
    try {
      const res = await move({ invoiceId, clientId: clientId as Id<"clients"> });
      toast.success(tr("Deni {0} sasa ni la {1}.", [res.invoiceNo, res.clientName]));
      setPick((p) => ({ ...p, [String(invoiceId)]: "" }));
    } catch (e) { toast.error(errorText(e, tr("Imeshindikana kubadilisha mteja. Hakuna kilichobadilishwa."))); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{tr("Madeni yaliyoelekezwa kwa wateja. Ukimchagua mteja kimakosa, mhamishie mteja sahihi hapa; kiasi na malipo yanabaki yale yale.")}</p>
      {debts && debts.length === 0 && <p className="text-sm text-muted-foreground">{tr("Hakuna madeni yaliyoelekezwa kwa wateja.")}</p>}
      {(debts ?? []).map((d) => {
        const chosen = pick[String(d._id)] ?? "";
        const name = (customers ?? []).find((c) => String(c._id) === chosen)?.name ?? "";
        return (
          <div key={String(d._id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span>{d.invoiceDate} · <b>{d.clientName}</b> · {d.invoiceNo} · {tr("Jumla")}: {money(d.total)} · {tr("Deni lililobaki")}: {money(d.outstanding)}</span>
            <span className="flex flex-wrap items-center gap-2">
              <select className="h-9 min-w-48 rounded-md border bg-background px-2" value={chosen} disabled={busy} onChange={(e) => setPick((p) => ({ ...p, [String(d._id)]: e.target.value }))}>
                <option value="">{tr("Chagua mteja sahihi")}</option>
                {(customers ?? []).filter((c) => String(c._id) !== String(d.clientId)).map((c) => <option key={String(c._id)} value={String(c._id)}>{c.name}</option>)}
              </select>
              <Button size="sm" variant="outline" disabled={busy || !chosen} onClick={() => void submit(d._id, chosen, name)}>{tr("Hamisha")}</Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Cashier: correct what was received or where a debt was directed. Nothing is erased; every change is kept in the audit log. */
export default function EditCollections() {
  const methods = usePaymentMethods();
  const [tab, setTab] = useState<"receipts" | "customers" | "debts">("receipts");
  const tabs: Array<[typeof tab, string]> = [["receipts", tr("Fedha za wahudumu")], ["customers", tr("Malipo ya wateja")], ["debts", tr("Madeni ya wateja")]];
  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <h2 className="text-lg font-semibold">{tr("Hariri malipo na madeni")}</h2>
      <div className="flex flex-wrap gap-2">{tabs.map(([k, label]) => <Button key={k} size="sm" variant={tab === k ? "default" : "outline"} onClick={() => setTab(k)}>{label}</Button>)}</div>
      {tab === "receipts" && <ReceiptsEditor methods={methods} />}
      {tab === "customers" && <CustomerPaymentsEditor methods={methods} />}
      {tab === "debts" && <DebtsEditor />}
    </section>
  );
}
