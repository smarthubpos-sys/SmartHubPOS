import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRange, ReportTable, Stat } from "@/pages/shared/report.tsx";
import { fmt, monthStart, num, round2, today, type Row } from "@/pages/shared/report-utils.ts";
import { tr, errorText, trValue } from "@/lib/i18n.ts";
import { printElement } from "@/lib/print-area.ts";
import { useStockRights } from "@/hooks/use-stock-rights.ts";

const selectClass = "h-10 rounded-md border bg-background px-3";
const loading = <div className="p-6 text-sm text-muted-foreground">{tr("Inapakia taarifa za stock…")}</div>;

async function save(fn: () => Promise<unknown>, okMessage = tr("Taarifa zimehifadhiwa.")) {
  try { await fn(); toast.success(okMessage); return true; }
  catch (e) { toast.error(errorText(e, "Hitilafu imetokea.")); return false; }
}

/* ───────────────────────── Add / Modify Stock (product catalog + prices) ───────────────────────── */

const emptyProduct = { itemCode: "", partNumber: "", name: "", description: "", barcode: "", groupId: "", unitId: "", sellingPrice: "0", openingQty: "0", openingCost: "0", reorderLevel: "", minStockLevel: "", trackSerialNumbers: "false", trackBatchNumbers: "false", trackExpiry: "false", isActive: "true" };

