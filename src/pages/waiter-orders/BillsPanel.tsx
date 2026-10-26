import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tr, errorText } from "@/lib/i18n.ts";
import { brandingFromSettings } from "@/lib/receipt-branding.ts";
import { printWaiterOrder, qzPrinterFrom } from "@/lib/print-waiter-order.ts";

const money = (n: number) => Number(n).toLocaleString();
const STATUS: Record<string, string> = { pending: "Inasubiri cashier", accepted: "Imepokelewa", printed: "Imechapishwa" };
const isWaiterRole = (role?: string) => ["waiter", "waitress"].includes(String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"));

/**
 * Bills: orders grouped by table (orders without a table go under "Bila meza"); tick one or many, the total is recomputed on the server; print never touches stock or payments.
 * Everyone sees only HIS OWN bills. A waiter first GENERATES the bill ("Unda bili"); only then can he print it or send it to the cashier.
 * The cashier sees the waiter's bill on his screen only after the waiter sent it.
 */
export default function BillsPanel() {
  const [search, setSearch] = useState("");
  const [picked, setPickedRaw] = useState<string[]>([]);
  const [generated, setGenerated] = useState(false); // waiter: the bill was created from the ticked orders
  const orders = useQuery(api.waiterOrders.listForBills, { table: search });
  const summary = useQuery(api.waiterOrders.billSummary, picked.length ? { orderIds: picked as Id<"waiterOrders">[] } : "skip");
  const markBillPrinted = useMutation(api.waiterOrders.markBillPrinted);
  const sendBillToCashier = useMutation(api.waiterOrders.sendBillToCashier);
  const [sending, setSending] = useState(false);
  const user = useQuery(api.users.getCurrentUser);
  const settings = useQuery(api.maintenance.getSettings, {});
  const branding = brandingFromSettings(settings as Parameters<typeof brandingFromSettings>[0]);
  const hw = (settings?.app?.hardware ?? {}) as { printerSource?: string; receiptPrinter?: string; paperWidth?: string };

  const groups = new Map<string, NonNullable<typeof orders>>();
  for (const o of orders ?? []) { const k = o.tableNumber?.trim() || ""; groups.set(k, [...(groups.get(k) ?? []), o]); }
  const waiter = isWaiterRole(user?.role);
  // Changing the ticked orders invalidates a generated bill: it must be generated again from the new selection.
  const setPicked = (next: string[] | ((p: string[]) => string[])) => { setGenerated(false); setPickedRaw(next); };
  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const mine = (o: { waiterId: unknown }) => !!user && String(o.waiterId) === String(user._id);
  const chosenOrders = (orders ?? []).filter((o) => picked.includes(String(o._id)));
  const billWaiterName = waiter || chosenOrders.length === 0 ? (user?.name ?? user?.username ?? "") : [...new Set(chosenOrders.map((o) => o.waiterName))].join(", ");
  const canAct = waiter ? generated : true; // a waiter may print / send only after generating the bill

  async function printBill() {
    if (!summary) return;
    if (settings === undefined) { toast.message(tr("Mipangilio ya printer bado inapakia. Jaribu tena baada ya sekunde chache.")); return; }
    const ok = await printWaiterOrder({ customerName: "", waiterName: billWaiterName, tableNumber: summary.tables.join(", ") || undefined, total: summary.total, lines: summary.lines.map((l) => ({ productName: l.productName, qty: l.qty, lineTotal: l.lineTotal })) }, qzPrinterFrom(hw), hw.paperWidth, { ...branding, title: tr("BILI YA MTEJA") });
    if (!ok) return; // print failed: the bills stay in the list so they can be printed again
    try {
      await markBillPrinted({ orderIds: picked as Id<"waiterOrders">[] });
      setPicked([]);
      toast.success(tr("Bili imechapishwa. Hakuna mauzo, malipo wala stock vilivyobadilika."));
    } catch (error) {
      toast.error(errorText(error, tr("Bili imechapishwa, lakini hali yake haikuhifadhiwa. Jaribu kusasisha ukurasa.")));
    }
  }

  async function sendBill() {
    if (!summary || !generated || sending) return;
    setSending(true);
    try {
      await sendBillToCashier({ orderIds: picked as Id<"waiterOrders">[] });
      setPickedRaw([]); setGenerated(false);
      toast.success(tr("Bili imetumwa kwa cashier."));
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kutuma bili kwa cashier.")));
    } finally { setSending(false); }
  }

  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <h2 className="text-lg font-semibold">{tr("Bills")}</h2>
      <Input placeholder={tr("Tafuta kwa namba ya meza au jina")} value={search} onChange={(e) => setSearch(e.target.value)} />
      {[...groups.entries()].map(([table, rows]) => (
        <div key={table || "none"} className="space-y-1 rounded-xl border p-2">
          <div className="flex items-center justify-between text-sm font-semibold"><span>{table ? `${tr("Meza")} ${table}` : tr("Bila meza")}</span>
            <button type="button" className="text-xs underline" onClick={() => setPicked((p) => [...new Set([...p, ...rows.map((r) => String(r._id))])])}>{tr("Chagua zote")}</button></div>
          {rows.map((o) => (
            <label key={o._id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
              <input type="checkbox" className="h-5 w-5" checked={picked.includes(String(o._id))} onChange={() => toggle(String(o._id))} />
              <span className="flex-1 text-sm">{new Date(o.createdAt).toLocaleTimeString()} · {o.lines.map((l) => `${l.productName}×${l.qty}`).join(", ")}<span className="block text-xs text-muted-foreground">{tr(STATUS[o.status] ?? o.status)}{!mine(o) && <> · {tr("Mhudumu")}: {o.waiterName} · {tr("Imetumwa kwa cashier")}</>}{mine(o) && waiter && o.billSentAt && <> · {tr("Imetumwa kwa cashier")}</>}</span></span>
              <strong className="tabular-nums">{money(o.total)}</strong>
            </label>
          ))}
        </div>
      ))}
      {orders && orders.length === 0 && <p className="text-sm text-muted-foreground">{tr("Hakuna bili bado.")}</p>}
      {waiter && picked.length > 0 && !generated && <p className="text-xs text-muted-foreground">{tr("Bonyeza \"Unda bili\" kwanza; baada ya hapo unaweza kuchapa au kutuma kwa cashier.")}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-lg font-bold">{tr("Jumla ya zilizochaguliwa")} ({picked.length}): {money(summary?.total ?? 0)}</span>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!picked.length} onClick={() => setPicked([])}>{tr("Futa uchaguzi")}</Button>
          {waiter && <Button variant="secondary" disabled={!picked.length || !summary || generated} onClick={() => setGenerated(true)}>{generated ? tr("Bili imeundwa") : tr("Unda bili")}</Button>}
          {waiter && <Button variant="outline" disabled={!canAct || !summary || sending} onClick={() => void sendBill()}>{sending ? tr("Inatuma...") : tr("Tuma kwa cashier")}</Button>}
          <Button disabled={!picked.length || !summary || !canAct} onClick={() => void printBill()}>{tr("Chapisha bili")}</Button></div>
      </div>
    </section>
  );
}
