import { useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Stat } from "@/pages/shared/report.tsx";
import { fmt, num, round2, today } from "@/pages/shared/report-utils.ts";
import { tr, errorText } from "@/lib/i18n.ts";
import BillSheet from "@/components/BillSheet.tsx";
import ReturnPanel from "@/pages/sales/ReturnPanel.tsx";
import type { Paper } from "@/lib/print-area.ts";
import { tokenAfterSave } from "@/lib/print-policy.ts";
import { printWaiterOrder } from "@/lib/print-waiter-order.ts";

type Line = { productId: string; qty: string; price: string; discount: string };
const emptyLine = (): Line => ({ productId: "", qty: "1", price: "0", discount: "0" });
const selectClass = "h-10 rounded-md border bg-background px-3";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export default function InvoiceEntry() {
  const navigate = useNavigate();
  const clients = useQuery(api.clients.list, {});
  const products = useQuery(api.products.listActive, {});
  const units = useQuery(api.products.listUnits, {});
  const recent = useQuery(api.sales.recentInvoices, { startDate: daysAgo(30), endDate: today(), limit: 200 });
  const createInvoice = useMutation(api.sales.createInvoice);
  // One key per sale attempt: a retry or double click re-sends the same key, so the server never sells twice. Renewed after a successful save.
  const requestKeyRef = useRef<string>(crypto.randomUUID());
  const voidInvoice = useMutation(api.sales.voidInvoice);
  const business = useQuery(api.tenants.current);
  // Waiter / waitress (when Waiter Orders is ON for their role): this window does "Weka Order" -> Send / Print instead of saving an invoice.
  const me = useQuery(api.users.getCurrentUser);
  const myRole = String(me?.role ?? "").toLowerCase();
  const waiterMode = business?.waiterOrdersEnabled !== false && ((myRole === "waiter" && business?.waiterEnabled === true) || (myRole === "waitress" && business?.waitressEnabled === true));
  const waiterOrderMode = business?.waiterOrderMode === "print" ? "print" : "cashier";
  const placeOrder = useMutation(api.waiterOrders.place);
  const sendToCashier = useMutation(api.waiterOrders.sendToCashier);
  const markPrinted = useMutation(api.waiterOrders.markPrinted);
  const myOrders = useQuery(api.waiterOrders.list, waiterMode ? {} : "skip");
  const [placedId, setPlacedId] = useState<Id<"waiterOrders"> | null>(null);
  const [tableNo, setTableNo] = useState("");
  const settings = useQuery(api.maintenance.getSettings, {});
  const allowNegative = !!settings?.company?.allowNegativeStock; // same switch the server uses (Maintenance > Company)

  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(today());
  const [source, setSource] = useState("Counter");
  const [taxRate, setTaxRate] = useState("0");
  const [invoiceDiscount, setInvoiceDiscount] = useState("0");
  const hardware = (settings?.app?.hardware ?? {}) as { paperWidth?: string; autoPrintReceipt?: boolean; printerSource?: string; receiptPrinter?: string };
  const paper: Paper = hardware.paperWidth === "a4" ? "A4" : hardware.paperWidth === "58mm" ? "58mm" : "80mm";
  const [whatsappEnabled, setWhatsappEnabled] = useState(() => { try { return localStorage.getItem("smarthub-bill-whatsapp-enabled") !== "false"; } catch { return true; } });
  const changeWhatsapp = (value: boolean) => { setWhatsappEnabled(value); try { localStorage.setItem("smarthub-bill-whatsapp-enabled", String(value)); } catch { /* storage unavailable */ } };
  // The invoice just saved, and the one picked in the list below: both are shown with the same layout as a Bill.
  const [justSaved, setJustSaved] = useState<Id<"invoices"> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [printToken, setPrintToken] = useState(0);
  const [notes, setNotes] = useState("");
  const [scan, setScan] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false); // partial return screen for the picked invoice

  const unitName = useMemo(() => new Map((units ?? []).map((u) => [String(u._id), u.name])), [units]);
  const productById = useMemo(() => new Map((products ?? []).map((p) => [String(p._id), p])), [products]);

  if (!clients || !products) return <div className="p-6 text-sm text-muted-foreground">{tr("Inapakia…")}</div>;

  const update = (i: number, patch: Partial<Line>) => setLines((old) => old.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const choose = (i: number, productId: string) => update(i, { productId, price: String(productById.get(productId)?.sellingPrice ?? 0) });

  // Quantity requested per product across all lines (the same item may appear on more than one line).
  const requested = new Map<string, number>();
  for (const l of lines) if (l.productId) requested.set(l.productId, (requested.get(l.productId) ?? 0) + num(l.qty));

  const lineTotal = (l: Line) => round2(Math.max(0, num(l.qty) * num(l.price) - num(l.discount)));
  const subtotal = round2(lines.reduce((n, l) => n + lineTotal(l), 0));
  const discount = round2(num(invoiceDiscount));
  const taxable = round2(Math.max(0, subtotal - discount));
  const tax = round2((taxable * num(taxRate)) / 100);
  const total = round2(taxable + tax);
  const balance = total;

  const addByCode = () => {
    const code = scan.trim().toLowerCase();
    if (!code) return;
    const p = products.find((x) => (x.barcode ?? "").toLowerCase() === code || x.itemCode.toLowerCase() === code);
    if (!p) { toast.error(tr("Bidhaa yenye barcode/code “{0}” haijapatikana.", [scan])); return; }
    setLines((old) => {
      const idx = old.findIndex((l) => l.productId === p._id);
      if (idx >= 0) return old.map((l, i) => (i === idx ? { ...l, qty: String(num(l.qty) + 1) } : l));
      const blank = old.findIndex((l) => !l.productId);
      const fresh = { ...emptyLine(), productId: p._id, price: String(p.sellingPrice) };
      return blank >= 0 ? old.map((l, i) => (i === blank ? fresh : l)) : [...old, fresh];
    });
    setScan("");
  };

  const cancelSelected = async () => {
    if (!selected) return;
    const inv = recent?.invoices.find((x) => String(x._id) === selected);
    const reason = window.prompt(tr("Batilisha invoice {0}? Stoo itarudi na malipo yaliyopokelewa yatarudishwa. Andika sababu (hiari) kisha bonyeza OK.", [inv?.invoiceNo ?? ""]));
    if (reason === null) return;
    setBusy(true);
    try {
      const r = await voidInvoice({ invoiceId: selected as Id<"invoices">, reason: reason.trim() || undefined });
      toast.success(tr("Invoice {0} imebatilishwa. Yaliyorudishwa: {1}.", [r.invoiceNo, fmt(r.refunded)]));
      setSelected(null); setReturning(false); setJustSaved(null); setPrintToken(0);
    } catch (e) { toast.error(errorText(e, "Imeshindikana kubatilisha invoice.")); }
    finally { setBusy(false); }
  };

  const placedOrder = placedId ? (myOrders ?? []).find((o) => o._id === placedId) : undefined;
  const weka = async () => {
    if (!clientId) { toast.error(tr("Chagua mteja.")); return; }
    const used = lines.filter((l) => l.productId);
    if (!used.length) { toast.error(tr("Ongeza angalau bidhaa moja.")); return; }
    if (lines.some((l) => !l.productId || !(num(l.qty) > 0))) { toast.error(tr("Kila mstari uwe na bidhaa na quantity zaidi ya sifuri.")); return; }
    const customerName = (clients ?? []).find((c) => String(c._id) === clientId)?.name ?? "";
    setBusy(true);
    try {
      const id = await placeOrder({ customerName, tableNumber: tableNo.trim() || undefined, notes: notes.trim() || undefined, lines: lines.map((l) => ({ productId: l.productId as Id<"products">, qty: num(l.qty) })) });
      setPlacedId(id); setLines([emptyLine()]); setNotes(""); setTableNo("");
      toast.success(tr("Oda imewekwa bila kupunguza stock. Sasa chagua Send au Print."));
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuweka oda.")); }
    finally { setBusy(false); }
  };
  const sendPlaced = async () => {
    if (!placedId) return;
    try { await sendToCashier({ orderId: placedId }); toast.success(tr("Oda imetumwa kwa cashier.")); setPlacedId(null); }
    catch (e) { toast.error(errorText(e, "Imeshindikana kutuma oda.")); }
  };
  const printPlaced = async () => {
    if (!placedId || !placedOrder) return;
    const printed = await printWaiterOrder(placedOrder, hardware.printerSource === "installed" ? hardware.receiptPrinter : undefined, hardware.paperWidth);
    if (!printed) return;
    try {
      await markPrinted({ orderId: placedId });
      toast.success(tr("Oda imechapishwa kupitia QZ Tray."));
    } catch (error) {
      toast.error(errorText(error, tr("Oda imechapishwa, lakini hali yake haikuhifadhiwa.")));
    }
  };

  const submit = async () => {
    if (!clientId) { toast.error(tr("Chagua mteja.")); return; }
    const used = lines.filter((l) => l.productId);
    if (!used.length) { toast.error(tr("Ongeza angalau bidhaa moja.")); return; }
    for (const l of lines) {
      if (!l.productId) { toast.error(tr("Kila mstari uwe na bidhaa, au uondoe mstari mtupu.")); return; }
      if (!(num(l.qty) > 0)) { toast.error(tr("Quantity lazima iwe zaidi ya sifuri.")); return; }
      if (num(l.price) < 0 || num(l.discount) < 0 || num(l.discount) > num(l.qty) * num(l.price)) { toast.error(tr("Bei au discount ya mstari si sahihi.")); return; }
    }
    for (const [id, qty] of requested) {
      const p = productById.get(id);
      if (!allowNegative && p && qty > p.currentQty + 1e-8) { toast.error(tr("Stock haitoshi kwa {0}. Iliyopo: {1}, unayouza: {2}", [p.name, fmt(p.currentQty, 4), fmt(qty, 4)])); return; }
    }
    setBusy(true);
    try {
      const r = await createInvoice({
        clientId: clientId as Id<"clients">, invoiceDate: date,
        lines: lines.map((l) => ({ productId: l.productId as Id<"products">, qty: num(l.qty), unitPrice: num(l.price), discount: num(l.discount) })),
        discount, taxRate: num(taxRate), paymentAmount: 0, paymentMethod: "cash", notes: notes.trim() || undefined, salesSource: source.trim() || undefined,
        requestKey: requestKeyRef.current,
      });
      requestKeyRef.current = crypto.randomUUID();
      setSelected(null); setJustSaved(r.invoiceId);
      // Printing is configured centrally under Maintenance > Hardware Setup.
      // BillSheet prints only after its saved invoice data is loaded; it never creates another invoice.
      setPrintToken((n) => tokenAfterSave(n, !!hardware.autoPrintReceipt));
      toast.success(tr("Invoice {0} imehifadhiwa — jumla {1}, deni {2}.", [r.invoiceNo, fmt(r.total), fmt(r.outstanding)]));
      if (r.creditWarning) toast.warning(tr("Onyo: mteja huyu amevuka kikomo chake cha mkopo."));
      setLines([emptyLine()]); setInvoiceDiscount("0"); setNotes("");
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuhifadhi invoice.")); }
    finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-5">
      <Button variant="outline" onClick={() => navigate("/sales")}>{tr("← Sales")}</Button>
      <section className="rounded-xl border p-5">
        <h1 className="mb-1 text-2xl font-bold">{tr("Invoicing — uza bidhaa")}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{tr("Ongeza bidhaa nyingi kwenye invoice moja. Stock itapungua mara moja baada ya kuhifadhi.")}</p>
        {!clients.length && (
          <div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            
            {tr("Hakuna mteja bado. Tengeneza mteja (mfano “Cash Customer”) kwanza.")} <Button size="sm" className="ml-2" onClick={() => navigate("/sales/clients")}>{tr("Add Client")}</Button>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-1 text-sm">{tr("Mteja")}
            <select className={selectClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">{tr("-- Chagua mteja --")}</option>
              {clients.filter((c) => c.isActive).map((c) => <option key={c._id} value={c._id}>{c.name} ({c.code})</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">{tr("Tarehe")}<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">{tr("Chanzo cha mauzo")}
            <select className={selectClass} value={source} onChange={(e) => setSource(e.target.value)}>
              {["Counter", "Phone", "Online", "Delivery", "Other"].map((s) => <option key={s} value={s}>{tr(s)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">{tr("Scan barcode / andika item code kisha Enter")}
            <Input value={scan} placeholder={tr("Barcode au Item Code")} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addByCode(); } }} />
          </label>
          <label className="grid gap-1 text-sm">{tr("Maelezo (hiari)")}<Input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b text-left">{[tr("Item Name"), tr("Unit"), tr("Stock"), tr("Quantity"), tr("Price / Unit"), tr("Discount"), tr("Total"), tr("Action")].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const p = productById.get(l.productId);
                const over = p ? (requested.get(l.productId) ?? 0) > p.currentQty + 1e-8 : false;
                return (
                  <tr key={i} className="border-b">
                    <td className="p-2">
                      <select className="h-10 min-w-52 rounded-md border bg-background px-2" value={l.productId} onChange={(e) => choose(i, e.target.value)}>
                        <option value="">{tr("-- Chagua bidhaa --")}</option>
                        {products.map((x) => <option key={x._id} value={x._id}>{x.name} ({fmt(x.currentQty, 2)})</option>)}
                      </select>
                    </td>
                    <td className="p-2">{p?.unitId ? unitName.get(String(p.unitId)) ?? tr("Unit") : tr("Unit")}</td>
                    <td className={`p-2 tabular-nums ${over ? "font-semibold text-destructive" : ""}`}>{p ? fmt(p.currentQty, 4) : "—"}</td>
                    <td className="p-2"><Input className="w-24" type="number" step="any" min="0" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} /></td>
                    <td className="p-2"><Input className="w-28" type="number" step="any" min="0" value={l.price} onChange={(e) => update(i, { price: e.target.value })} /></td>
                    <td className="p-2"><Input className="w-24" type="number" step="any" min="0" value={l.discount} onChange={(e) => update(i, { discount: e.target.value })} /></td>
                    <td className="p-2 text-right tabular-nums font-medium">{fmt(lineTotal(l))}</td>
                    <td className="p-2"><Button variant="outline" disabled={lines.length === 1} onClick={() => setLines((old) => old.filter((_, idx) => idx !== i))}>{tr("Ondoa")}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
          <Button variant="outline" onClick={() => setLines((old) => [...old, emptyLine()])}>{tr("＋ Add Line")}</Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">{tr("Discount ya invoice")}<Input type="number" step="any" min="0" value={invoiceDiscount} onChange={(e) => setInvoiceDiscount(e.target.value)} /></label>
            <label className="grid gap-1 text-sm">{tr("Tax (%)")}<Input type="number" step="any" min="0" max="100" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></label>
          </div>
          <div className="min-w-56 space-y-1 text-right text-sm">
            <div>{tr("Subtotal:")} <b className="tabular-nums">{fmt(subtotal)}</b></div>
            <div>{tr("Discount:")} <b className="tabular-nums">{fmt(discount)}</b></div>
            <div>{tr("Tax:")} <b className="tabular-nums">{fmt(tax)}</b></div>
            <div className="text-xl">{tr("Jumla:")} <b className="tabular-nums">{fmt(total)}</b></div>
            <div className={balance > 0 ? "text-destructive" : ""}>{tr("Deni:")} <b className="tabular-nums">{fmt(balance)}</b></div>
          </div>
        </div>
        {waiterMode
          ? <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm">{tr("Namba ya meza (hiari)")}<Input value={tableNo} onChange={(e) => setTableNo(e.target.value)} /></label>
              <Button disabled={busy} onClick={() => void weka()}>{busy ? tr("Inaweka...") : tr("Weka Order")}</Button>
            </div>
          : <div className="mt-4"><Button disabled={busy} onClick={() => void submit()}>{busy ? tr("Inahifadhi…") : tr("Hifadhi Invoice")}</Button></div>}
      </section>

      {waiterMode && placedId && <section className="space-y-3 rounded-xl border p-4">
        <h2 className="font-semibold">{tr("Oda imewekwa")}{placedOrder ? ` — ${placedOrder.customerName}` : ""}</h2>
        <p className="text-sm text-muted-foreground">{tr("Send na Print havipunguzi stock.")}</p>
          {waiterOrderMode === "cashier"
            ? <Button onClick={() => void sendPlaced()}>{tr("Send")}</Button>
            : <Button variant="outline" disabled={!placedOrder} onClick={() => void printPlaced()}><Printer className="mr-1 h-4 w-4" />{tr("Print")}</Button>}
          <Button variant="ghost" onClick={() => setPlacedId(null)}>{tr("Funga")}</Button>
      </section>}

      {justSaved && <section className="space-y-2 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2 print:hidden"><h2 className="font-semibold">{tr("Invoice imehifadhiwa")}</h2><Button variant="outline" size="sm" onClick={() => setJustSaved(null)}>{tr("Funga")}</Button></div>
        <BillSheet kind="invoice" invoiceIds={[justSaved]} printToken={printToken} paper={paper} whatsappEnabled={whatsappEnabled} setWhatsappEnabled={changeWhatsapp} />
      </section>}
      {recent && (
        <>
          <div className="grid gap-3 sm:grid-cols-3"><Stat label={tr("Mauzo (siku 30)")} value={recent.totals.sales} /><Stat label={tr("Yaliyolipwa")} value={recent.totals.paid} /><Stat label={tr("Madeni")} value={recent.totals.outstanding} /></div>
          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{tr("Invoices za siku 30 zilizopita")}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!selected} onClick={() => { setJustSaved(null); setPrintToken((n) => n + 1); }}><Printer className="mr-1 h-4 w-4" />{tr("Chapisha invoice iliyochaguliwa")}</Button>
                {business?.isManager && <Button variant="outline" disabled={!selected || busy} onClick={() => { setJustSaved(null); setReturning(true); }}>{tr("Rejesha bidhaa (sehemu)")}</Button>}
                {business?.canVoidInvoice && <Button variant="destructive" disabled={!selected || busy} onClick={() => void cancelSelected()}>{tr("Batilisha invoice iliyochaguliwa")}</Button>}
              </div>
            </div>
            {!recent.invoices.length && <p className="text-sm text-muted-foreground">{tr("Hakuna invoice bado.")}</p>}
            {recent.invoices.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left">{["", tr("Invoice"), tr("Tarehe"), tr("Mteja"), tr("Jumla"), tr("Imelipwa"), tr("Deni"), tr("Hali")].map((h, i) => <th key={i} className="p-2">{h}</th>)}</tr></thead>
              <tbody>{recent.invoices.slice(0, 20).map((x) => {
                const id = String(x._id);
                return <tr key={id} className={`cursor-pointer border-b ${selected === id ? "bg-primary/10" : "hover:bg-muted/50"}`} onClick={() => { setSelected(id); setReturning(false); setJustSaved(null); setPrintToken(0); }}>
                  <td className="p-2"><input type="radio" name="picked-invoice" aria-label={x.invoiceNo} className="h-4 w-4 cursor-pointer accent-primary" checked={selected === id} onChange={() => { setSelected(id); setReturning(false); setJustSaved(null); setPrintToken(0); }} /></td>
                  <td className="p-2 font-medium">{x.invoiceNo}</td><td className="p-2">{x.date}</td><td className="p-2">{x.clientName}</td>
                  <td className="p-2 tabular-nums">{fmt(x.total)}</td><td className="p-2 tabular-nums">{fmt(x.amountPaid)}</td><td className="p-2 tabular-nums">{fmt(x.outstanding)}</td><td className="p-2">{x.paymentStatus}</td>
                </tr>;
              })}</tbody>
            </table></div>}
          </section>
          {selected && returning && <ReturnPanel key={selected} invoiceId={selected as Id<"invoices">} onClose={() => setReturning(false)} />}
          {selected && !justSaved && <section className="rounded-xl border p-4">
            <BillSheet kind="invoice" key={selected} invoiceIds={[selected as Id<"invoices">]} printToken={printToken} paper={paper} whatsappEnabled={whatsappEnabled} setWhatsappEnabled={changeWhatsapp} />
          </section>}
        </>
      )}
    </main>
  );
}
