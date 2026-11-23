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
import { orderStamp } from "@/lib/order-stamp.ts";

const money = (n: number) => Number(n).toLocaleString();
const STATUS: Record<string, string> = { pending: tr("Inasubiri cashier"), accepted: tr("Imepokelewa"), printed: tr("Imechapishwa") };
const isWaiterRole = (role?: string) => ["waiter", "waitress"].includes(String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"));

/**
 * Clean-up of old bills that were never printed or sent and now only pile up. Only a person holding "bills.clear_old" sees it.
 * It removes the bills from this list only: the order, stock and the waiter's money are not touched. Bills of the last 2 days cannot be picked.
 */
function OldBillsCleaner() {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(14);
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const all = useQuery(api.waiterOrders.listForBills, open ? {} : "skip");
  const clearOldBills = useMutation(api.waiterOrders.clearOldBills);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const old = (all ?? []).filter((o) => o.createdAt < cutoff);
  const chosen = old.filter((o) => ticked.includes(String(o._id)));
  const sum = chosen.reduce((n, o) => n + o.total, 0);

  async function remove() {
    if (!chosen.length || busy) return;
    if (!window.confirm(tr("Ondoa bili") + ` ${chosen.length} ` + tr("kwenye orodha ya Bills? Oda, stock na pesa havitaguswa."))) return;
    setBusy(true);
    try {
      const r = await clearOldBills({ orderIds: chosen.map((o) => o._id) });
      setTicked([]);
      toast.success(`${tr("Bili zilizoondolewa")}: ${r.removed}`);
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kuondoa bili.")));
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><p className="font-semibold">{tr("Safisha bili za zamani")}</p><p className="break-words text-xs text-muted-foreground">{tr("Ondoa bili za zamani zisizotumika zinazolundikana. Oda, stock na pesa havibadiliki.")}</p></div>
        <Button size="sm" variant="outline" onClick={() => { setOpen((v) => !v); setTicked([]); }}>{open ? tr("Funga") : tr("Ingia")}</Button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <label className="flex flex-wrap items-center gap-2 text-sm">{tr("Bili za zaidi ya siku")}
            <select className="h-9 rounded-lg border border-input bg-background px-2 text-sm" value={days} onChange={(e) => { setDays(Number(e.target.value)); setTicked([]); }}>
              {[3, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          {all === undefined ? <p className="text-sm text-muted-foreground">{tr("Inapakia…")}</p>
            : old.length === 0 ? <p className="text-sm text-muted-foreground">{tr("Hakuna bili za zamani kwa kipindi hiki.")}</p>
            : (
              <>
                <div className="flex items-center justify-between text-sm font-semibold"><span>{old.length} {tr("bili za zamani")}</span>
                  <button type="button" className="text-xs underline" onClick={() => setTicked(ticked.length === old.length ? [] : old.map((o) => String(o._id)))}>{ticked.length === old.length ? tr("Futa uchaguzi") : tr("Chagua zote")}</button></div>
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {old.map((o) => (
                    <label key={o._id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-background px-2 py-1">
                      <input type="checkbox" className="h-5 w-5 shrink-0" checked={ticked.includes(String(o._id))} onChange={() => setTicked((t) => t.includes(String(o._id)) ? t.filter((x) => x !== String(o._id)) : [...t, String(o._id)])} />
                      <span className="min-w-0 flex-1 break-words text-sm">{o.tableNumber ? `${tr("Meza")} ${o.tableNumber} · ` : ""}{o.lines.map((l) => `${l.productName}×${l.qty}`).join(", ")}<span className="block text-xs text-muted-foreground">{orderStamp(o.createdAt)} · {o.waiterName}</span></span>
                      <strong className="shrink-0 tabular-nums">{money(o.total)}</strong>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                  <span className="text-sm font-bold">{tr("Zilizochaguliwa")} ({chosen.length}): {money(sum)}</span>
                  <Button variant="destructive" disabled={!chosen.length || busy} onClick={() => void remove()}>{busy ? tr("Inaondoa...") : tr("Ondoa zilizochaguliwa")}</Button>
                </div>
              </>
            )}
        </div>
      )}
    </div>
  );
}

/**
 * Bills: orders grouped by table (orders without a table go under "Bila meza"); tick one or many, the total is recomputed on the server; print never touches stock or payments.
 * Active queue only: after sending, the bill leaves the waiter's list; after cashier printing, it leaves the cashier's list. History remains searchable in Invoice Finder.
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
  const resendBill = useMutation(api.waiterOrders.resendBill);
  const [showPrinted, setShowPrinted] = useState(false); // the "Bili zilizochapishwa leo" card is closed until the waiter opens it
  const [resending, setResending] = useState<string | null>(null);
  const user = useQuery(api.users.getCurrentUser);
  const myPermissions = useQuery(api.maintenance.myPermissions, {});
  const canClearOld = !!myPermissions?.includes("bills.clear_old");
  const settings = useQuery(api.maintenance.getSettings, {});
  const branding = brandingFromSettings(settings as Parameters<typeof brandingFromSettings>[0]);
  const hw = (settings?.app?.hardware ?? {}) as { printerSource?: string; receiptPrinter?: string; paperWidth?: string };

  const groups = new Map<string, NonNullable<typeof orders>>();
  for (const o of orders ?? []) { const k = o.tableNumber?.trim() || ""; groups.set(k, [...(groups.get(k) ?? []), o]); }
  const waiter = isWaiterRole(user?.role);
  const printedToday = useQuery(api.waiterOrders.printedBillsToday, waiter ? {} : "skip"); // today's already printed bills of this waiter (not in the open list)
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

  async function resend(id: string) {
    if (resending) return;
    setResending(id);
    try {
      await resendBill({ orderIds: [id as Id<"waiterOrders">] });
      toast.success(tr("Bili imetumwa tena kwa cashier. Ataiona na kuichapisha."));
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kutuma tena bili.")));
    } finally { setResending(null); }
  }

  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <h2 className="text-lg font-semibold">{tr("Bills")}</h2>
      {waiter && (
        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div><p className="font-semibold">{tr("Bili zilizochapishwa leo")} ({printedToday?.length ?? 0})</p><p className="text-xs text-muted-foreground">{tr("Ingia kutuma tena bili iliyochapishwa kwa cashier ili aichapishe tena.")}</p></div>
            <Button size="sm" variant="outline" onClick={() => setShowPrinted((v) => !v)}>{showPrinted ? tr("Funga") : tr("Ingia")}</Button>
          </div>
          {showPrinted && (
            <div className="mt-3 space-y-1">
              {printedToday === undefined ? <p className="text-sm text-muted-foreground">{tr("Inapakia…")}</p>
                : printedToday.length === 0 ? <p className="text-sm text-muted-foreground">{tr("Hakuna bili iliyochapishwa leo.")}</p>
                : printedToday.map((b) => (
                  <div key={b._id} className="flex min-h-11 items-center gap-3 rounded-lg border bg-background px-2 py-1">
                    <span className="flex-1 text-sm">{b.tableNumber ? `${tr("Meza")} ${b.tableNumber} · ` : ""}{b.lines.map((l) => `${l.productName}×${l.qty}`).join(", ")}<span className="block text-xs text-muted-foreground">{tr("Imechapishwa")} {orderStamp(b.billPrintedAt)}{b.resendPending && <> · {tr("Imetumwa tena kwa cashier")}</>}</span></span>
                    <strong className="tabular-nums">{money(b.total)}</strong>
                    <Button size="sm" variant="outline" disabled={b.resendPending || resending !== null} onClick={() => void resend(String(b._id))}>{resending === String(b._id) ? tr("Inatuma...") : b.resendPending ? tr("Imetumwa") : tr("Tuma tena")}</Button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
      {canClearOld && <OldBillsCleaner />}
      <Input placeholder={tr("Tafuta kwa namba ya meza au jina")} value={search} onChange={(e) => setSearch(e.target.value)} />
      {[...groups.entries()].map(([table, rows]) => (
        <div key={table || "none"} className="space-y-1 rounded-xl border p-2">
          <div className="flex items-center justify-between text-sm font-semibold"><span>{table ? `${tr("Meza")} ${table}` : tr("Bila meza")}</span>
            <button type="button" className="text-xs underline" onClick={() => setPicked((p) => [...new Set([...p, ...rows.map((r) => String(r._id))])])}>{tr("Chagua zote")}</button></div>
          {rows.map((o) => (
            <label key={o._id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
              <input type="checkbox" className="h-5 w-5" checked={picked.includes(String(o._id))} onChange={() => toggle(String(o._id))} />
              <span className="flex-1 text-sm">{orderStamp(o.createdAt)} · {o.lines.map((l) => `${l.productName}×${l.qty}`).join(", ")}<span className="block text-xs text-muted-foreground">{tr(STATUS[o.status] ?? o.status)}{o.billResentAt && (!o.billReprintedAt || o.billReprintedAt < o.billResentAt) && <> · {tr("Imetumwa tena kwa cashier")}</>}{!mine(o) && <> · {tr("Mhudumu")}: {o.waiterName} · {tr("Imetumwa kwa cashier")}</>}{mine(o) && waiter && o.billSentAt && <> · {tr("Imetumwa kwa cashier")}</>}</span></span>
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
