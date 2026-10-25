import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tr, errorText } from "@/lib/i18n.ts";
import ServicePointFields from "@/components/ServicePointFields.tsx";
import { emptyServicePoint, filterProducts, formatServicePoint, serviceWords, type ServicePoint } from "@/lib/sales-flow.ts";
import { printWaiterOrder } from "@/lib/print-waiter-order.ts";

const money = (n: number) => Number(n).toLocaleString();
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const STATUS: Record<string, string> = { pending: "Imetumwa kwa cashier", printed: "Imechapishwa" };

/** Selling Point: product groups -> product tiles -> cart. Tap = +1. Send / Print create the order AND deduct stock once (server-guarded). */
export default function SellingPoint() {
  const products = useQuery(api.products.listActive);
  const groups = useQuery(api.products.listGroups);
  const user = useQuery(api.users.getCurrentUser);
  const settings = useQuery(api.maintenance.getSettings, {});
  const submit = useMutation(api.waiterOrders.submit);
  const hardware = (settings?.app?.hardware ?? {}) as { printerSource?: string; receiptPrinter?: string; paperWidth?: string };

  const [groupId, setGroupId] = useState<string>("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [servicePoint, setServicePoint] = useState<ServicePoint>(emptyServicePoint());
  const [query, setQuery] = useState(""); // optional: name / item code / barcode (scanner types the code and presses Enter)
  const table = formatServicePoint(servicePoint, serviceWords());
  const [clientKey, setClientKey] = useState(newKey); // one key per cart: a repeated tap/retry cannot create a second order
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ orderId: string; status: string } | null>(null);

  const activeGroups = useMemo(() => (groups ?? []).filter((g) => g.isActive !== false), [groups]);
  const shown = useMemo(() => filterProducts(products ?? [], { groupId, query }), [products, groupId, query]);
  const byId = useMemo(() => new Map((products ?? []).map((p) => [String(p._id), p])), [products]);
  const lines = Object.entries(cart).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty, p: byId.get(id) })).filter((l) => !!l.p);
  const total = lines.reduce((s, l) => s + l.qty * (l.p?.sellingPrice ?? 0), 0);
  const locked = busy || done !== null;

  const add = (id: string, d: number) => { if (locked) return; setCart((c) => { const q = Math.max(0, (c[id] ?? 0) + d); const { [id]: _drop, ...rest } = c; return q > 0 ? { ...c, [id]: q } : rest; }); };

  async function finish(mode: "send" | "print") {
    if (locked || lines.length === 0) return;
    setBusy(true);
    try {
      const res = await submit({ clientKey, mode, tableNumber: table.trim() || undefined, lines: lines.map((l) => ({ productId: l.id as Id<"products">, qty: l.qty })) });
      setDone({ orderId: String(res.orderId), status: res.status });
      toast.success(res.duplicate ? tr("Oda hii ilishachakatwa tayari. Stock haikupunguzwa tena.") : mode === "send" ? tr("Oda imetumwa. Stock imepunguzwa mara moja.") : tr("Oda imehifadhiwa. Stock imepunguzwa mara moja."));
      if (mode === "print" && !res.duplicate) {
        const ok = await printWaiterOrder({ customerName: "", waiterName: user?.name ?? user?.username ?? "", tableNumber: table.trim() || undefined, total, lines: lines.map((l) => ({ productName: l.p!.name, qty: l.qty, lineTotal: l.qty * l.p!.sellingPrice })) }, hardware.printerSource === "installed" ? hardware.receiptPrinter : undefined, hardware.paperWidth);
        if (!ok) toast.message(tr("Oda imehifadhiwa. Chapisha tena kupitia Bills (haipunguzi stock)."));
      }
    } catch (e) {
      toast.error(errorText(e, tr("Imeshindikana kuchakata oda.")));
    } finally { setBusy(false); }
  }

  function reset() { setCart({}); setServicePoint(emptyServicePoint()); setQuery(""); setDone(null); setClientKey(newKey()); setGroupId("all"); }

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <Input value={query} disabled={locked} placeholder={tr("Tafuta bidhaa au scan code")} aria-label={tr("Tafuta bidhaa au scan code")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const code = query.trim().toLowerCase();
            const hit = code ? (products ?? []).find((p) => (p.barcode ?? "").toLowerCase() === code || (p.itemCode ?? "").toLowerCase() === code) : undefined;
            if (hit) { add(String(hit._id), 1); setQuery(""); } else if (code && shown.length !== 1) toast.error(tr("Bidhaa haijapatikana."));
            else if (shown.length === 1) { add(String(shown[0]._id), 1); setQuery(""); }
          }} />
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={tr("Makundi ya bidhaa")}>
          {[{ _id: "all", name: tr("Zote") }, ...activeGroups].map((g) => (
            <button key={String(g._id)} type="button" role="tab" aria-selected={groupId === String(g._id)} onClick={() => setGroupId(String(g._id))}
              className={`min-h-12 shrink-0 rounded-2xl border px-5 text-base font-semibold transition ${groupId === String(g._id) ? "bg-primary text-primary-foreground shadow" : "bg-card hover:bg-muted"}`}>{g.name}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => {
            const q = cart[String(p._id)] ?? 0;
            return (
              <button key={p._id} type="button" disabled={locked} onClick={() => add(String(p._id), 1)}
                className={`relative flex min-h-24 flex-col justify-between rounded-2xl border p-3 text-left shadow-sm transition active:scale-95 disabled:opacity-60 ${q ? "border-primary bg-primary/10" : "bg-card hover:bg-muted"}`}>
                <span className="line-clamp-2 text-base font-semibold">{p.name}</span>
                <span className="text-sm text-muted-foreground">{money(p.sellingPrice)}</span>
                {q > 0 && <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">{q}</span>}
              </button>
            );
          })}
          {products && shown.length === 0 && <p className="col-span-full rounded-xl border p-5 text-sm text-muted-foreground">{tr("Hakuna bidhaa kwenye kundi hili.")}</p>}
        </div>
      </div>

      <aside className="h-fit space-y-3 rounded-2xl border bg-card p-4 shadow-sm lg:sticky lg:top-3">
        <h2 className="text-lg font-bold">{tr("Oda ya sasa")}</h2>
        <ul className="space-y-2">
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
        <details className="text-sm"><summary className="cursor-pointer select-none py-2">{tr("Eneo la huduma (hiari)")}</summary>
          <ServicePointFields className="grid gap-3" value={servicePoint} disabled={locked} onChange={setServicePoint} />
        </details>
        <p className="text-xl font-bold">{tr("Jumla")}: {money(total)}</p>
        {done ? (
          <div className="space-y-2" role="status">
            <p className="rounded-lg bg-green-100 p-3 text-sm font-semibold text-green-900">{tr("Hali")}: {tr(STATUS[done.status] ?? done.status)} · {tr("Stock imepunguzwa mara moja")}</p>
            <Button type="button" className="h-12 w-full" onClick={reset}>{tr("Oda mpya")}</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" className="h-12 text-base" disabled={locked || lines.length === 0} onClick={() => void finish("send")}>{busy ? tr("Inachakata...") : tr("Send")}</Button>
            <Button type="button" variant="outline" className="h-12 text-base" disabled={locked || lines.length === 0} onClick={() => void finish("print")}>{busy ? tr("Inachakata...") : tr("Print")}</Button>
          </div>
        )}
      </aside>
    </section>
  );
}
