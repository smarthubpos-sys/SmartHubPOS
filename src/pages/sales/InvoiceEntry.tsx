import { useMemo, useRef, useState } from "react";
import ServicePointFields from "@/components/ServicePointFields.tsx";
import { emptyServicePoint, formatServicePoint, serviceWords, type ServicePoint } from "@/lib/sales-flow.ts";
import { MessageCircle, Printer } from "lucide-react";
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
import { brandingFromSettings } from "@/lib/receipt-branding.ts";
import { printWaiterOrder, qzPrinterFrom } from "@/lib/print-waiter-order.ts";
import { whatsappOrderText, whatsappPhone, whatsappUrl } from "@/lib/whatsapp.ts";

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
  const business = useQuery(api.tenants.current);
  // Everyone sells here the same simple way as the Selling Point: pick the items, then "Send to cashier" or "Print".
  // The order goes to the cashier queue of the business / department the person is working in; the customer is optional.
  const me = useQuery(api.users.getCurrentUser);
  const submitOrder = useMutation(api.waiterOrders.submit);
  const orderKeyRef = useRef<string>(crypto.randomUUID()); // one key per cart: a repeated tap or retry cannot create a second order
  const [servicePoint, setServicePoint] = useState<ServicePoint>(emptyServicePoint());
  const tableNo = formatServicePoint(servicePoint, serviceWords());
  const settings = useQuery(api.maintenance.getSettings, {});
  const branding = brandingFromSettings(settings as Parameters<typeof brandingFromSettings>[0]);
  const allowNegative = !!settings?.company?.allowNegativeStock; // same switch the server uses (Maintenance > Company)

  const [clientId, setClientId] = useState(""); // optional: empty = "Mteja / Customer"
  const [date, setDate] = useState(today());
  const source = "Counter"; // the "where was it sold" choice was removed from the screen
  const [taxRate, setTaxRate] = useState("0");
  const [invoiceDiscount, setInvoiceDiscount] = useState("0");
  const hardware = (settings?.app?.hardware ?? {}) as { paperWidth?: string; autoPrintReceipt?: boolean; printerSource?: string; receiptPrinter?: string };
  const [notes, setNotes] = useState("");
  const [scan, setScan] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);

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

  const addByCode = () => {
    const code = scan.trim().toLowerCase();
    if (!code) return;
    const p = products.find((x) => x.onMenu !== false && ((x.barcode ?? "").toLowerCase() === code || x.itemCode.toLowerCase() === code));
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

  const DEFAULT_CUSTOMER = "Mteja / Customer";
  async function finishOrder(mode: "send" | "print", whatsapp = false) {
    if (busy) return;
    const used = lines.filter((l) => l.productId);
    if (!used.length) { toast.error(tr("Ongeza angalau bidhaa moja.")); return; }
    if (used.some((l) => !(num(l.qty) > 0))) { toast.error(tr("Quantity lazima iwe zaidi ya sifuri.")); return; }
    const customer = (clients ?? []).find((c) => String(c._id) === clientId);
    const customerName = customer?.name ?? DEFAULT_CUSTOMER;
    const waPhone = whatsapp ? whatsappPhone(customer?.phone) : "";
    if (whatsapp && !waPhone) { toast.error(tr("Chagua mteja mwenye namba ya simu ili kutuma WhatsApp.")); return; }
    // Price reductions: the line's own discount, plus the invoice discount shared over the lines in proportion to their value.
    const base = used.map((l) => { const gross = round2(num(l.qty) * (productById.get(l.productId)?.sellingPrice ?? 0)); return { gross, own: round2(num(l.discount)) }; });
    if (base.some((b) => b.own < 0 || b.own > b.gross + 1e-8)) { toast.error(tr("Punguzo la mstari si sahihi.")); return; }
    const netBase = round2(base.reduce((n, b) => n + b.gross - b.own, 0));
    const shared = Math.min(round2(num(invoiceDiscount)), netBase);
    let left = shared;
    const effective = base.map((b, i) => {
      const part = i === base.length - 1 ? left : netBase > 0 ? round2((shared * (b.gross - b.own)) / netBase) : 0;
      left = round2(left - part);
      return round2(b.own + part);
    });
    const priced = used.map((l, i) => ({ name: productById.get(l.productId)?.name ?? "", qty: num(l.qty), discount: effective[i], lineTotal: round2(base[i].gross - effective[i]) }));
    const orderTotal = round2(priced.reduce((n, l) => n + l.lineTotal, 0));
    // Opened now (inside the tap) so the browser does not block it; pointed at WhatsApp only after the order is saved.
    const waWindow = whatsapp ? window.open("", "_blank") : null;
    setBusy(true);
    try {
      const res = await submitOrder({ clientKey: orderKeyRef.current, mode, customerName, tableNumber: tableNo.trim() || undefined, notes: notes.trim() || undefined, lines: used.map((l, i) => ({ productId: l.productId as Id<"products">, qty: num(l.qty), discount: effective[i] > 0 ? effective[i] : undefined })) });
      toast.success(res.duplicate ? tr("Oda hii ilishachakatwa tayari. Stock haikupunguzwa tena.") : mode === "send" ? tr("Oda imetumwa kwa cashier. Stock imepunguzwa mara moja.") : tr("Oda imehifadhiwa. Stock imepunguzwa mara moja."));
      orderKeyRef.current = crypto.randomUUID();
      if (whatsapp) {
        if (res.duplicate) waWindow?.close();
        else {
          const link = whatsappUrl(waPhone, whatsappOrderText({ companyName: branding.companyName, customerName, tableNumber: tableNo.trim() || undefined, total: orderTotal, lines: priced, paymentInfo: branding.paymentInfo, footer: branding.footer }));
          if (waWindow) waWindow.location.href = link; else window.location.assign(link);
        }
      }
      setLines([emptyLine()]); setNotes(""); setServicePoint(emptyServicePoint()); setClientId(""); setInvoiceDiscount("0");
      if (mode === "print" && !res.duplicate) {
        const ok = await printWaiterOrder({ customerName, waiterName: me?.name ?? me?.username ?? "", tableNumber: tableNo.trim() || undefined, total: orderTotal, lines: priced.map((l) => ({ productName: l.name, qty: l.qty, lineTotal: l.lineTotal })) }, qzPrinterFrom(hardware), hardware.paperWidth, branding);
        if (!ok) toast.message(tr("Oda imehifadhiwa. Chapisha tena kupitia Bills (haipunguzi stock)."));
      }
    } catch (e) { waWindow?.close(); toast.error(errorText(e, "Imeshindikana kuchakata oda.")); }
    finally { setBusy(false); }
  }

  const submit = async () => {
    if (!clientId) { toast.error(tr("Chagua mteja kwa invoice ya mkopo.")); return; }
    const used = lines.filter((l) => l.productId);
    if (!used.length) { toast.error(tr("Ongeza angalau bidhaa moja.")); return; }
    for (const l of lines) {
      if (!l.productId) { toast.error(tr("Kila mstari uwe na bidhaa, au uondoe mstari mtupu.")); return; }
      if (!(num(l.qty) > 0)) { toast.error(tr("Quantity lazima iwe zaidi ya sifuri.")); return; }
      if (num(l.price) < 0 || num(l.discount) < 0 || num(l.discount) > num(l.qty) * num(l.price)) { toast.error(tr("Bei au discount ya mstari si sahihi.")); return; }
    }
    for (const [id, qty] of requested) {
      const p = productById.get(id);
      if (!allowNegative && p && !p.autoProduced && qty > p.currentQty + 1e-8) { toast.error(tr("Stock haitoshi kwa {0}. Iliyopo: {1}, unayouza: {2}", [p.name, fmt(p.currentQty, 4), fmt(qty, 4)])); return; }
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
      toast.success(tr("Invoice {0} imehifadhiwa — jumla {1}, deni {2}.", [r.invoiceNo, fmt(r.total), fmt(r.outstanding)]));
      if (r.creditWarning) toast.warning(tr("Onyo: mteja huyu amevuka kikomo chake cha mkopo."));
      setLines([emptyLine()]); setInvoiceDiscount("0"); setNotes("");
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuhifadhi invoice.")); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <Button variant="outline" onClick={() => navigate("/sales")}>{tr("← Sales")}</Button>
      <section className="rounded-xl border p-5">
        <h1 className="mb-1 text-2xl font-bold">{tr("Sales — uza bidhaa")}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{tr("Chagua bidhaa, kisha Send to cashier au Print. Mteja si lazima.")}</p>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-1 text-sm">{tr("Mteja / Customer (hiari)")}
            <select className={selectClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">{tr("Mteja / Customer")}</option>
              {clients.filter((c) => c.isActive).map((c) => <option key={c._id} value={c._id}>{c.name} ({c.code})</option>)}
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
                const over = p && !p.autoProduced ? (requested.get(l.productId) ?? 0) > p.currentQty + 1e-8 : false;
                return (
                  <tr key={i} className="border-b">
                    <td className="p-2">
                      <select className="h-10 min-w-52 rounded-md border bg-background px-2" value={l.productId} onChange={(e) => choose(i, e.target.value)}>
                        <option value="">{tr("-- Chagua bidhaa --")}</option>
                        {products.filter((x) => x.onMenu !== false || x._id === l.productId).map((x) => <option key={x._id} value={x._id}>{x.name} ({fmt(x.currentQty, 2)})</option>)}
                      </select>
                    </td>
                    <td className="p-2">{p?.unitId ? unitName.get(String(p.unitId)) ?? tr("Unit") : tr("Unit")}</td>
                    <td className={`p-2 tabular-nums ${over ? "font-semibold text-destructive" : ""}`}>{p ? fmt(p.currentQty, 4) : "—"}</td>
                    <td className="p-2"><Input className="w-24" type="number" step="any" min="0" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} /></td>
                    <td className="p-2 tabular-nums">{fmt(num(l.price))}</td>
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
          <label className="grid gap-1 text-sm">{tr("Discount ya invoice")}<Input className="w-40" type="number" step="any" min="0" value={invoiceDiscount} onChange={(e) => setInvoiceDiscount(e.target.value)} /></label>
          <div className="min-w-56 space-y-1 text-right text-sm">
            <div>{tr("Subtotal:")} <b className="tabular-nums">{fmt(subtotal)}</b></div>
            <div>{tr("Discount:")} <b className="tabular-nums">{fmt(Math.min(discount, subtotal))}</b></div>
            <div className="text-xl">{tr("Jumla:")} <b className="tabular-nums">{fmt(Math.max(0, round2(subtotal - discount)))}</b></div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <details className="text-sm"><summary className="cursor-pointer select-none py-2">{tr("Eneo la huduma (hiari)")}</summary><ServicePointFields value={servicePoint} onChange={setServicePoint} /></details>
          <Button disabled={busy} onClick={() => void finishOrder("send")}>{busy ? tr("Inachakata...") : tr("Send to cashier")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void finishOrder("print")}><Printer className="mr-1 h-4 w-4" />{busy ? tr("Inachakata...") : tr("Print")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void finishOrder("send", true)}><MessageCircle className="mr-1 h-4 w-4" />{busy ? tr("Inachakata...") : tr("Send WhatsApp")}</Button>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer select-none py-2 text-muted-foreground">{tr("Invoice ya mkopo (mteja lazima)")}</summary>
          <div className="flex flex-wrap items-end gap-3 pt-2">
            <label className="grid gap-1 text-sm">{tr("Tarehe")}<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="grid gap-1 text-sm">{tr("Tax (%)")}<Input type="number" step="any" min="0" max="100" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></label>
            <Button variant="outline" disabled={busy || !clientId} onClick={() => void submit()}>{busy ? tr("Inahifadhi…") : tr("Hifadhi Invoice")}</Button>
          </div>
        </details>
      </section>

      {recent && <div className="grid gap-3 sm:grid-cols-3"><Stat label={tr("Mauzo (siku 30)")} value={recent.totals.sales} /><Stat label={tr("Yaliyolipwa")} value={recent.totals.paid} /><Stat label={tr("Madeni")} value={recent.totals.outstanding} /></div>}
    </div>
  );
}
