import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SearchSelect from "@/components/SearchSelect.tsx";
import PurchaseOrderSheet from "@/pages/purchasing/PurchaseOrderSheet.tsx";
import { tr, errorText } from "@/lib/i18n.ts";
import { localDate } from "@/lib/format.ts";

type Line = { productId: string; qty: string; unitCost: string; total: string };
const num = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };

/**
 * Purchase Order opens exactly like Purchase Entry: supplier, date, then EVERY product in one table. Fill the quantity you order
 * (rows left empty or zero are not saved). After saving, the order is shown as a sheet you can Print / save as PDF or save to Excel.
 */
export default function PurchaseOrderEntry({ onSaved }: { onSaved?: () => void }) {
  const products = useQuery(api.products.listActive, {});
  const suppliers = useQuery(api.suppliers.list, {});
  const units = useQuery(api.products.listUnits, {});
  const createOrder = useMutation(api.purchasing.createPurchaseOrder);
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(() => localDate());
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [edits, setEdits] = useState<Record<string, Partial<Pick<Line, "qty" | "unitCost">>>>({}); // what the person typed, per product; every other row comes straight from the product list
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ id: Id<"purchaseOrders">; ref: string } | null>(null);

  const lines: Line[] = useMemo(() => (products ?? []).map((p) => {
    const id = String(p._id), e = edits[id] ?? {};
    const qty = e.qty ?? "", unitCost = e.unitCost ?? String(p.lastPurchaseCost ?? p.weightedAvgCost ?? 0);
    return { productId: id, qty, unitCost, total: String(num(qty) * num(unitCost)) };
  }), [products, edits]);

  const active = lines.filter((l) => num(l.qty) > 0);
  const grand = active.reduce((s, l) => s + num(l.qty) * num(l.unitCost), 0);
  const patch = (i: number, p: Partial<Pick<Line, "qty" | "unitCost">>) => setEdits((old) => ({ ...old, [lines[i].productId]: { ...old[lines[i].productId], ...p } }));

  async function save() {
    if (busy) return;
    if (!supplierId) { toast.error(tr("Chagua supplier wa order hii.")); return; }
    if (!active.length) { toast.error(tr("Weka kiasi cha angalau bidhaa moja.")); return; }
    if (active.some((l) => !(num(l.unitCost) >= 0))) { toast.error(tr("Gharama ya bidhaa si sahihi.")); return; }
    setBusy(true);
    try {
      const res = await createOrder({
        supplierId: supplierId as Id<"suppliers">, orderDate, expectedDelivery: expected || undefined, notes: notes.trim() || undefined,
        lines: active.map((l) => ({ productId: l.productId as Id<"products">, qty: num(l.qty), unitCost: num(l.unitCost) })),
      });
      toast.success(tr("Purchase Order {0} imehifadhiwa.", [res.orderRef]));
      setSaved({ id: res.orderId, ref: res.orderRef });
      setEdits((old) => Object.fromEntries(Object.entries(old).map(([k, v]) => [k, { unitCost: v.unitCost }]))); setNotes(""); setExpected("");
      onSaved?.();
    } catch (e) {
      toast.error(errorText(e, tr("Imeshindikana kuhifadhi order. Hakuna kilichorekodiwa; jaribu tena.")));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-5">
        <h2 className="mb-2 text-lg font-semibold">{tr("Purchase Order — agiza bidhaa")}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{tr("Bidhaa zote zinaonekana kwenye jedwali. Jaza kiasi unachoagiza tu; mistari yenye kiasi tupu au sifuri haitahifadhiwa.")}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">{tr("Supplier")}
            <SearchSelect value={supplierId} onChange={setSupplierId} placeholder={tr("Chagua supplier")}
              options={(suppliers ?? []).filter((x) => x.isActive || String(x._id) === supplierId).map((x) => ({ value: String(x._id), label: x.name, hint: [x.code, x.phone].filter(Boolean).join(" · ") }))} />
          </label>
          <label className="grid gap-1 text-sm">{tr("Tarehe")}<Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">{tr("Tarehe ya kupokea (hiari)")}<Input type="date" value={expected} min={orderDate} onChange={(e) => setExpected(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">{tr("Maelezo (hiari)")}<Input value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b text-left"><th className="p-2">{tr("Bidhaa")}</th><th className="p-2">{tr("Unit")}</th><th className="p-2">{tr("Stock ya sasa")}</th><th className="p-2">{tr("Quantity ya kuagiza")}</th><th className="p-2">{tr("Cost")}</th><th className="p-2 text-right">{tr("Total")}</th></tr></thead>
            <tbody>
              {lines.map((line, i) => {
                const p = (products ?? []).find((x) => String(x._id) === line.productId);
                return (
                  <tr key={line.productId} className="border-b">
                    <td className="p-2 font-medium">{p?.name ?? "—"}</td>
                    <td className="p-2">{units?.find((u) => u._id === p?.unitId)?.name ?? tr("Unit")}</td>
                    <td className="p-2">{p?.currentQty ?? 0}</td>
                    <td className="p-2"><Input aria-label={tr("Quantity {0}", [p?.name ?? i + 1])} className="w-28" type="number" min="0" step="any" placeholder="0" value={line.qty} onChange={(e) => patch(i, { qty: e.target.value })} /></td>
                    <td className="p-2"><Input aria-label={tr("Cost ya {0}", [p?.name ?? i + 1])} className="w-28" type="number" min="0" step="any" value={line.unitCost} onChange={(e) => patch(i, { unitCost: e.target.value })} /></td>
                    <td className="p-2 text-right tabular-nums">{(num(line.qty) * num(line.unitCost)).toLocaleString("en-US")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">{tr("Bidhaa zitakazoagizwa")}: {active.length}</div>
          <div className="text-right"><div className="text-sm text-muted-foreground">{tr("Jumla ya order")}</div><div className="text-xl font-bold">{grand.toLocaleString("en-US")}</div></div>
        </div>
        <div className="mt-4"><Button disabled={busy} onClick={() => void save()}>{busy ? tr("Inahifadhi…") : tr("Hifadhi order")}</Button></div>
      </section>
      {saved && (
        <section className="space-y-2 rounded-xl border p-4">
          <p className="text-sm font-semibold">{tr("Order {0} imehifadhiwa. Ihifadhi kama PDF au Excel (Print / PDF, Save to Excel) kisha mtumie supplier.", [saved.ref])}</p>
          <PurchaseOrderSheet orderId={saved.id} />
        </section>
      )}
    </div>
  );
}
