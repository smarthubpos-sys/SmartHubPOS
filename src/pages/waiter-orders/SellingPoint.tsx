import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tr, errorText } from "@/lib/i18n.ts";
import { brandingFromSettings } from "@/lib/receipt-branding.ts";
import ServicePointFields from "@/components/ServicePointFields.tsx";
import { emptyServicePoint, filterProducts, formatServicePoint, serviceWords, type ServicePoint } from "@/lib/sales-flow.ts";
import { printWaiterOrder, qzPrinterFrom } from "@/lib/print-waiter-order.ts";
import { printPaymentReceipt } from "@/lib/print-payment-receipt.ts";
import { usePaymentMethods } from "@/hooks/use-payment-methods.ts";
import PaymentSplit from "@/components/PaymentSplit.tsx";
import { newSplitLine, splitsTotal, toSplits, type SplitLine } from "@/lib/payment-split.ts";
import { PRINT_RECEIPT_KEY, readPrintReceiptChoice } from "@/lib/print-receipt-choice.ts";

const money = (n: number) => Number(n).toLocaleString();
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const GROUP_STYLES = [
  { tab: "border-sky-300 bg-sky-100 text-sky-950 hover:bg-sky-200", tile: "border-sky-200 bg-sky-50 hover:bg-sky-100", active: "border-sky-500 bg-sky-100 ring-1 ring-sky-300" },
  { tab: "border-emerald-300 bg-emerald-100 text-emerald-950 hover:bg-emerald-200", tile: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100", active: "border-emerald-500 bg-emerald-100 ring-1 ring-emerald-300" },
  { tab: "border-violet-300 bg-violet-100 text-violet-950 hover:bg-violet-200", tile: "border-violet-200 bg-violet-50 hover:bg-violet-100", active: "border-violet-500 bg-violet-100 ring-1 ring-violet-300" },
  { tab: "border-amber-300 bg-amber-100 text-amber-950 hover:bg-amber-200", tile: "border-amber-200 bg-amber-50 hover:bg-amber-100", active: "border-amber-500 bg-amber-100 ring-1 ring-amber-300" },
  { tab: "border-rose-300 bg-rose-100 text-rose-950 hover:bg-rose-200", tile: "border-rose-200 bg-rose-50 hover:bg-rose-100", active: "border-rose-500 bg-rose-100 ring-1 ring-rose-300" },
  { tab: "border-teal-300 bg-teal-100 text-teal-950 hover:bg-teal-200", tile: "border-teal-200 bg-teal-50 hover:bg-teal-100", active: "border-teal-500 bg-teal-100 ring-1 ring-teal-300" },
];
const groupStyle = (id: string, groups: Array<{ _id: unknown }>) => {
  if (id === "all") return GROUP_STYLES[0];
  const index = groups.findIndex((g) => String(g._id) === id);
  return GROUP_STYLES[(Math.max(0, index) + 1) % GROUP_STYLES.length];
};

/**
 * Selling Point: product groups -> product tiles -> cart. Tap = +1. Send / Print create the order AND deduct stock once (server-guarded).
 * `counter` = the cashier sells to his own walk-in customer. He uses Send / Print exactly like a waiter: the order is saved under HIS name
 * for the invoice amount and he receives the money later (Cashier > receive money, picking his own name). Taking the payment right now
 * is optional (collapsed section): one or many methods, the sale is booked at once, and he may print a payment receipt.
 */
export default function SellingPoint({ counter = false }: { counter?: boolean } = {}) {
  const products = useQuery(api.products.listActive);
  const groups = useQuery(api.products.listGroups);
  const user = useQuery(api.users.getCurrentUser);
  const settings = useQuery(api.maintenance.getSettings, {});
  const branding = brandingFromSettings(settings as Parameters<typeof brandingFromSettings>[0]);
  const submit = useMutation(api.waiterOrders.submit);
  const counterSale = useMutation(api.waiterCollections.counterSale);
  const methods = usePaymentMethods();
  const [payLines, setPayLines] = useState<SplitLine[]>(() => [newSplitLine(methods)]);
  const [printReceipt, setPrintReceipt] = useState<boolean>(readPrintReceiptChoice);
  const hardware = (settings?.app?.hardware ?? {}) as { printerSource?: string; receiptPrinter?: string; paperWidth?: string };

  const [groupId, setGroupId] = useState<string>("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [servicePoint, setServicePoint] = useState<ServicePoint>(emptyServicePoint());
  const [query, setQuery] = useState(""); // optional: name / item code / barcode (scanner types the code and presses Enter)
  const table = formatServicePoint(servicePoint, serviceWords());
  const [clientKey, setClientKey] = useState(newKey); // one key per cart: a repeated tap/retry cannot create a second order
  const [busy, setBusy] = useState(false);


  const activeGroups = useMemo(() => (groups ?? []).filter((g) => g.isActive !== false), [groups]);
  const shown = useMemo(() => filterProducts((products ?? []).filter((p) => p.onMenu !== false), { groupId, query }), [products, groupId, query]);
  const byId = useMemo(() => new Map((products ?? []).map((p) => [String(p._id), p])), [products]);
  const lines = Object.entries(cart).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty, p: byId.get(id) })).filter((l) => !!l.p);
  const total = lines.reduce((s, l) => s + l.qty * (l.p?.sellingPrice ?? 0), 0);
  const locked = busy;

  const add = (id: string, d: number) => { if (locked) return; setCart((c) => { const q = Math.max(0, (c[id] ?? 0) + d); const { [id]: _drop, ...rest } = c; return q > 0 ? { ...c, [id]: q } : rest; }); };

  async function finish(mode: "send" | "print") {
    if (locked || lines.length === 0) return;
    setBusy(true);
    try {
      const res = await submit({ clientKey, mode, tableNumber: table.trim() || undefined, lines: lines.map((l) => ({ productId: l.id as Id<"products">, qty: l.qty })) });
      toast.success(res.duplicate ? tr("Oda hii ilishachakatwa tayari. Stock haikupunguzwa tena.") : counter ? tr("Oda imehifadhiwa kwenye akaunti yako. Pokea malipo baadaye kupitia \"Pokea fedha za wahudumu\". Stock imepunguzwa mara moja.") : mode === "send" ? tr("Oda imetumwa kwa cashier. Stock imepunguzwa mara moja.") : tr("Oda imehifadhiwa. Stock imepunguzwa mara moja."));
      // Clear the waiter workspace after the server confirms the order was saved.
      // The persisted order remains available in the cashier queue / Bills; failed submits keep the cart.
      setCart({});
      setServicePoint(emptyServicePoint());
      setQuery("");
      setClientKey(newKey());
      if (mode === "print" && !res.duplicate) {
        const ok = await printWaiterOrder({ customerName: "", waiterName: user?.name ?? user?.username ?? "", tableNumber: table.trim() || undefined, total, lines: lines.map((l) => ({ productName: l.p!.name, qty: l.qty, lineTotal: l.qty * l.p!.sellingPrice })) }, qzPrinterFrom(hardware), hardware.paperWidth, branding);
        if (!ok) toast.message(tr("Oda imehifadhiwa. Chapisha tena kupitia Bills (haipunguzi stock)."));
      }
    } catch (e) {
      toast.error(errorText(e, tr("Imeshindikana kuchakata oda.")));
    } finally { setBusy(false); }
  }

  // One payment line left empty = "all of it" (cash by default), so a simple cash sale needs no typing.
  const effectivePay: SplitLine[] = payLines.length === 1 && splitsTotal(payLines) === 0 ? [{ ...payLines[0], amount: String(total) }] : payLines;
  const paidNow = splitsTotal(effectivePay);
  const canCounterSell = !locked && lines.length > 0 && Math.abs(paidNow - total) < 0.005;

  async function sellAtCounter() {
    if (!canCounterSell) return;
    setBusy(true);
    try {
      const splits = toSplits(effectivePay, methods);
      const res = await counterSale({ clientKey, tableNumber: table.trim() || undefined, lines: lines.map((l) => ({ productId: l.id as Id<"products">, qty: l.qty })), splits: splits as never });
      toast.success(res.duplicate ? tr("Mauzo haya yalishachakatwa tayari. Stock haikupunguzwa tena.") : tr("Mauzo yamehifadhiwa na fedha zimepokelewa. Stock imepunguzwa mara moja."));
      const sold = lines.map((l) => ({ name: l.p!.name, qty: l.qty, amount: l.qty * l.p!.sellingPrice }));
      const tableNo = table.trim() || undefined;
      setCart({}); setServicePoint(emptyServicePoint()); setQuery(""); setClientKey(newKey()); setPayLines([newSplitLine(methods)]);
      if (printReceipt && !res.duplicate) {
        const ok = await printPaymentReceipt({ receiptNo: String(res.collectionId ?? "").slice(-6).toUpperCase() || undefined, cashierName: user?.name ?? user?.username ?? "", tableNumber: tableNo, items: sold, payments: splits.map((p) => ({ method: p.method, amount: p.amount })), total: res.total }, qzPrinterFrom(hardware), hardware.paperWidth, branding);
        if (!ok) toast.message(tr("Mauzo yamehifadhiwa. Risiti haikuchapishwa; unaweza kuichapa tena kupitia Cashier > Zilizopokelewa leo."));
      }
    } catch (e) {
      toast.error(errorText(e, tr("Imeshindikana kuchakata mauzo. Hakuna kilichorekodiwa.")));
    } finally { setBusy(false); }
  }

  function reset() { setCart({}); setServicePoint(emptyServicePoint()); setQuery(""); setClientKey(newKey()); setGroupId("all"); }

  return (
    <section className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
      <div className="min-w-0 space-y-2">
        <Input value={query} disabled={locked} placeholder={tr("Tafuta bidhaa au scan code")} aria-label={tr("Tafuta bidhaa au scan code")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const code = query.trim().toLowerCase();
            const hit = code ? (products ?? []).find((p) => p.onMenu !== false && ((p.barcode ?? "").toLowerCase() === code || (p.itemCode ?? "").toLowerCase() === code)) : undefined;
            if (hit) { add(String(hit._id), 1); setQuery(""); } else if (code && shown.length !== 1) toast.error(tr("Bidhaa haijapatikana."));
            else if (shown.length === 1) { add(String(shown[0]._id), 1); setQuery(""); }
          }} />
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={tr("Makundi ya bidhaa")}>
          {[{ _id: "all", name: tr("Zote") }, ...activeGroups].map((g) => {
            const id = String(g._id);
            const style = groupStyle(id, activeGroups);
            return <button key={id} type="button" role="tab" aria-selected={groupId === id} onClick={() => setGroupId(id)}
              className={`min-h-9 shrink-0 rounded-lg border px-3 py-1.5 text-sm font-bold transition ${style.tab} ${groupId === id ? "ring-2 ring-offset-1 shadow-sm" : "opacity-80"}`}>{g.name}</button>;
          })}
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
          {shown.map((p) => {
            const q = cart[String(p._id)] ?? 0;
            const style = groupStyle(groupId, activeGroups);
            return (
              <button key={p._id} type="button" disabled={locked} onClick={() => add(String(p._id), 1)}
                className={`relative flex min-h-[52px] min-w-0 flex-col justify-between rounded-lg border p-1.5 text-left transition active:scale-[0.98] disabled:opacity-60 ${q ? style.active : style.tile}`}>
                <span className="line-clamp-2 break-words text-xs font-semibold leading-tight">{p.name}</span>
                <span className="mt-1 text-[11px] font-medium text-muted-foreground">{money(p.sellingPrice)}</span>
                {q > 0 && <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 text-[11px] leading-4 font-bold text-primary-foreground">{q}</span>}
              </button>
            );
          })}
          {products && shown.length === 0 && <p className="col-span-full rounded-xl border p-5 text-sm text-muted-foreground">{tr("Hakuna bidhaa kwenye kundi hili.")}</p>}
        </div>
      </div>

      <aside className="h-fit min-w-0 space-y-2 rounded-2xl border bg-card p-3 shadow-sm md:sticky md:top-2">
        <h2 className="text-lg font-bold">{tr("Oda ya sasa")}</h2>
        <ul className="max-h-[38vh] space-y-2 overflow-y-auto pr-1">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-medium">{l.p!.name}</div><div className="text-xs text-muted-foreground">{money(l.p!.sellingPrice)} × {l.qty} = {money(l.p!.sellingPrice * l.qty)}</div></div>
              <div className="flex shrink-0 items-center gap-1">
                <Button type="button" size="icon" variant="outline" className="h-10 w-10" disabled={locked} aria-label={tr("Punguza")} onClick={() => add(l.id, -1)}>−</Button>
                <span className="w-8 text-center font-bold tabular-nums">{l.qty}</span>
                <Button type="button" size="icon" variant="outline" className="h-10 w-10" disabled={locked} aria-label={tr("Ongeza")} onClick={() => add(l.id, 1)}>+</Button>
              </div>
            </li>
          ))}
          {lines.length === 0 && <li className="text-sm text-muted-foreground">{tr("Gusa bidhaa kuiongeza kwenye oda.")}</li>}
        </ul>
        <label className="grid gap-1 text-sm">{tr("Namba ya meza (hiari)")}
          <Input value={servicePoint.name} maxLength={40} disabled={locked} placeholder={tr("Mf. 5 (acha wazi kama haihitajiki)")} aria-label={tr("Namba ya meza (hiari)")}
            onChange={(e) => setServicePoint({ ...servicePoint, name: e.target.value })} />
        </label>
        <details className="text-sm"><summary className="cursor-pointer select-none py-2">{tr("Zaidi: ghorofa / chumba (hiari)")}</summary>
          <ServicePointFields className="grid gap-3" value={servicePoint} disabled={locked} onChange={setServicePoint} />
        </details>
        <p className="text-xl font-bold">{tr("Jumla")}: {money(total)}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" className="h-10 text-sm" disabled={locked || lines.length === 0} onClick={() => void finish("send")}>{busy ? tr("Inachakata...") : tr("Send")}</Button>
          <Button type="button" variant="outline" className="h-10 text-sm" disabled={locked || lines.length === 0} onClick={() => void finish("print")}>{busy ? tr("Inachakata...") : tr("Print")}</Button>
        </div>
        {counter && <>
          <p className="text-xs text-muted-foreground">{tr("Oda inaingia kwenye akaunti yako (jina lako) kwa kiasi cha invoice. Hulazimiki kulipa sasa: utapokea malipo baadaye kupitia \"Pokea fedha za wahudumu\".")}</p>
          <details className="rounded-lg border p-2 text-sm">
            <summary className="cursor-pointer select-none py-1 font-medium">{tr("Mteja amelipa papo hapo? (hiari)")}</summary>
            <div className="space-y-2 pt-2">
              <PaymentSplit methods={methods} lines={payLines} onChange={setPayLines} due={total} disabled={locked} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={printReceipt} onChange={(e) => { setPrintReceipt(e.target.checked); try { localStorage.setItem(PRINT_RECEIPT_KEY, e.target.checked ? "1" : "0"); } catch { /* remembering the choice is optional */ } }} />{tr("Chapisha risiti ya malipo")}</label>
              <Button type="button" variant="outline" className="h-11 w-full text-sm" disabled={!canCounterSell} onClick={() => void sellAtCounter()}>{busy ? tr("Inachakata...") : tr("Uza na pokea malipo")}</Button>
            </div>
          </details>
        </>}
      </aside>
    </section>
  );
}