function ProductsScreen() {
  const data = useQuery(api.inventory.stockRegisters, { light: true });
  const upsert = useMutation(api.products.upsert);
  const { canAdjust } = useStockRights();
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState("");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [f, setF] = useState<Record<string, string>>(emptyProduct);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const nextCode = useMemo(() => {
    const used = (data?.products ?? []).map((p) => /^ITM-(\d+)$/.exec(p.itemCode)?.[1]).filter(Boolean).map(Number);
    return `ITM-${String((used.length ? Math.max(...used) : 0) + 1).padStart(4, "0")}`;
  }, [data]);

  if (!data) return loading;
  const editing = data.products.find((p) => p._id === editingId);

  const startEdit = (p?: (typeof data.products)[number]) => {
    setEditingId(p?._id ?? "");
    setF(p ? {
      itemCode: p.itemCode, partNumber: p.partNumber, name: p.name, description: p.description, barcode: p.barcode,
      groupId: p.groupId ?? "", unitId: p.unitId ?? "", sellingPrice: String(p.sellingPrice), openingQty: String(p.openingQty), openingCost: "0",
      reorderLevel: p.reorderLevel === null ? "" : String(p.reorderLevel), minStockLevel: p.minStockLevel === null ? "" : String(p.minStockLevel),
      trackSerialNumbers: String(p.trackSerialNumbers), trackBatchNumbers: String(p.trackBatchNumbers), trackExpiry: String(p.trackExpiry), isActive: String(p.isActive),
    } : { ...emptyProduct, itemCode: nextCode });
    setMode("edit");
  };

  const submit = async () => {
    if (!f.itemCode.trim() || !f.name.trim()) { toast.error(tr("Item code na jina la bidhaa vinahitajika.")); return; }
    if (!(num(f.sellingPrice) >= 0) || f.sellingPrice === "") { toast.error(tr("Weka bei ya kuuzia sahihi.")); return; }
    setBusy(true);
    const ok = await save(() => upsert({
      id: editingId ? (editingId as Id<"products">) : undefined,
      itemCode: f.itemCode.trim(), partNumber: f.partNumber.trim() || undefined, name: f.name.trim(), description: f.description.trim() || undefined,
      barcode: f.barcode.trim() || undefined, groupId: f.groupId ? (f.groupId as Id<"productGroups">) : undefined, unitId: f.unitId ? (f.unitId as Id<"unitsOfMeasure">) : undefined,
      sellingPrice: num(f.sellingPrice),
      openingQty: editingId ? undefined : num(f.openingQty), openingCost: editingId ? undefined : num(f.openingCost),
      reorderLevel: f.reorderLevel === "" ? undefined : num(f.reorderLevel), minStockLevel: f.minStockLevel === "" ? undefined : num(f.minStockLevel),
      trackSerialNumbers: f.trackSerialNumbers === "true", trackBatchNumbers: f.trackBatchNumbers === "true", trackExpiry: f.trackExpiry === "true", isActive: f.isActive === "true",
    }), editingId ? tr("Bidhaa imebadilishwa.") : tr("Bidhaa mpya imesajiliwa."));
    setBusy(false);
    if (ok) setMode("list");
  };

  const field = (label: string, key: string, type = "text", hint?: string) => (
    <label className="grid gap-1 text-sm">{label}
      <Input type={type} step={type === "number" ? "any" : undefined} min={type === "number" ? 0 : undefined} value={f[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
  const check = (label: string, key: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f[key] === "true"} onChange={(e) => set(key, String(e.target.checked))} />{label}</label>
  );

  if (mode === "edit") {
    return (
      <div className="space-y-5">
        <Button variant="outline" onClick={() => setMode("list")}>{tr("← Rudi kwenye orodha ya bidhaa")}</Button>
        <h1 className="text-2xl font-bold">{editingId ? tr("Modify Stock — {0}", [editing?.name ?? ""]) : tr("Add Stock — sajili bidhaa mpya")}</h1>
        <section className="grid gap-4 rounded-xl border p-5 md:grid-cols-2">
          {field(tr("Item Code"), "itemCode")}
          {field(tr("Jina la bidhaa"), "name")}
          {field(tr("Part Number (hiari)"), "partNumber")}
          {field(tr("Barcode (hiari)"), "barcode")}
          <label className="grid gap-1 text-sm">{tr("Group")}
            <select className={selectClass} value={f.groupId} onChange={(e) => set("groupId", e.target.value)}>
              <option value="">{tr("-- Bila group --")}</option>
              {data.groups.filter((g) => g.isActive || g._id === f.groupId).map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">{tr("Unit")}
            <select className={selectClass} value={f.unitId} onChange={(e) => set("unitId", e.target.value)}>
              <option value="">{tr("-- Bila unit --")}</option>
              {data.units.filter((u) => u.isActive || u._id === f.unitId).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          </label>
          {field(tr("Bei ya kuuzia (Selling Price)"), "sellingPrice", "number", editingId ? tr("Bei mpya itatumika kwenye mauzo yajayo; invoices zilizopita hazibadiliki.") : undefined)}
          {field(tr("Maelezo (hiari)"), "description")}
          {field(tr("Reorder Level"), "reorderLevel", "number", tr("Ripoti ya Reorder itaonyesha bidhaa zilizo chini au sawa na kiwango hiki."))}
          {field(tr("Minimum Stock Level"), "minStockLevel", "number")}
          {editingId ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm md:col-span-2">
              
              {tr("Stock iliyopo sasa:")} <b>{fmt(editing?.currentQty ?? 0, 4)} {editing?.unitName}</b>  {tr("· Cost wastani:")} <b>{fmt(editing?.cost ?? 0)}</b>.
              <div className="mt-1 text-xs text-muted-foreground">{tr("Idadi haibadilishwi hapa. Ongeza stock kupitia Purchase, na rekebisha idadi kupitia Quantity Adjustment ili kila badiliko lirekodiwe kwenye ripoti.")}</div>
            </div>
          ) : (
            <>
              {field(tr("Opening Quantity (stock ya kuanzia)"), "openingQty", "number", tr("Itarekodiwa kama movement ya 'opening'."))}
              {field(tr("Opening Cost kwa kipande"), "openingCost", "number", tr("Inatumika kuhesabu thamani ya stock na faida."))}
            </>
          )}
          <div className="flex flex-wrap gap-5 md:col-span-2">
            {check(tr("Bidhaa ipo active (inaonekana kwenye mauzo na manunuzi)"), "isActive")}
            {check(tr("Track expiry"), "trackExpiry")}
            {check(tr("Track serial numbers"), "trackSerialNumbers")}
            {check(tr("Track batch numbers"), "trackBatchNumbers")}
          </div>
          <div className="md:col-span-2"><Button disabled={busy} onClick={() => void submit()}>{busy ? tr("Inahifadhi…") : tr("Hifadhi")}</Button></div>
        </section>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const shown = data.products.filter((p) => (showInactive || p.isActive) && (!q || [p.name, p.itemCode, p.barcode, p.partNumber, p.groupName].some((x) => x.toLowerCase().includes(q))));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">{tr("Add / Modify Stock")}</h1><p className="text-sm text-muted-foreground">{tr("Sajili bidhaa mpya, badilisha jina, group, unit na bei ya kuuzia.")}</p></div>
        <Button onClick={() => startEdit()}>{tr("＋ Add New Item")}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-sm" placeholder={tr("Tafuta jina, code au barcode…")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />{tr("Onyesha zilizozimwa")}</label>
      </div>
      <section className="overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr>{[tr("Code"), tr("Jina"), tr("Group"), tr("Unit"), tr("Bei ya kuuzia"), tr("Cost"), tr("Stock"), tr("Hali"), ""].map((h) => <th key={h} className="whitespace-nowrap bg-muted/50 p-3">{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p._id} className="border-t">
                  <td className="whitespace-nowrap p-3">{p.itemCode}</td><td className="p-3 font-medium">{p.name}</td><td className="p-3">{p.groupName}</td><td className="p-3">{p.unitName}</td>
                  <td className="p-3 text-right tabular-nums">{fmt(p.sellingPrice)}</td><td className="p-3 text-right tabular-nums">{fmt(p.cost)}</td>
                  <td className={`p-3 text-right tabular-nums ${p.currentQty <= 0 ? "text-destructive" : ""}`}>{fmt(p.currentQty, 4)}</td>
                  <td className="p-3">{p.isActive ? tr("Active") : tr("Imezimwa")}</td>
                  <td className="p-3">{canAdjust ? <Button size="sm" variant="outline" onClick={() => startEdit(p)}>{tr("Modify")}</Button> : <span className="text-xs text-muted-foreground" title={tr("Huna ruhusa ya kubadili / kufuta stock")}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="p-5 text-sm text-muted-foreground">{tr("Hakuna bidhaa. Bonyeza “＋ Add New Item” kusajili bidhaa ya kwanza.")}</p>}
        </div>
      </section>
    </div>
  );
}

/* ───────────────────────── Quantity Adjustment ───────────────────────── */

function AdjustmentScreen() {
  const data = useQuery(api.inventory.stockRegisters, { startDate: monthStart(), endDate: today(), light: true });
  const adjust = useMutation(api.inventory.adjust);
  const rights = useStockRights();
  const [productId, setProductId] = useState("");
  const [counted, setCounted] = useState("");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data || !rights.ready) return loading;
  if (!rights.canAdjust) return <div className="space-y-3"><h1 className="text-2xl font-bold">{tr("Quantity Adjustment")}</h1><p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{tr("Huna ruhusa ya kubadili / kufuta stock. Muombe Super Admin akupe ruhusa hii.")}</p></div>;
  const product = data.products.find((p) => p._id === productId);
  const diff = product && counted !== "" ? round2(num(counted) - product.currentQty) : 0;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{tr("Quantity Adjustment")}</h1>
      <section className="grid gap-4 rounded-xl border p-5 md:grid-cols-2">
        <label className="grid gap-1 text-sm">{tr("Bidhaa")}
          <select className={selectClass} value={productId} onChange={(e) => { setProductId(e.target.value); setCounted(""); }}>
            <option value="">{tr("-- Chagua bidhaa --")}</option>
            {data.products.filter((p) => p.isActive).map((p) => <option key={p._id} value={p._id}>{p.name} ({p.itemCode})</option>)}
          </select>
        </label>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">{product ? <>{tr("Stock ya mfumo:")} <b>{fmt(product.currentQty, 4)} {product.unitName}</b>  {tr("· Cost:")} {fmt(product.cost)}</> : tr("Chagua bidhaa kuona stock ya mfumo.")}</div>
        <label className="grid gap-1 text-sm">{tr("Kiasi kilichohesabiwa (kipya)")}<Input type="number" step="any" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">{tr("Tarehe")}<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="grid gap-1 text-sm md:col-span-2">{tr("Sababu (inahitajika)")}<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("Mfano: stock count, bidhaa imeharibika, imepotea…")} /></label>
        {product && counted !== "" && <div className="text-sm md:col-span-2">{tr("Tofauti:")} <b className={diff < 0 ? "text-destructive" : ""}>{diff > 0 ? "+" : ""}{fmt(diff, 4)}</b>  {tr("· Thamani:")} <b>{fmt(Math.abs(diff) * product.cost)}</b></div>}
        <div className="md:col-span-2">
          <Button disabled={busy} onClick={() => void (async () => {
            if (!productId) { toast.error(tr("Chagua bidhaa.")); return; }
            if (counted === "" || num(counted) < 0) { toast.error(tr("Weka kiasi kipya sahihi.")); return; }
            if (!reason.trim()) { toast.error(tr("Weka sababu ya marekebisho.")); return; }
            setBusy(true);
            const ok = await save(() => adjust({ productId: productId as Id<"products">, newQty: num(counted), reason: reason.trim(), adjustmentDate: date }), tr("Stock imerekebishwa."));
            setBusy(false);
            if (ok) { setCounted(""); setReason(""); }
          })()}>{busy ? tr("Inahifadhi…") : tr("Hifadhi Adjustment")}</Button>
        </div>
      </section>
      <ReportTable title={tr("Adjustments za mwezi huu")} rows={data.adjustments.map((x) => ({ Tarehe: x.date, Code: x.itemCode, Bidhaa: x.productName, "Kabla": x.qtyBefore, "Baada": x.counted, Tofauti: x.difference, Sababu: x.reason }))} />
    </div>
  );
}

/* ───────────────────────── Group & Unit maintenance ───────────────────────── */

function GroupsScreen() {
  const data = useQuery(api.inventory.stockRegisters, { light: true });
  const upsertGroup = useMutation(api.products.upsertGroup);
  const upsertUnit = useMutation(api.products.upsertUnit);
  const [kind, setKind] = useState<"group" | "unit">("group");
  const [id, setId] = useState("");
  const [f, setF] = useState({ code: "", name: "", description: "", isActive: true });
  if (!data) return loading;
  const rows = kind === "group" ? data.groups : data.units;
  const reset = () => { setId(""); setF({ code: "", name: "", description: "", isActive: true }); };
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{tr("Group Maintenance")}</h1>
      <div className="flex gap-2">
        <Button variant={kind === "group" ? "default" : "outline"} onClick={() => { setKind("group"); reset(); }}>{tr("Product Groups")}</Button>
        <Button variant={kind === "unit" ? "default" : "outline"} onClick={() => { setKind("unit"); reset(); }}>{tr("Units of Measure")}</Button>
      </div>
      <section className="grid gap-4 rounded-xl border p-5 md:grid-cols-2">
        <label className="grid gap-1 text-sm">{tr("Code")}<Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">{tr("Jina")}<Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        {kind === "group" && <label className="grid gap-1 text-sm md:col-span-2">{tr("Maelezo")}<Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />{tr("Active")}</label>
        <div className="flex gap-2 md:col-span-2">
          <Button onClick={() => void (async () => {
            if (!f.code.trim() || !f.name.trim()) { toast.error(tr("Code na jina vinahitajika.")); return; }
            const ok = await save(() => kind === "group"
              ? upsertGroup({ id: id ? (id as Id<"productGroups">) : undefined, code: f.code.trim(), name: f.name.trim(), description: f.description.trim() || undefined, isActive: f.isActive })
              : upsertUnit({ id: id ? (id as Id<"unitsOfMeasure">) : undefined, code: f.code.trim(), name: f.name.trim(), isActive: f.isActive }));
            if (ok) reset();
          })()}>{id ? tr("Save Changes") : tr("Add")}</Button>
          {id && <Button variant="outline" onClick={reset}>{tr("Cancel")}</Button>}
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead><tr>{[tr("Code"), tr("Jina"), tr("Hali"), ""].map((h) => <th key={h} className="bg-muted/50 p-3">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id} className="border-t">
                <td className="p-3">{r.code}</td><td className="p-3">{r.name}</td><td className="p-3">{r.isActive ? tr("Active") : tr("Imezimwa")}</td>
                <td className="p-3"><Button size="sm" variant="outline" onClick={() => { setId(r._id); setF({ code: r.code, name: r.name, description: (r as { description?: string }).description ?? "", isActive: r.isActive }); }}>{tr("Modify")}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-5 text-sm text-muted-foreground">{tr("Hakuna rekodi bado.")}</p>}
      </section>
    </div>
  );
}

/* ───────────────────────── Quantity-based views and reports ───────────────────────── */

function QuantityScreen({ kind }: { kind: "item-quantity" | "quantity" | "prices" | "reorder" | "out-of-stock" }) {
  // Only the quantity screens compare stock with the whole movement history; the others stay light.
  const data = useQuery(api.inventory.stockRegisters, { light: !(kind === "item-quantity" || kind === "quantity") });
  const reconcile = useMutation(api.inventory.reconcileMovements);
  const { canAdjust: canReconcile } = useStockRights();
  const [group, setGroup] = useState("");
  if (!data) return loading;
  const titles = { "item-quantity": tr("Item Quantity"), quantity: tr("Quantity Report"), prices: tr("Selling Price Report"), reorder: tr("Stock Reorder Report"), "out-of-stock": tr("Out of Stock Report") };
  let list = data.products.filter((p) => p.isActive && (!group || p.groupId === group));
  if (kind === "reorder") list = list.filter((p) => p.reorderLevel !== null && p.currentQty <= p.reorderLevel);
  if (kind === "out-of-stock") list = list.filter((p) => p.currentQty <= 0);
  let rows: Row[];
  let sumCols: string[] = [];
  if (kind === "prices") {
    rows = list.map((p) => ({ Code: p.itemCode, Bidhaa: p.name, Group: p.groupName, Unit: p.unitName, "Bei ya kuuzia": p.sellingPrice, Cost: p.cost, "Faida/kipande": round2(p.sellingPrice - p.cost), "Margin %": p.sellingPrice > 0 ? round2(((p.sellingPrice - p.cost) / p.sellingPrice) * 100) : 0 }));
  } else if (kind === "reorder") {
    rows = list.map((p) => ({ Code: p.itemCode, Bidhaa: p.name, Group: p.groupName, Unit: p.unitName, "Stock iliyopo": p.currentQty, "Reorder Level": p.reorderLevel ?? 0, "Upungufu": round2((p.reorderLevel ?? 0) - p.currentQty), "Last Cost": p.lastPurchaseCost }));
  } else if (kind === "out-of-stock") {
    rows = list.map((p) => ({ Code: p.itemCode, Bidhaa: p.name, Group: p.groupName, Unit: p.unitName, "Stock iliyopo": p.currentQty, "Last Cost": p.lastPurchaseCost, "Last Purchase": p.lastPurchaseDate || "—" }));
  } else {
    rows = list.map((p) => ({ Code: p.itemCode, Bidhaa: p.name, Group: p.groupName, Unit: p.unitName, Stock: p.currentQty, Cost: p.cost, "Thamani (cost)": p.stockValue, "Bei ya kuuzia": p.sellingPrice, "Thamani (bei)": p.retailValue }));
    sumCols = [tr("Thamani (cost)"), tr("Thamani (bei)")];
  }
  const bad = data.products.filter((p) => Math.abs(p.difference) > 1e-6);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">{titles[kind]}</h1>
        <label className="grid gap-1 text-xs print:hidden">{tr("Group")}
          <select className={selectClass} value={group} onChange={(e) => setGroup(e.target.value)}><option value="">{tr("Zote")}</option>{data.groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}</select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={tr("Bidhaa active")} value={data.totals.items} /><Stat label={tr("Thamani ya stock (cost)")} value={data.totals.stockValue} />
        <Stat label={tr("Chini ya reorder")} value={data.totals.belowReorder} /><Stat label={tr("Zimeisha stock")} value={data.totals.outOfStock} />
      </div>
      {bad.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <span>{tr("Bidhaa")} {bad.length}  {tr("zina historia ya movement isiyolingana na stock iliyopo (mfano: stock ya kuanzia iliyosajiliwa kabla movements hazijaanza kurekodiwa). Idadi zilizoonyeshwa ni za mfumo; sawazisha historia ili ripoti za movement zilingane.")}</span>
          {canReconcile && <Button size="sm" onClick={() => void save(async () => { const r = await reconcile({}); if (!r.fixed) throw new Error(tr("Hakuna cha kusawazisha.")); }, tr("Historia ya movements imesawazishwa."))}>{tr("Sawazisha historia")}</Button>}
        </div>
      )}
      <ReportTable title={titles[kind]} rows={rows} sumCols={sumCols} />
    </div>
  );
}

