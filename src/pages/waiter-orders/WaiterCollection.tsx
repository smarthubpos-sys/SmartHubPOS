import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { tr, errorText } from "@/lib/i18n.ts";
import { localDate } from "@/lib/format.ts";
import { usePaymentMethods } from "@/hooks/use-payment-methods.ts";
import PaymentSplit from "@/components/PaymentSplit.tsx";
import { newSplitLine, splitsTotal, toSplits, type SplitLine } from "@/lib/payment-split.ts";
import { brandingFromSettings } from "@/lib/receipt-branding.ts";
import { qzPrinterFrom } from "@/lib/print-waiter-order.ts";
import { printPaymentReceipt } from "@/lib/print-payment-receipt.ts";
import { PRINT_RECEIPT_KEY, readPrintReceiptChoice } from "@/lib/print-receipt-choice.ts";

const money = (n: number) => Number(n).toLocaleString();

/** Cashier: pick a waiter, tick the orders whose money was handed over, record how it was paid. Orders are marked settled, never deleted. */
export default function WaiterCollection() {
  const methods = usePaymentMethods();
  const owing = useQuery(api.waiterCollections.owing);
  const receipts = useQuery(api.waiterCollections.receipts, { date: localDate() });
  const collect = useMutation(api.waiterCollections.collect);
  const [staffId, setStaffId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [lines, setLines] = useState<SplitLine[]>(() => [newSplitLine(methods)]);
  const [busy, setBusy] = useState(false);
  const [printReceipt, setPrintReceipt] = useState<boolean>(readPrintReceiptChoice); // option: print a payment receipt after receiving
  const user = useQuery(api.users.getCurrentUser);
  const settings = useQuery(api.maintenance.getSettings, {});
  const branding = brandingFromSettings(settings as Parameters<typeof brandingFromSettings>[0]);
  const hw = (settings?.app?.hardware ?? {}) as { printerSource?: string; receiptPrinter?: string; paperWidth?: string };
  const cashierName = user?.name ?? user?.username ?? "";

  const waiter = (owing ?? []).find((w) => String(w.staffId) === staffId);
  const chosen = (waiter?.orders ?? []).filter((o) => picked.includes(String(o._id)));
  const due = Math.round(chosen.reduce((s, o) => s + o.total, 0) * 100) / 100;
  const paying = splitsTotal(lines);
  const debtLeft = Math.round((due - paying) * 100) / 100; // > 0: the waiter hands over less than the bill; the rest stays as his debt
  const canSave = !busy && chosen.length > 0 && paying > 0.005 && debtLeft > -0.005;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function pickWaiter(id: string) {
    setStaffId(id);
    const w = (owing ?? []).find((x) => String(x.staffId) === id);
    const all = (w?.orders ?? []).map((o) => String(o._id));
    setPicked(all);
    setLines([newSplitLine(methods, String(Math.round((w?.total ?? 0) * 100) / 100 || ""))]);
  }

  async function receive() {
    if (!waiter || !canSave) return;
    setBusy(true);
    try {
      const splits = toSplits(lines, methods);
      const res = await collect({ staffId: waiter.staffId as Id<"users">, orderIds: chosen.map((o) => o._id), splits: splits as never });
      toast.success(res.debt > 0 ? tr("Fedha zimepokelewa. Deni lililobaki kwa mhudumu: {0}", [money(res.debt)]) : tr("Fedha zimepokelewa na kuhifadhiwa."));
      const receipt = {
        receiptNo: String(res.collectionId).slice(-6).toUpperCase(),
        cashierName,
        fromName: waiter.staffName,
        orders: chosen.map((o) => ({ label: `${new Date(o.createdAt).toLocaleTimeString()}${o.tableNumber ? ` · ${o.tableNumber}` : ""}`, amount: o.total })),
        payments: splits.map((p) => ({ method: p.method, amount: p.amount })),
        total: res.total,
        debt: res.debt,
      };
      setPicked([]); setStaffId(""); setLines([newSplitLine(methods)]);
      if (printReceipt) {
        const ok = await printPaymentReceipt(receipt, qzPrinterFrom(hw), hw.paperWidth, branding);
        if (!ok) toast.message(tr("Fedha zimepokelewa. Risiti haikuchapishwa; unaweza kuichapa tena kutoka \"Zilizopokelewa leo\"."));
      }
    } catch (e) {
      toast.error(errorText(e, tr("Imeshindikana kupokea fedha. Hakuna kilichorekodiwa; jaribu tena.")));
    } finally { setBusy(false); }
  }

  // Reprint a receipt taken earlier today. Only prints what was already saved; money and stock are untouched.
  async function reprint(r: NonNullable<typeof receipts>[number]) {
    if (settings === undefined) { toast.message(tr("Mipangilio ya printer bado inapakia. Jaribu tena baada ya sekunde chache.")); return; }
    await printPaymentReceipt({ receiptNo: String(r._id).slice(-6).toUpperCase(), cashierName: r.cashierName || cashierName, fromName: r.staffName, payments: r.splits, total: r.total, debt: r.debt }, qzPrinterFrom(hw), hw.paperWidth, branding);
  }

  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <h2 className="text-lg font-semibold">{tr("Pokea fedha za wahudumu")}</h2>
      {owing && owing.length === 0 && <p className="text-sm text-muted-foreground">{tr("Hakuna mhudumu anayedaiwa kwa sasa.")}</p>}
      {owing && owing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {owing.map((w) => (
            <button key={String(w.staffId)} type="button" onClick={() => pickWaiter(String(w.staffId))}
              className={`rounded-lg border px-3 py-2 text-left text-sm ${staffId === String(w.staffId) ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
              <div className="font-semibold">{w.staffName}</div>
              <div className="text-xs text-muted-foreground">{w.orders.length} {tr("oda")} · {money(w.total)}</div>
            </button>
          ))}
        </div>
      )}
      {waiter && (
        <div className="space-y-3">
          <ul className="space-y-1">
            {waiter.orders.map((o) => (
              <li key={String(o._id)}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
                  <input type="checkbox" className="h-5 w-5" checked={picked.includes(String(o._id))} onChange={() => toggle(String(o._id))} />
                  <span className="flex-1 text-sm">{new Date(o.createdAt).toLocaleTimeString()}{o.tableNumber ? ` · ${o.tableNumber}` : ""} · {o.lines}{o.paid > 0 && <em className="ml-1 text-xs text-amber-600">({tr("imelipwa")} {money(o.paid)} {tr("kati ya")} {money(o.orderTotal)})</em>}</span>
                  <strong className="tabular-nums">{money(o.total)}</strong>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-base font-bold">{tr("Jumla ya kupokea")}: {money(due)}</p>
          <PaymentSplit methods={methods} lines={lines} onChange={setLines} due={due} disabled={busy} />
          <p className="text-xs text-muted-foreground">{tr("Unaweza kupokea kiasi kidogo kuliko jumla (kile alichonacho mhudumu mkononi). Kinachobaki kinabaki kama deni lake.")}</p>
          {debtLeft > 0.005 && paying > 0.005 && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm font-semibold">{tr("Deni litakalobaki kwa mhudumu")}: {money(debtLeft)}</p>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={printReceipt} onChange={(e) => { setPrintReceipt(e.target.checked); try { localStorage.setItem(PRINT_RECEIPT_KEY, e.target.checked ? "1" : "0"); } catch { /* remembering the choice is optional */ } }} />{tr("Chapisha risiti ya malipo")}</label>
          <Button disabled={!canSave} onClick={() => void receive()}>{busy ? tr("Inahifadhi...") : tr("Pokea fedha")}</Button>
        </div>
      )}
      {receipts && receipts.length > 0 && (
        <div className="space-y-1 border-t pt-3">
          <h3 className="text-sm font-semibold">{tr("Zilizopokelewa leo")}</h3>
          {receipts.map((r) => (
            <div key={String(r._id)} className="flex flex-wrap justify-between gap-2 text-sm">
              <span>{new Date(r.createdAt).toLocaleTimeString()} · {r.staffName} · {r.orders} {tr("oda")} · {r.methods}{r.debt > 0 && <b className="ml-1 text-amber-600">· {tr("Deni")}: {money(r.debt)}</b>}</span>
              <span className="flex items-center gap-2"><strong className="tabular-nums">{money(r.total)}</strong><Button type="button" size="sm" variant="outline" onClick={() => void reprint(r)}>{tr("Chapisha risiti")}</Button></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
