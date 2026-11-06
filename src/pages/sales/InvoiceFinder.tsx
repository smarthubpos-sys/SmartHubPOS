import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { Printer, Search, Pencil, Trash2, Save, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmt, num, round2 } from "@/pages/shared/report-utils.ts";
import { errorText, tr } from "@/lib/i18n.ts";
import { methodArgs, pickMethodKey, usePaymentMethods } from "@/hooks/use-payment-methods.ts";
import { printElement, readPaper } from "@/lib/print-area.ts";
import { CANCEL_REASONS, editedTotals } from "./invoice-finder-helpers.ts";
import { printWaiterOrder, qzPrinterFrom } from "@/lib/print-waiter-order.ts";
import { brandingFromSettings } from "@/lib/receipt-branding.ts";
import { useAuth } from "@/hooks/use-auth";

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const selectClass = "h-10 rounded-md border bg-background px-3";
type EditLine = { productId: string; name: string; qty: string; price: string; discount: string };
type Full = NonNullable<FunctionReturnType<typeof api.sales.invoiceFull>>;

/** Prints the invoice (or its corrected bill) in the paper size chosen for this device. */
function printInvoice(d: Full) {
  const cur = d.company.currencySymbol ? `${d.company.currencySymbol} ` : "";
  const m = (n: number) => `${cur}${fmt(n)}`;
  const inv = d.invoice;
  const rows = d.lines.map((l) => `<tr><td style="padding:2px 0">${esc(l.productName)}</td><td style="text-align:right">${esc(fmt(l.qty, 4))}</td><td style="text-align:right">${esc(fmt(l.unitPrice))}</td><td style="text-align:right">${esc(fmt(l.lineTotal))}</td></tr>`).join("");
  const el = document.createElement("div");
  el.className = "print-area";
  el.innerHTML = `<section style="font-size:12px;padding:6px 0">
    <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:6px">
      <div style="font-size:15px;font-weight:700">${esc(d.company.name || tr("Biashara"))}</div>
      ${d.company.address ? `<div>${esc(d.company.address)}</div>` : ""}${d.company.phone ? `<div>${esc(d.company.phone)}</div>` : ""}
      ${d.company.taxId ? `<div>TIN: ${esc(d.company.taxId)}</div>` : ""}
      <div style="margin-top:4px;font-weight:700">${esc(tr("Invoice"))} ${esc(inv.invoiceNo)}${(inv.revision ?? 0) > 0 ? ` (${esc(tr("Imesahihishwa"))} #${inv.revision})` : ""}</div>
    </div>
    <div>${esc(tr("Tarehe"))}: ${esc(inv.invoiceDate)}</div><div>${esc(tr("Mteja"))}: ${esc(d.clientName)}</div>${d.department ? `<div>${esc(tr("Idara"))}: ${esc(d.department)}</div>` : ""}
    <table style="width:100%;border-collapse:collapse;margin-top:6px"><thead><tr style="border-bottom:1px solid #000"><th style="text-align:left">${esc(tr("Bidhaa"))}</th><th style="text-align:right">${esc(tr("Qty"))}</th><th style="text-align:right">${esc(tr("Bei"))}</th><th style="text-align:right">${esc(tr("Jumla"))}</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="border-top:1px dashed #000;margin-top:6px;padding-top:6px">
      <div style="display:flex;justify-content:space-between"><span>${esc(tr("Subtotal"))}</span><span>${esc(m(inv.subtotal))}</span></div>
      ${inv.discount > 0 ? `<div style="display:flex;justify-content:space-between"><span>${esc(tr("Discount"))}</span><span>-${esc(m(inv.discount))}</span></div>` : ""}
      ${inv.taxAmount > 0 ? `<div style="display:flex;justify-content:space-between"><span>${esc(tr("Tax"))}</span><span>${esc(m(inv.taxAmount))}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>${esc(tr("Jumla"))}</span><span>${esc(m(inv.total))}</span></div>
      <div style="display:flex;justify-content:space-between"><span>${esc(tr("Imelipwa"))}</span><span>${esc(m(inv.amountPaid))}</span></div>
      <div style="display:flex;justify-content:space-between"><span>${esc(tr("Deni"))}</span><span>${esc(m(inv.outstanding))}</span></div>
    </div></section>`;
  printElement(el, readPaper());
}

/**
 * Reports > Product Sales: find an invoice by its number, then open it, print it, correct it or cancel it.
 * What each person sees is decided by the server (searchInvoices / invoiceFull return only the invoices of their own business and
 * department, together with canPrint / canEdit / canVoid); the buttons here only follow those answers, the server enforces them again.
 */
export default function InvoiceFinder() {
  const { user: me } = useAuth();
  const noBusiness = !!me && !me.tenantId; // Super Admin who has not opened a business yet: the finder only searches inside one business
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [openId, setOpenId] = useState<Id<"invoices"> | null>(null);
  const results = useQuery(api.sales.searchInvoices, term ? { invoiceNo: term } : "skip");
  const sellingPointResults = useQuery(api.waiterOrders.searchBillsForFinder, term ? { search: term } : "skip");
  const settings = useQuery(api.maintenance.getSettings, {});
  const branding = brandingFromSettings(settings as Parameters<typeof brandingFromSettings>[0]);
  const hardware = (settings?.app?.hardware ?? {}) as { printerSource?: string; receiptPrinter?: string; paperWidth?: string };
  // One invoice found: it opens straight away so the Edit / Cancel / Print panel is right there (until the user closes it for this search).
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const shownId = openId ?? (results && results.length === 1 && closedFor !== term ? results[0]._id : null);
  const closePanel = () => { setOpenId(null); setClosedFor(term); };

  return (
    <section className="space-y-3 rounded-xl border p-4 print:hidden">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setOpenId(null); setClosedFor(null); setTerm(text.trim()); }}>
        <label className="grid gap-1 text-sm">{tr("Tafuta invoice kwa namba, jina la mteja au mhudumu")}
          <Input className="w-64" inputMode="text" autoFocus placeholder="00001 / mteja / mhudumu" value={text} onChange={(e) => setText(e.target.value)} aria-label={tr("Namba ya invoice")} />
        </label>
        <Button type="submit"><Search className="mr-1 h-4 w-4" />{tr("Tafuta")}</Button>
        {term && <Button type="button" variant="outline" onClick={() => { setText(""); setTerm(""); setOpenId(null); setClosedFor(null); }}>{tr("Futa utafutaji")}</Button>}
      </form>
      {noBusiness && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{tr("Hujachagua biashara. Chagua biashara kwanza (Super Admin), kisha tafuta invoice; Edit na Cancel/Delete zitaonekana.")}</p>}
      {!term && <p className="text-sm text-muted-foreground">{tr("Hakuna historia inayoonyeshwa mpaka utafute. Andika namba ya invoice au jina la mteja; Sales invoices zinaweza kufunguliwa, na Selling Point bills zinaweza kuchapishwa tena.")}</p>}
      {term && results === undefined && <p className="text-sm text-muted-foreground">{tr("Inatafuta…")}</p>}
      {term && results && sellingPointResults && results.length === 0 && sellingPointResults.length === 0 && <p className="text-sm text-muted-foreground">{tr("Hakuna invoice iliyopatikana kwenye biashara/idara yako.")}</p>}
      {results && results.length > 0 && (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left">{[tr("Invoice"), tr("Tarehe"), tr("Mteja"), tr("Idara"), tr("Jumla"), tr("Deni"), tr("Hali"), ""].map((h, i) => <th key={i} className="p-2">{h}</th>)}</tr></thead>
          <tbody>{results.map((r) => (
            <tr key={r._id} className="border-b">
              <td className="p-2 font-medium">{r.invoiceNo}{r.revision > 0 ? ` (#${r.revision})` : ""}</td><td className="p-2">{r.invoiceDate}</td><td className="p-2">{r.clientName}</td><td className="p-2">{r.department || "—"}</td>
              <td className="p-2 tabular-nums">{fmt(r.total)}</td><td className="p-2 tabular-nums">{fmt(r.outstanding)}</td><td className="p-2">{r.status === "cancelled" ? tr("Imebatilishwa") : tr("Imepostiwa")}</td>
              <td className="p-2"><Button size="sm" variant="outline" onClick={() => setOpenId(r._id)}>{tr("Fungua")}</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {term && sellingPointResults && sellingPointResults.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">{tr("Selling Point — bili za historia")}</h3>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b text-left">{[tr("Invoice"), tr("Tarehe"), tr("Mteja"), tr("Mhudumu"), tr("Jumla"), tr("Hali"), ""].map((h, i) => <th key={i} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{sellingPointResults.map((bill) => (
              <tr key={bill._id} className="border-b">
                <td className="p-2 font-medium">{bill.invoiceNo}</td><td className="p-2">{bill.invoiceDate}</td><td className="p-2">{bill.customerName}</td><td className="p-2">{bill.waiterName}</td><td className="p-2 tabular-nums">{fmt(bill.total)}</td>
                <td className="p-2">{bill.status === "cancelled" ? tr("Imebatilishwa") : bill.billPrintedAt ? tr("Imechapishwa") : bill.billSentAt ? tr("Imetumwa kwa cashier") : tr("Bili ya mhudumu")}</td>
                <td className="p-2"><SellingPointBillActions bill={bill} settingsReady={settings !== undefined} hardware={hardware} branding={branding} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      {shownId && <InvoicePanel key={shownId} invoiceId={shownId} onClose={closePanel} />}
    </section>
  );
}

type FinderSellingPointBill = FunctionReturnType<typeof api.waiterOrders.searchBillsForFinder>[number];

function SellingPointBillActions({
  bill, settingsReady, hardware, branding,
}: {
  bill: FinderSellingPointBill;
  settingsReady: boolean;
  hardware: { printerSource?: string; receiptPrinter?: string; paperWidth?: string };
  branding: ReturnType<typeof brandingFromSettings>;
}) {
  const editBill = useMutation(api.waiterOrders.editBillFromFinder);
  const cancelBill = useMutation(api.waiterOrders.cancelBillFromFinder);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [customerName, setCustomerName] = useState(bill.customerName);
  const [tableNumber, setTableNumber] = useState(bill.tableNumber ?? "");
  const [notes, setNotes] = useState(bill.notes ?? "");
  const [reason, setReason] = useState("");
  const [billDate, setBillDate] = useState(bill.invoiceDate);
  const [lines, setLines] = useState(bill.lines.map(line => ({
    productId: line.productId, qty: String(line.qty), unitPrice: String(line.unitPrice),
    discount: String(line.discount ?? 0), productName: line.productName,
  })));
  const [busy, setBusy] = useState(false);
  const cancelled = bill.status === "cancelled";
  const showEdit = bill.canEdit; // a bill received by the cashier or already paid can still be changed: the money is given back first
  const showVoid = bill.canVoid;
  const locked = false;
  const paidText = tr("Bili hii ina malipo ya {0}. Ukihariri au kufuta, malipo yatarudishwa kwa njia zile zile (cash / bank / simu), mapato na makusanyo ya siku yatarekebishwa. Mrudishie mhudumu pesa yake.", [fmt(bill.paidAmount)]);
  const save = async () => {
    if (!lines.length) { toast.error(tr("Bili lazima iwe na angalau bidhaa moja. Kama unataka kuiondoa kabisa, tumia Delete / Cancel.")); return; }
    if (lines.some(line => !(Number(line.qty) > 0))) { toast.error(tr("Quantity lazima iwe zaidi ya sifuri.")); return; }
    if (!billDate) { toast.error(tr("Chagua tarehe ya bili.")); return; }
    setBusy(true);
    try {
      if (bill.hasPayment && !window.confirm(paidText)) { setBusy(false); return; }
      await editBill({
        undoPayment: bill.hasPayment || undefined,
        ...(billDate !== bill.invoiceDate ? { billDate } : {}),
        orderId: bill._id, customerName, tableNumber: tableNumber || undefined, notes: notes || undefined,
        lines: lines.map(line => ({
          productId: line.productId, qty: Number(line.qty), unitPrice: Number(line.unitPrice), discount: Number(line.discount || 0),
        })),
      });
      toast.success(tr("Invoice imesasishwa; namba yake imehifadhiwa."));
      setEditing(false);
    } catch (error) { toast.error(errorText(error)); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await cancelBill({ orderId: bill._id, reason, refundPayment: bill.hasPayment || undefined });
      toast.success(tr("Invoice imebatilishwa; historia imehifadhiwa."));
      setConfirmCancel(false);
    } catch (error) { toast.error(errorText(error)); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex min-w-[240px] flex-wrap gap-1">
      {!cancelled && bill.canPrint && <Button size="sm" variant="outline" disabled={!settingsReady} onClick={() => void printWaiterOrder({ invoiceNo: bill.invoiceNo, customerName, waiterName: bill.waiterName, tableNumber: tableNumber || undefined, total: bill.total, lines: bill.lines }, qzPrinterFrom(hardware), hardware.paperWidth, { ...branding, title: tr("BILI YA HISTORIA") })}><Printer className="mr-1 h-4 w-4" />{tr("Chapisha")}</Button>}
      {!cancelled && bill.hasPayment && (showEdit || showVoid) && <p className="w-full text-xs text-amber-700">{paidText}</p>}
      {!cancelled && showEdit && <Button size="sm" variant="outline" disabled={locked || busy} onClick={() => setEditing(v => !v)}><Pencil className="mr-1 h-4 w-4" />{tr("Edit")}</Button>}
      {!cancelled && showVoid && <Button size="sm" variant="destructive" disabled={locked || busy} onClick={() => setConfirmCancel(v => !v)}><Trash2 className="mr-1 h-4 w-4" />{tr("Delete / Cancel")}</Button>}
      {editing && (
        <div className="mt-2 w-full space-y-2 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">{tr("Mteja")}<Input value={customerName} onChange={e => setCustomerName(e.target.value)} /></label>
            <label className="text-xs">{tr("Meza")}<Input value={tableNumber} onChange={e => setTableNumber(e.target.value)} /></label>
            <label className="text-xs">{tr("Tarehe ya bili")}<Input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} /></label>
          </div>
          {billDate !== bill.invoiceDate && <p className="text-xs text-amber-700">{tr("Tarehe ya bili itabadilika kutoka {0} kwenda {1}; mauzo yataonekana kwenye ripoti za tarehe mpya.", [bill.invoiceDate, billDate])}</p>}
          <label className="block text-xs">{tr("Maelezo")}<Input value={notes} onChange={e => setNotes(e.target.value)} /></label>
          {lines.map((line, i) => (
            <div key={`${line.productId}-${i}`} className="grid grid-cols-5 gap-1 text-xs">
              <span className="col-span-5 font-medium">{line.productName}</span>
              <label>{tr("Qty")}<Input type="number" min="0.001" step="any" value={line.qty} onChange={e => setLines(prev => prev.map((x,j) => j === i ? { ...x, qty: e.target.value } : x))} /></label>
              <label>{tr("Bei")}<Input type="number" min="0" step="any" value={line.unitPrice} onChange={e => setLines(prev => prev.map((x,j) => j === i ? { ...x, unitPrice: e.target.value } : x))} /></label>
              <label>{tr("Punguzo")}<Input type="number" min="0" step="any" value={line.discount} onChange={e => setLines(prev => prev.map((x,j) => j === i ? { ...x, discount: e.target.value } : x))} /></label>
              <span className="self-center text-right">{fmt(Math.max(0, Number(line.qty) * Number(line.unitPrice) - Number(line.discount)))}</span>
              <Button type="button" size="sm" variant="ghost" className="self-end" disabled={busy || lines.length <= 1} title={lines.length <= 1 ? tr("Bili lazima ibaki na angalau bidhaa moja.") : undefined} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}><Trash2 className="mr-1 h-4 w-4" />{tr("Ondoa")}</Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save()}><Save className="mr-1 h-4 w-4" />{tr("Hifadhi mabadiliko")}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}><X className="mr-1 h-4 w-4" />{tr("Ghairi")}</Button>
          </div>
        </div>
      )}
      {confirmCancel && (
        <div className="mt-2 w-full space-y-2 rounded-md border border-destructive/40 p-3">
          <p className="text-xs">{bill.hasPayment ? tr("Bili itabatilishwa, stock itarudishwa na malipo ya {0} yatarudishwa. Rekodi na namba ya invoice vitahifadhiwa.", [fmt(bill.paidAmount)]) : tr("Bili itabatilishwa na stock itarudishwa. Rekodi na namba ya invoice vitahifadhiwa.")}</p>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder={tr("Sababu ya kubatilisha")} />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => void cancel()}>{tr("Thibitisha kufuta")}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(false)}>{tr("Ghairi")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InvoicePanel({ invoiceId, onClose }: { invoiceId: Id<"invoices">; onClose: () => void }) {
  const d = useQuery(api.sales.invoiceFull, { invoiceId });
  const [mode, setMode] = useState<"view" | "edit" | "cancel">("view");
  const [showUnpay, setShowUnpay] = useState(false);
  const unpayInvoice = useMutation(api.sales.unpayInvoice);
  const [unpayBusy, setUnpayBusy] = useState(false);
  if (d === undefined) return <div className="rounded-lg border p-3 text-sm text-muted-foreground">{tr("Inapakia…")}</div>;
  if (d === null) return <div className="rounded-lg border p-3 text-sm">{tr("Invoice haipatikani.")} <Button size="sm" variant="outline" onClick={onClose}>{tr("Funga")}</Button></div>;
  const inv = d.invoice;
  const cancelled = inv.status === "cancelled";
  const locked = d.hasReturns ? tr("Invoice hii ina marejesho ya bidhaa; haiwezi kuhaririwa.") : d.inCustomerBill ? tr("Invoice hii ipo kwenye Customer Bill; iondoe kwenye bill kwanza.") : "";

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{tr("Invoice")} {inv.invoiceNo}{(inv.revision ?? 0) > 0 ? ` — ${tr("Imesahihishwa")} #${inv.revision}` : ""}{cancelled ? ` — ${tr("Imebatilishwa")}` : ""}</h2>
        <div className="flex flex-wrap gap-2">
          {d.canPrint && <Button size="sm" variant="outline" onClick={() => printInvoice(d)}><Printer className="mr-1 h-4 w-4" />{tr("Chapisha")}</Button>}
          {!cancelled && inv.amountPaid > 0 && d.canUnpay && mode === "view" && <Button size="sm" variant="outline" onClick={() => setShowUnpay((v) => !v)}>{tr("Unpay")}</Button>}
          {!cancelled && d.canEdit && mode !== "edit" && <Button size="sm" variant="outline" disabled={!!locked || inv.amountPaid > 0} title={inv.amountPaid > 0 ? tr("Fanya Unpay kwanza kabla ya kuhariri invoice.") : locked} onClick={() => setMode("edit")}>{tr("Edit Invoice")}</Button>}
          {!cancelled && d.canVoid && mode !== "cancel" && <Button size="sm" variant="destructive" disabled={inv.amountPaid > 0} title={inv.amountPaid > 0 ? tr("Fanya Unpay kwanza kabla ya kufuta invoice.") : undefined} onClick={() => setMode("cancel")}>{tr("Delete / Cancel Invoice")}</Button>}
          <Button size="sm" variant="ghost" onClick={onClose}>{tr("Funga")}</Button>
        </div>
      </div>
      {locked && !cancelled && d.canEdit && <p className="text-xs text-amber-700">{locked}</p>}
      {!cancelled && inv.amountPaid > 0 && (d.canEdit || d.canVoid) && mode === "view" && <p className="text-xs text-amber-700">{tr("Invoice hii ina malipo ({0}). Bonyeza Unpay kwanza; ndipo Edit na Delete / Cancel zitafunguka.", [fmt(inv.amountPaid)])}</p>}
      {!cancelled && !d.canEdit && !d.canVoid && <p className="text-xs text-muted-foreground">{tr("Huna ruhusa ya Edit wala Cancel/Delete. Muombe Super Admin au Manager akupe ruhusa hizo kwenye User Settings.")}</p>}
      {showUnpay && inv.amountPaid > 0 && mode === "view" && <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
        <p className="text-sm">{tr("Unpay itarejesha kiasi chote kilicholipwa ({0}) kwenye njia zilezile za malipo. Invoice itabaki kwenye mauzo lakini deni lake litafunguliwa tena.", [fmt(inv.amountPaid)])}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={unpayBusy} onClick={() => { if (!window.confirm(tr("Thibitisha kurudisha malipo yote ya invoice hii kwa njia za awali?"))) return; setUnpayBusy(true); void unpayInvoice({ invoiceId }).then((r) => { toast.success(tr("Invoice {0} sasa haijalipwa. Kiasi kilichorejeshwa: {1}", [r.invoiceNo, fmt(r.refunded)])); setShowUnpay(false); }).catch((e) => toast.error(errorText(e, tr("Imeshindikana kufanya Unpay.")))).finally(() => setUnpayBusy(false)); }}>{unpayBusy ? tr("Inarejesha...") : tr("Thibitisha Unpay")}</Button>
          <Button size="sm" variant="outline" disabled={unpayBusy} onClick={() => setShowUnpay(false)}>{tr("Ghairi")}</Button>
        </div>
      </div>}
      <p className="text-sm text-muted-foreground">{inv.invoiceDate} · {d.clientName}{d.department ? ` · ${d.department}` : ""}</p>

      {mode === "edit" ? <EditForm d={d} onDone={() => setMode("view")} onCancel={() => setMode("view")} />
        : mode === "cancel" ? <CancelForm d={d} onDone={onClose} onBack={() => setMode("view")} onEdit={() => setMode(d.canEdit && !locked ? "edit" : "cancel")} lockedMsg={locked} />
        : <ViewTable d={d} />}
    </div>
  );
}

function ViewTable({ d }: { d: Full }) {
  const inv = d.invoice;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left">{[tr("Code"), tr("Bidhaa"), tr("Qty"), tr("Bei"), tr("Discount"), tr("Jumla")].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
        <tbody>{d.lines.map((l) => <tr key={l._id} className="border-b"><td className="p-2">{l.itemCode}</td><td className="p-2">{l.productName}</td><td className="p-2 tabular-nums">{fmt(l.qty, 4)}</td><td className="p-2 tabular-nums">{fmt(l.unitPrice)}</td><td className="p-2 tabular-nums">{fmt(l.discount)}</td><td className="p-2 tabular-nums">{fmt(l.lineTotal)}</td></tr>)}</tbody>
      </table></div>
      <div className="grid gap-1 text-sm sm:max-w-xs">
        {[[tr("Subtotal"), inv.subtotal], [tr("Discount"), inv.discount], [tr("Tax"), inv.taxAmount], [tr("Jumla"), inv.total], [tr("Imelipwa"), inv.amountPaid], [tr("Deni"), inv.outstanding]].map(([k, v]) => <div key={String(k)} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{fmt(Number(v))}</span></div>)}
      </div>
      {d.payments.length > 0 && <p className="text-xs text-muted-foreground">{tr("Malipo")}: {d.payments.map((p) => `${p.date} ${p.method} ${fmt(p.amount)}`).join(" · ")}</p>}
    </div>
  );
}

function EditForm({ d, onDone, onCancel }: { d: Full; onDone: () => void; onCancel: () => void }) {
  const editInvoice = useMutation(api.sales.editInvoice);
  const products = useQuery(api.products.listActive, {});
  const methods = usePaymentMethods();
  const inv = d.invoice;
  const [lines, setLines] = useState<EditLine[]>(() => d.lines.map((l) => ({ productId: String(l.productId), name: l.productName, qty: String(l.qty), price: String(l.unitPrice), discount: String(l.discount) })));
  const [invDiscount, setInvDiscount] = useState(String(inv.discount));
  const [invoiceDate, setInvoiceDate] = useState(inv.invoiceDate);
  const [taxRate, setTaxRate] = useState(String(d.taxRate));
  const [notes, setNotes] = useState(inv.notes ?? "");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("cash");
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  const totals = useMemo(() => editedTotals(lines, invDiscount, taxRate), [lines, invDiscount, taxRate]);
  const refund = round2(Math.max(0, inv.amountPaid - totals.total));
  const newDebt = round2(totals.total - (inv.amountPaid - refund));
  const set = (i: number, patch: Partial<EditLine>) => setLines((old) => old.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (busy) return;
    if (!lines.length) { toast.error(tr("Invoice lazima iwe na angalau bidhaa moja. Kama unataka kuiondoa kabisa, ifute (Cancel).")); return; }
    if (lines.some((l) => !(num(l.qty) > 0))) { toast.error(tr("Quantity lazima iwe zaidi ya sifuri.")); return; }
    if (!invoiceDate) { toast.error(tr("Chagua tarehe ya invoice.")); return; }
    if (!reason.trim()) { toast.error(tr("Andika sababu ya kuhariri invoice.")); return; }
    setBusy(true);
    try {
      const m = methodArgs(methods, pickMethodKey(methods, method));
      const r = await editInvoice({
        invoiceId: inv._id, reason: reason.trim(), notes: notes.trim(), discount: num(invDiscount), taxRate: num(taxRate),
        ...(invoiceDate !== inv.invoiceDate ? { invoiceDate } : {}),
        lines: lines.map((l) => ({ productId: l.productId as Id<"products">, qty: num(l.qty), unitPrice: num(l.price), discount: num(l.discount) })),
        ...(refund > 0 ? { refundMethod: m.method, refundMethodId: m.methodId } : {}),
      });
      toast.success(tr("Invoice {0} imesahihishwa (#{1}). Jumla mpya: {2}. Deni: {3}.", [r.invoiceNo, r.revision, fmt(r.total), fmt(r.outstanding)]));
      onDone();
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuhifadhi marekebisho.")); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{tr("Badilisha bidhaa, idadi au bei. Namba ya invoice inabaki ile ile; stock, malipo, deni na ripoti vinasasishwa pamoja.")}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left">{[tr("Bidhaa"), tr("Qty"), tr("Bei"), tr("Discount"), tr("Jumla"), ""].map((h, i) => <th key={i} className="p-2">{h}</th>)}</tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={`${l.productId}-${i}`} className="border-b">
            <td className="p-2 font-medium">{l.name}</td>
            <td className="p-2"><Input type="number" min={0} step="any" className="h-9 w-24" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
            <td className="p-2"><Input type="number" min={0} step="any" className="h-9 w-28" value={l.price} onChange={(e) => set(i, { price: e.target.value })} /></td>
            <td className="p-2"><Input type="number" min={0} step="any" className="h-9 w-24" value={l.discount} onChange={(e) => set(i, { discount: e.target.value })} /></td>
            <td className="p-2 tabular-nums">{fmt(Math.max(0, round2(num(l.qty) * num(l.price) - num(l.discount))))}</td>
            <td className="p-2"><Button type="button" size="sm" variant="ghost" disabled={lines.length <= 1} title={lines.length <= 1 ? tr("Invoice lazima ibaki na angalau bidhaa moja. Kama unataka kuiondoa kabisa, ifute (Cancel).") : undefined} onClick={() => setLines((old) => old.filter((_, idx) => idx !== i))}>{tr("Ondoa")}</Button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">{tr("Ongeza bidhaa")}
          <select className={selectClass} value={adding} onChange={(e) => {
            const p = (products ?? []).find((x) => String(x._id) === e.target.value);
            setAdding("");
            if (p) setLines((old) => old.some((l) => l.productId === String(p._id)) ? old : [...old, { productId: String(p._id), name: p.name, qty: "1", price: String(p.sellingPrice), discount: "0" }]);
          }}>
            <option value="">{tr("-- Chagua bidhaa --")}</option>
            {(products ?? []).filter((p) => p.onMenu !== false).map((p) => <option key={p._id} value={p._id}>{p.itemCode} — {p.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">{tr("Discount ya invoice")}<Input type="number" min={0} step="any" className="w-32" value={invDiscount} onChange={(e) => setInvDiscount(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">{tr("Tax %")}<Input type="number" min={0} max={100} step="any" className="w-24" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">{tr("Tarehe ya invoice")}<Input type="date" className="w-40" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></label>
      </div>
      {invoiceDate !== inv.invoiceDate && <p className="text-xs text-amber-700">{tr("Tarehe ya invoice itabadilika kutoka {0} kwenda {1}; mauzo, stock na hesabu vitahamia tarehe mpya.", [inv.invoiceDate, invoiceDate])}</p>}
      <label className="grid gap-1 text-sm">{tr("Sababu ya kuhariri")}<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("Mfano: mteja alibadilisha idadi")} /></label>
      <label className="grid gap-1 text-sm">{tr("Maelezo")}<Input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="grid gap-1 text-sm sm:max-w-sm">
        <div className="flex justify-between"><span>{tr("Jumla ya zamani")}</span><span className="tabular-nums">{fmt(inv.total)}</span></div>
        <div className="flex justify-between font-semibold"><span>{tr("Jumla mpya")}</span><span className="tabular-nums">{fmt(totals.total)}</span></div>
        <div className="flex justify-between"><span>{tr("Imelipwa tayari")}</span><span className="tabular-nums">{fmt(inv.amountPaid)}</span></div>
        <div className="flex justify-between"><span>{tr("Deni jipya")}</span><span className="tabular-nums">{fmt(newDebt)}</span></div>
        {refund > 0 && <div className="flex items-center justify-between gap-2"><span>{tr("Kurudishiwa mteja")}: {fmt(refund)}</span>
          <select className={selectClass} value={pickMethodKey(methods, method)} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>}
      </div>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void save()}>{busy ? tr("Inahifadhi…") : tr("Hifadhi marekebisho")}</Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>{tr("Ghairi")}</Button>
      </div>
    </div>
  );
}

function CancelForm({ d, onDone, onBack, onEdit, lockedMsg }: { d: Full; onDone: () => void; onBack: () => void; onEdit: () => void; lockedMsg: string }) {
  const voidInvoice = useMutation(api.sales.voidInvoice);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const canFix = d.canEdit && !lockedMsg;
  const run = async () => {
    if (busy) return;
    if (reason === "Sababu nyingine" && !details.trim()) { toast.error(tr("Eleza sababu nyingine kabla ya kubatilisha invoice.")); return; }
    if (!window.confirm(tr("Invoice {0} itafutwa kabisa: stock itarudi na malipo yatarudishwa. Endelea?", [d.invoice.invoiceNo]))) return;
    setBusy(true);
    try {
      const r = await voidInvoice({ invoiceId: d.invoice._id, reason, reasonDetails: details.trim() || undefined });
      toast.success(tr("Invoice {0} imefutwa. Yaliyorudishwa kwa mteja: {1}.", [r.invoiceNo, fmt(r.refunded)]));
      onDone();
    } catch (e) { toast.error(errorText(e, "Imeshindikana kubatilisha invoice.")); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{tr("Chagua unachotaka kufanya na invoice hii:")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3">
          <h3 className="font-semibold">{tr("1. Futa invoice kabisa")}</h3>
          <p className="text-xs text-muted-foreground">{tr("Stock inarudishwa, malipo yanarudishwa, deni linafutwa na invoice inatoka kwenye ripoti zote.")}</p>
          <select className={`${selectClass} w-full`} value={reason} onChange={(e) => setReason(e.target.value)}>{CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          {reason === "Sababu nyingine" && <Input value={details} onChange={(e) => setDetails(e.target.value)} placeholder={tr("Eleza sababu")} />}
          <Button variant="destructive" disabled={busy} onClick={() => void run()}>{busy ? tr("Inafuta…") : tr("Futa kabisa")}</Button>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <h3 className="font-semibold">{tr("2. Rekebisha bidhaa / idadi")}</h3>
          <p className="text-xs text-muted-foreground">{tr("Invoice inabaki na namba ile ile, inatoka bili iliyosahihishwa, na stock, malipo na madeni vinarekebishwa.")}</p>
          {!d.canEdit && <p className="text-xs text-amber-700">{tr("Huna ruhusa ya kuhariri invoice.")}</p>}
          {lockedMsg && <p className="text-xs text-amber-700">{lockedMsg}</p>}
          <Button variant="outline" disabled={!canFix} onClick={onEdit}>{tr("Rekebisha bidhaa / idadi")}</Button>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onBack}>{tr("← Rudi")}</Button>
    </div>
  );
}