/* ───────────────────────── Movements, history, earnings, stock take ───────────────────────── */

function TransactionsScreen() {
  const [start, setStart] = useState(monthStart()); const [end, setEnd] = useState(today());
  const data = useQuery(api.inventory.stockRegisters, { startDate: start, endDate: end, light: true });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-2xl font-bold">{tr("Transaction Quantity")}</h1><DateRange startDate={start} endDate={end} onStart={setStart} onEnd={setEnd} /></div>
      {!data ? loading : (
        <>
          <ReportTable title={tr("Muhtasari kwa bidhaa")} sumCols={[]} rows={data.products.filter((p) => p.qtyIn || p.qtyOut || p.qtyBefore).map((p) => ({ Code: p.itemCode, Bidhaa: p.name, "Mwanzo": p.qtyBefore, "Ingizo": p.qtyIn, "Matumizi": p.qtyOut, "Mwisho": p.qtyEnd }))} />
          <ReportTable title={tr("Stock movements")} rows={data.movements.map((m) => ({ Tarehe: m.date, Code: m.itemCode, Bidhaa: m.productName, Aina: trValue(m.type), Reference: m.reference, Ingizo: m.qtyIn, Matumizi: m.qtyOut, Balance: m.balance }))} />
        </>
      )}
    </div>
  );
}

