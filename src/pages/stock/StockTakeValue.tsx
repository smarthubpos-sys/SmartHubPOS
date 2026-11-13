import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRange, ReportTable, Stat } from "@/pages/shared/report.tsx";
import { fmt, monthStart, num, round2, today } from "@/pages/shared/report-utils.ts";
import { errorText, tr } from "@/lib/i18n.ts";
import { printElement } from "@/lib/print-area.ts";
import { useStockRights } from "@/hooks/use-stock-rights.ts";

const selectClass = "h-10 rounded-md border bg-background px-3";
const loading = <div className="p-6 text-sm text-muted-foreground">{tr("Inapakia taarifa za stock…")}</div>;

/* ───────────────────────── Stock Taking (active): count, compare, correct ───────────────────────── */

/**
 * Count the shelves, type what was counted next to the system quantity, see the difference and its value straight away,
 * then save: every product whose count differs is corrected (a normal Quantity Adjustment with its ledger entry), all under one stock-take number.
 * People without the stock permission only see the history below.
 */
export function StockTakeScreen() {
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(today());
  const [appliedStart, setAppliedStart] = useState(monthStart());
  const [appliedEnd, setAppliedEnd] = useState(today());
  const data = useQuery(api.inventory.stockRegisters, { startDate: appliedStart, endDate: appliedEnd, light: true });
  const rights = useStockRights();
  const stockTake = useMutation(api.inventory.stockTake);
  const staff = useQuery(api.inventory.sellableStaff, {});
  const [sell, setSell] = useState(false);
  const [sellTo, setSellTo] = useState("");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [date, setDate] = useState(today());
  const [title, setTitle] = useState(tr("Stock take"));
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const products = useMemo(() => (data?.products ?? []).filter((p) => p.isActive), [data]);
  const lines = useMemo(() => products.map((p) => {
    const raw = counted[p._id];
    const has = raw !== undefined && raw !== "";
    const diff = has ? round2(num(raw) - p.currentQty) : 0;
    return { p, has, diff, value: round2(Math.abs(diff) * p.cost) };
  }), [products, counted]);

  if (!data || !rights.ready) return loading;

  const shown = lines.filter(({ p, diff, has }) => (!group || p.groupId === group)
    && (!search.trim() || `${p.name} ${p.itemCode} ${p.barcode}`.toLowerCase().includes(search.trim().toLowerCase()))
    && (!onlyDiff || (has && Math.abs(diff) > 1e-9)));
  const entered = lines.filter((l) => l.has);
  const different = entered.filter((l) => Math.abs(l.diff) > 1e-9);
  const shortage = round2(different.filter((l) => l.diff < 0).reduce((n, l) => n + l.value, 0));
  const overage = round2(different.filter((l) => l.diff > 0).reduce((n, l) => n + l.value, 0));
  const sellValue = round2(different.filter((l) => l.diff < 0).reduce((n, l) => n + Math.abs(l.diff) * l.p.sellingPrice, 0));
  const hasShortage = different.some((l) => l.diff < 0);
  const invalid = entered.some((l) => !(num(counted[l.p._id]) >= 0));

  const submit = async () => {
    if (!entered.length) { toast.error(tr("Weka angalau bidhaa moja uliyohesabu.")); return; }
    if (invalid) { toast.error(tr("Kuna kiasi kisicho sahihi; kiasi lazima kiwe sifuri au zaidi.")); return; }
    if (!title.trim()) { toast.error(tr("Weka jina au sababu ya stock take.")); return; }
    if (!different.length) { toast.info(tr("Hakuna tofauti: stock yote iliyohesabiwa inalingana na mfumo.")); return; }
    const sellName = staff?.find((u) => u._id === sellTo)?.name ?? "";
    if (sell && !sellTo) { toast.error(tr("Chagua mtumiaji atakayeuziwa upungufu.")); return; }
    if (sell && !hasShortage) { toast.error(tr("Hakuna upungufu wa kuuza: hakuna bidhaa iliyohesabiwa chini ya kiasi cha mfumo.")); return; }
    const confirmText = sell
      ? tr("Bidhaa {0} zitarekebishwa (upungufu {1}, ziada {2}). Upungufu wa {3} utauzwa kwa {4} kwa bei ya kuuzia; deni litaingia kwenye akaunti yake. Hatua hii haiwezi kutenguliwa. Endelea?", [different.length, fmt(shortage), fmt(overage), fmt(sellValue), sellName])
      : tr("Bidhaa {0} zitarekebishwa (upungufu {1}, ziada {2}). Hatua hii haiwezi kutenguliwa. Endelea?", [different.length, fmt(shortage), fmt(overage)]);
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await stockTake({ adjustmentDate: date, reason: title.trim(), lines: entered.map((l) => ({ productId: l.p._id as Id<"products">, counted: num(counted[l.p._id]) })), ...(sell && sellTo ? { sellShortageTo: sellTo as Id<"users"> } : {}) });
      toast.success(tr("Stock take {0} imehifadhiwa: bidhaa {1} zimerekebishwa.", [r.reference, r.adjusted]));
      if (r.soldInvoiceNo) toast.success(tr("Upungufu umeuzwa: {0}, jumla {1}, kwa {2}.", [r.soldInvoiceNo, fmt(r.soldTotal), sellName]));
      setCounted({}); setSell(false); setSellTo("");
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuhifadhi stock take.")); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">{tr("Stock Taking Report")}</h1>
      </div>

      {rights.canAdjust ? (
        <section className="space-y-4 rounded-xl border p-4">
          <div>
            <h2 className="font-semibold">{tr("Anza hesabu mpya ya stock (Stock Take)")}</h2>
            <p className="text-xs text-muted-foreground">{tr("Andika kiasi ulichohesabu kwa kila bidhaa. Bidhaa usiyoandika kiasi haibadilishwi. Mfumo unaonyesha tofauti na thamani yake papo hapo.")}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3 print:hidden">
            <label className="grid gap-1 text-xs">{tr("Jina / sababu ya stock take")}<Input className="w-64" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="grid gap-1 text-xs">{tr("Tarehe")}<Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
            <label className="grid gap-1 text-xs">{tr("Group")}
              <select className={selectClass} value={group} onChange={(e) => setGroup(e.target.value)}><option value="">{tr("Zote")}</option>{data.groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}</select>
            </label>
            <label className="grid gap-1 text-xs">{tr("Tafuta bidhaa")}<Input className="w-48" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("jina / code / barcode")} /></label>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />{tr("Zenye tofauti tu")}</label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={tr("Bidhaa zilizohesabiwa")} value={`${entered.length} / ${products.length}`} />
            <Stat label={tr("Zenye tofauti")} value={different.length} />
            <Stat label={tr("Thamani ya upungufu")} value={shortage} />
            <Stat label={tr("Thamani ya ziada")} value={overage} />
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => setCounted((o) => ({ ...o, ...Object.fromEntries(shown.filter((l) => !l.has).map(({ p }) => [p._id, String(p.currentQty)])) }))}>{tr("Jaza kiasi cha mfumo kwa zilizobaki")}</Button>
            <Button variant="outline" size="sm" onClick={() => setCounted({})}>{tr("Futa hesabu zote")}</Button>
            <Button variant="outline" size="sm" onClick={() => printElement(sheetRef.current, "A4")}><Printer className="mr-1 h-4 w-4" />{tr("Chapisha karatasi ya kuhesabia")}</Button>
            <Button size="sm" disabled={busy || !entered.length} onClick={() => void submit()}>{busy ? tr("Inahifadhi…") : tr("Hifadhi Stock Take")}</Button>
          </div>
          <div ref={sheetRef} className="max-h-[32rem] overflow-auto rounded-md border">
            <div className="hidden border-b p-2 text-sm font-semibold print:block">{title} — {date}</div>
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted/60"><tr>{[tr("Code"), tr("Bidhaa"), tr("Group"), tr("Mfumo"), tr("Iliyohesabiwa"), tr("Tofauti"), tr("Thamani ya tofauti")].map((h, i) => <th key={h} className={`p-2 font-semibold ${i >= 3 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={7} className="p-3 text-muted-foreground">{tr("Hakuna bidhaa inayolingana.")}</td></tr>}
                {shown.map(({ p, has, diff, value }) => (
                  <tr key={p._id} className="border-t">
                    <td className="p-2 text-muted-foreground">{p.itemCode}</td>
                    <td className="p-2 font-medium">{p.name}</td>
                    <td className="p-2 text-muted-foreground">{p.groupName}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(p.currentQty, 4)} {p.unitName}</td>
                    <td className="p-2 text-right"><Input className="ml-auto h-8 w-28 text-right print:border-b print:border-black" type="number" step="any" min="0" inputMode="decimal" value={counted[p._id] ?? ""} onChange={(e) => setCounted((o) => ({ ...o, [p._id]: e.target.value }))} aria-label={`${tr("Iliyohesabiwa")} ${p.name}`} /></td>
                    <td className={`p-2 text-right tabular-nums ${has && diff < 0 ? "text-destructive" : has && diff > 0 ? "text-emerald-700" : ""}`}>{has ? `${diff > 0 ? "+" : ""}${fmt(diff, 4)}` : ""}</td>
                    <td className={`p-2 text-right tabular-nums ${has && diff < 0 ? "text-destructive" : ""}`}>{has && diff !== 0 ? fmt(diff < 0 ? -value : value) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3 print:hidden">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={sell} onChange={(e) => setSell(e.target.checked)} />{tr("Uza upungufu (bei ya kuuzia)")}</label>
            <p className="text-xs text-muted-foreground">{tr("Bidhaa zenye upungufu zinauzwa kwa mtumiaji utakayemchagua, kwa bei ya kuuzia. Deni linaingia kwenye akaunti yake; cashier analipokea kupitia \"Pokea fedha za wahudumu\". Ziada haiuzwi: inaongezwa kwenye stock tu.")}</p>
            {sell && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-xs">{tr("Chagua mtumiaji")}
                  <select className={selectClass} value={sellTo} onChange={(e) => setSellTo(e.target.value)}><option value="">{tr("Chagua mtumiaji")}</option>{(staff ?? []).map((u) => <option key={u._id} value={u._id}>{u.name}{u.role ? ` (${u.role})` : ""}</option>)}</select>
                </label>
                <div className="pb-1 text-sm">{tr("Thamani ya upungufu kwa bei ya kuuzia")}: <span className="font-semibold tabular-nums">{fmt(sellValue)}</span></div>
              </div>
            )}
          </div>
        </section>
      ) : (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{tr("Huna ruhusa ya kubadili stock, kwa hiyo unaona historia ya stock take tu. Muombe Super Admin akupe ruhusa hii ili uweze kuhesabu.")}</p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">{tr("Historia ya stock take")}</h2><DateRange startDate={start} endDate={end} onStart={setStart} onEnd={setEnd} onApply={() => { setAppliedStart(start); setAppliedEnd(end); }} /></div>
      <ReportTable title={tr("Hesabu (count) dhidi ya mfumo")} sumCols={[tr("Tofauti"), tr("Thamani ya tofauti")]} note={tr("Kila stock take na kila Quantity Adjustment inaonekana hapa: 'Mfumo' ni idadi kabla ya kurekebisha na 'Iliyohesabiwa' ni idadi mpya. Stock take moja ina namba moja (ST-…).")}
        rows={data.adjustments.map((x) => ({ Tarehe: x.date, "Stock take": x.reference || "—", Code: x.itemCode, Bidhaa: x.productName, Mfumo: x.qtyBefore, Iliyohesabiwa: x.counted, Tofauti: x.difference, "Thamani ya tofauti": round2(x.difference * x.cost), Sababu: x.reason }))} />
    </div>
  );
}

/* ───────────────────────── Stock Value Report ───────────────────────── */

export function StockValueScreen() {
  const data = useQuery(api.inventory.stockRegisters, { light: true });
  const [group, setGroup] = useState("");
  const [withStock, setWithStock] = useState(true);
  if (!data) return loading;
  const list = data.products.filter((p) => p.isActive && (!group || p.groupId === group) && (!withStock || p.currentQty > 0)).sort((a, b) => b.stockValue - a.stockValue);
  const cost = round2(list.reduce((n, p) => n + p.stockValue, 0));
  const retail = round2(list.reduce((n, p) => n + p.retailValue, 0));
  const byGroup = new Map<string, { name: string; items: number; cost: number; retail: number }>();
  for (const p of list) { const g = byGroup.get(p.groupName) ?? { name: p.groupName, items: 0, cost: 0, retail: 0 }; g.items += 1; g.cost = round2(g.cost + p.stockValue); g.retail = round2(g.retail + p.retailValue); byGroup.set(p.groupName, g); }
  const share = (n: number) => (cost > 0 ? round2((n / cost) * 100) : 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">{tr("Stock Value Report")}</h1>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <label className="grid gap-1 text-xs">{tr("Group")}
            <select className={selectClass} value={group} onChange={(e) => setGroup(e.target.value)}><option value="">{tr("Zote")}</option>{data.groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}</select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={withStock} onChange={(e) => setWithStock(e.target.checked)} />{tr("Zenye stock tu")}</label>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={tr("Thamani ya stock (cost)")} value={cost} />
        <Stat label={tr("Thamani ya kuuza (bei)")} value={retail} />
        <Stat label={tr("Faida inayotarajiwa")} value={round2(retail - cost)} />
        <Stat label={tr("Bidhaa zenye stock")} value={list.length} />
      </div>
      <ReportTable title={tr("Thamani kwa group")} sumCols={[tr("Bidhaa"), tr("Thamani (cost)"), tr("Thamani (bei)")]}
        rows={[...byGroup.values()].sort((a, b) => b.cost - a.cost).map((g) => ({ Group: g.name, Bidhaa: g.items, "Thamani (cost)": g.cost, "Thamani (bei)": g.retail, "% ya jumla": share(g.cost) }))} />
      <ReportTable title={tr("Thamani ya stock kwa bidhaa")} sumCols={[tr("Thamani (cost)"), tr("Thamani (bei)"), tr("Faida inayotarajiwa")]}
        note={tr("Thamani ya cost inatumia gharama ya wastani (weighted average) ya kila bidhaa; thamani ya bei inatumia bei ya kuuzia. Bidhaa zimepangwa kuanzia yenye thamani kubwa.")}
        rows={list.map((p) => ({ Code: p.itemCode, Bidhaa: p.name, Group: p.groupName, Unit: p.unitName, Stock: p.currentQty, Cost: p.cost, "Thamani (cost)": p.stockValue, "Bei ya kuuzia": p.sellingPrice, "Thamani (bei)": p.retailValue, "Faida inayotarajiwa": round2(p.retailValue - p.stockValue), "% ya jumla": share(p.stockValue) }))} />
    </div>
  );
}