function HistoryScreen() {
  const [start, setStart] = useState("2000-01-01"); const [end, setEnd] = useState(today()); const [productId, setProductId] = useState("");
  const data = useQuery(api.inventory.stockRegisters, { startDate: start, endDate: end, light: true });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-2xl font-bold">{tr("Item History")}</h1><DateRange startDate={start} endDate={end} onStart={setStart} onEnd={setEnd} /></div>
      {!data ? loading : (() => {
        const p = data.products.find((x) => x._id === productId);
        const rows: Row[] = p ? [{ Tarehe: "—", Aina: tr("Salio la kuanzia"), Reference: "", Ingizo: 0, Matumizi: 0, Balance: p.qtyBefore }, ...data.movements.filter((m) => m.productId === p._id).map((m) => ({ Tarehe: m.date, Aina: trValue(m.type), Reference: m.reference, Ingizo: m.qtyIn, Matumizi: m.qtyOut, Balance: m.balance }))] : [];
        return (
          <>
            <label className="grid max-w-md gap-1 text-sm">{tr("Bidhaa")}
              <select className={selectClass} value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">{tr("-- Chagua bidhaa --")}</option>{data.products.map((x) => <option key={x._id} value={x._id}>{x.name} ({x.itemCode})</option>)}</select>
            </label>
            {p && <div className="grid gap-3 sm:grid-cols-3"><Stat label={tr("Stock iliyopo")} value={`${fmt(p.currentQty, 4)} ${p.unitName}`} /><Stat label={tr("Bei ya kuuzia")} value={p.sellingPrice} /><Stat label={tr("Cost")} value={p.cost} /></div>}
            {p ? <ReportTable title={tr("Historia — {0}", [p.name])} rows={rows} /> : <p className="text-sm text-muted-foreground">{tr("Chagua bidhaa kuona historia yake kamili.")}</p>}
          </>
        );
      })()}
    </div>
  );
}

function EarningsScreen() {
  const [start, setStart] = useState(monthStart()); const [end, setEnd] = useState(today());
  const data = useQuery(api.inventory.stockRegisters, { startDate: start, endDate: end, light: true });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-2xl font-bold">{tr("Stock Earning Report")}</h1><DateRange startDate={start} endDate={end} onStart={setStart} onEnd={setEnd} /></div>
      {!data ? loading : <ReportTable title={tr("Faida kwa bidhaa")} sumCols={["Invoices", "Mauzo (bila tax)", "Cost ya mauzo", "Faida"]} note="Mauzo huchukuliwa kutoka invoices zilizopostiwa (discount ya invoice imegawanywa kwenye mistari, tax haihesabiwi). Cost ni gharama iliyorekodiwa wakati wa kuuza."
        rows={data.earnings.map((e) => ({ Code: e.itemCode, Bidhaa: e.productName, "Qty iliyouzwa": e.qtySold, Invoices: e.invoices, "Mauzo (bila tax)": e.sales, "Cost ya mauzo": e.cost, Faida: e.profit, "Margin %": e.marginPct }))} />}
    </div>
  );
}

function StockTakeScreen() {
  const [start, setStart] = useState(monthStart()); const [end, setEnd] = useState(today());
  const data = useQuery(api.inventory.stockRegisters, { startDate: start, endDate: end, light: true });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-2xl font-bold">{tr("Stock Taking Report")}</h1><DateRange startDate={start} endDate={end} onStart={setStart} onEnd={setEnd} /></div>
      {!data ? loading : <ReportTable title={tr("Hesabu (count) dhidi ya mfumo")} sumCols={["Tofauti", "Thamani ya tofauti"]} note="Kila Quantity Adjustment ni stock take: 'Mfumo' ni idadi kabla ya kurekebisha na 'Iliyohesabiwa' ni idadi mpya."
        rows={data.adjustments.map((x) => ({ Tarehe: x.date, Code: x.itemCode, Bidhaa: x.productName, Mfumo: x.qtyBefore, Iliyohesabiwa: x.counted, Tofauti: x.difference, "Thamani ya tofauti": round2(x.difference * x.cost), Sababu: x.reason }))} />}
    </div>
  );
}

function TrackingScreen({ kind }: { kind: "expiry" | "serials" }) {
  const data = useQuery(api.inventory.stockRegisters, { light: true });
  if (!data) return loading;
  const list = data.products.filter((p) => p.isActive && (kind === "expiry" ? p.trackExpiry : p.trackSerialNumbers));
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{kind === "expiry" ? tr("Expired Date Report") : tr("Serial Number Report")}</h1>
      <ReportTable title={kind === "expiry" ? tr("Bidhaa zinazofuatiliwa expiry") : tr("Bidhaa zinazofuatiliwa serial number")}
        note={kind === "expiry" ? tr("Mfumo bado haurekodi tarehe za expiry kwa kila batch wakati wa kupokea au kuuza; ripoti hii inaorodhesha bidhaa zilizowekwa 'Track expiry' pamoja na stock iliyopo. Ripoti kamili ya expiry itahitaji kurekodi batch/expiry kwenye Purchase/GRN.") : tr("Mfumo bado haurekodi serial number kwa kila kipande; ripoti hii inaorodhesha bidhaa zilizowekwa 'Track serial numbers' pamoja na stock iliyopo.")}
        rows={list.map((p) => ({ Code: p.itemCode, Bidhaa: p.name, Group: p.groupName, Stock: p.currentQty, "Last Purchase": p.lastPurchaseDate || "—" }))} />
    </div>
  );
}

function BarcodesScreen() {
  const data = useQuery(api.inventory.stockRegisters, { light: true });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [copies, setCopies] = useState("1");
  const labelsRef = useRef<HTMLDivElement>(null);
  if (!data) return loading;
  const chosen = data.products.filter((p) => picked[p._id]);
  const labels = chosen.flatMap((p) => Array.from({ length: Math.max(1, Math.floor(num(copies))) }, (_, i) => ({ p, i })));
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold print:hidden">{tr("Print Stock Barcodes")}</h1>
      <section className="space-y-3 rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs">{tr("Nakala kwa kila bidhaa")}<Input className="w-28" type="number" min="1" value={copies} onChange={(e) => setCopies(e.target.value)} /></label>
          <Button variant="outline" onClick={() => setPicked(Object.fromEntries(data.products.filter((p) => p.isActive).map((p) => [p._id, true])))}>{tr("Chagua zote")}</Button>
          <Button variant="outline" onClick={() => setPicked({})}>{tr("Ondoa zote")}</Button>
          <Button disabled={!chosen.length} onClick={() => printElement(labelsRef.current, "A4")}>{tr("Print labels (")}{labels.length})</Button>
        </div>
        <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {data.products.filter((p) => p.isActive).map((p) => (
            <label key={p._id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!picked[p._id]} onChange={(e) => setPicked((o) => ({ ...o, [p._id]: e.target.checked }))} />{p.name} <span className="text-muted-foreground">({p.barcode || p.itemCode})</span></label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{tr("Label inaonyesha jina, bei na namba ya barcode (au item code kama barcode haijawekwa). Kuchapa mistari ya barcode (bars) kunahitaji barcode font au maktaba ya barcode kwenye printer yako.")}</p>
      </section>
      <div ref={labelsRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {labels.map(({ p, i }) => (
          <div key={`${p._id}-${i}`} className="break-inside-avoid rounded-md border p-3 text-center">
            <div className="text-sm font-semibold leading-tight">{p.name}</div>
            <div className="mt-1 font-mono text-lg tracking-widest">{p.barcode || p.itemCode}</div>
            <div className="text-sm">{fmt(p.sellingPrice)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Router ───────────────────────── */

export default function StockWorkspace() {
  const navigate = useNavigate();
  const path = useLocation().pathname.split("/").filter(Boolean).slice(1).join("/");
  let screen;
  switch (path) {
    case "products": screen = <ProductsScreen />; break;
    case "adjustment": screen = <AdjustmentScreen />; break;
    case "groups": screen = <GroupsScreen />; break;
    case "item-quantity": screen = <QuantityScreen kind="item-quantity" />; break;
    case "transactions": screen = <TransactionsScreen />; break;
    case "item-history": screen = <HistoryScreen />; break;
    case "reports/quantity": screen = <QuantityScreen kind="quantity" />; break;
    case "reports/prices": screen = <QuantityScreen kind="prices" />; break;
    case "reports/earnings": screen = <EarningsScreen />; break;
    case "reports/stock-take": screen = <StockTakeScreen />; break;
    case "reports/expiry": screen = <TrackingScreen kind="expiry" />; break;
    case "reports/serials": screen = <TrackingScreen kind="serials" />; break;
    case "barcodes": screen = <BarcodesScreen />; break;
    case "reports/reorder": screen = <QuantityScreen kind="reorder" />; break;
    case "reports/out-of-stock": screen = <QuantityScreen kind="out-of-stock" />; break;
    default: screen = <ProductsScreen />;
  }
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <Button variant="outline" className="print:hidden" onClick={() => navigate("/stock")}>{tr("← Stock")}</Button>
      {screen}
    </div>
  );
}
