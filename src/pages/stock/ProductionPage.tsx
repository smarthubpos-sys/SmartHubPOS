import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { errorText, tr } from "@/lib/i18n.ts";

type IngredientLine = { productId: string; qty: string; small?: boolean };
type UnitInfo = { label: string; small?: { label: string; factor: number } };
/** Unit shown next to a quantity. kg -> can type grams (400 = 0.4 kg), litre -> can type ml. Stock itself always stays in the product's own unit. */
function unitInfo(u?: { code: string; name: string }): UnitInfo {
  const code = (u?.code ?? "").trim(); const name = (u?.name ?? "").trim();
  const key = `${code} ${name}`.toLowerCase();
  if (/\b(kg|kgs|kilo|kilogram|kilogramu)\b/.test(key)) return { label: code || name || "kg", small: { label: "g", factor: 1000 } };
  if (/\b(l|lt|ltr|litre|liter|lita)\b/.test(key)) return { label: code || name || "L", small: { label: "ml", factor: 1000 } };
  return { label: code || name };
}
/** What the person typed -> quantity in the product's own unit (the number that goes to stock). */
const toBase = (raw: string, info: UnitInfo, small?: boolean) => (small && info.small ? Number(raw) / info.small.factor : Number(raw));
function QtyInput({ value, onChange, info, small, onSmall, label }: { value: string; onChange: (v: string) => void; info: UnitInfo; small?: boolean; onSmall: (v: boolean) => void; label: string }) {
  return <div className="flex items-center gap-1">
    <Input type="number" inputMode="decimal" min="0" step="any" aria-label={label} value={value} onChange={e => onChange(e.target.value)} />
    {info.small
      ? <select aria-label={tr("Kipimo")} className="h-10 rounded-md border bg-background px-1 text-sm" value={small ? "small" : "base"} onChange={e => onSmall(e.target.value === "small")}><option value="base">{info.label}</option><option value="small">{info.small.label}</option></select>
      : info.label ? <span className="min-w-8 text-xs text-muted-foreground">{info.label}</span> : null}
  </div>;
}
export default function ProductionPage() {
  const products = useQuery(api.products.listActive, {});
  const units = useQuery(api.products.listUnits, {});
  const recipes = useQuery(api.production.listRecipes, {});
  const batches = useQuery(api.production.recentBatches, {});
  const saveRecipe = useMutation(api.production.saveRecipe);
  const produceBatch = useMutation(api.production.produceBatch);
  const returnToStock = useMutation(api.production.returnToStock);
  const editBatch = useMutation(api.production.editBatch);
  const deleteBatch = useMutation(api.production.deleteBatch);
  const deleteRecipe = useMutation(api.production.deleteRecipe);
  const clearNegativeStock = useMutation(api.production.clearNegativeStock);
  const [edit, setEdit] = useState<{ id: string; qty: string; notes: string } | null>(null);
  const [ret, setRet] = useState<{ id: string; qty: string; reason: string } | null>(null);
  const [outputProductId, setOutputProductId] = useState("");
  const [outputQty, setOutputQty] = useState("1");
  const [outputSmall, setOutputSmall] = useState(false);
  const [autoOnSale, setAutoOnSale] = useState(true);
  const [priceFromIngredients, setPriceFromIngredients] = useState(false); // default: the menu price is typed in by hand on the menu item; cost comes from the ingredients
  const [ingredients, setIngredients] = useState<IngredientLine[]>([{ productId: "", qty: "1" }]);
  const [batchProductId, setBatchProductId] = useState("");
  const [batchQty, setBatchQty] = useState("1");
  const [batchSmall, setBatchSmall] = useState(false);
  const [busy, setBusy] = useState(false);
  const productOptions = useMemo(() => {
    const unitById = new Map((units ?? []).map((u) => [String(u._id), u]));
    return (products ?? []).map((p) => ({ id: String(p._id), name: p.name, qty: p.currentQty, unit: unitInfo(p.unitId ? unitById.get(String(p.unitId)) : undefined) }));
  }, [products, units]);
  const infoOf = (id: string): UnitInfo => productOptions.find((p) => p.id === id)?.unit ?? { label: "" };
  const submitRecipe = async () => {
    if (!outputProductId || ingredients.some(x => !x.productId || !(Number(x.qty) > 0)) || !(Number(outputQty) > 0)) return toast.error(tr("Jaza bidhaa ya mwisho, yield na malighafi zote."));
    setBusy(true);
    try {
      const saved = await saveRecipe({ outputProductId: outputProductId as never, outputQty: toBase(outputQty, infoOf(outputProductId), outputSmall), active: true, autoOnSale, priceFromIngredients, ingredients: ingredients.map(x => ({ productId: x.productId as never, qty: toBase(x.qty, infoOf(x.productId), x.small) })) });
      toast.success(tr("Recipe imehifadhiwa.") + (saved.clearedMinus > 0 ? " " + tr("Minus ya {0} imefutwa kutoka kwenye malighafi.", [String(Math.round(saved.clearedMinus * 1000) / 1000)]) : ""));
      if (saved.clearError) toast.error(tr("Minus haikufutika: {0}", [saved.clearError]));
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuhifadhi recipe.")); }
    finally { setBusy(false); }
  };
  const submitClearMinus = async () => {
    setBusy(true);
    try {
      const r = await clearNegativeStock({});
      if (!r.cleared.length && !r.skipped.length) toast.message(tr("Hakuna bidhaa ya recipe yenye minus."));
      else toast.success(tr("Minus imefutwa: {0}", [r.cleared.map((c) => c.name).join(", ") || "—"]) + (r.skipped.length ? " | " + tr("Zimeshindikana: {0}", [r.skipped.map((c) => `${c.name} (${c.reason})`).join("; ")]) : ""));
    } catch (e) { toast.error(errorText(e, "Kufuta minus kumeshindikana.")); }
    finally { setBusy(false); }
  };
  const submitBatch = async () => {
    if (!batchProductId || !(Number(batchQty) > 0)) return toast.error(tr("Chagua bidhaa na kiasi cha production."));
    setBusy(true);
    try {
      const result = await produceBatch({ outputProductId: batchProductId as never, quantity: toBase(batchQty, infoOf(batchProductId), batchSmall) });
      toast.success(tr("Production imekamilika. Gharama jumla: {0}", [result.totalCost.toLocaleString()]));
    } catch (e) { toast.error(errorText(e, "Production imeshindikana.")); }
    finally { setBusy(false); }
  };
  const submitReturn = async () => {
    if (!ret) return;
    if (!(Number(ret.qty) > 0) || ret.reason.trim().length < 3) return toast.error(tr("Weka kiasi cha kurudisha na sababu."));
    setBusy(true);
    try {
      const r = await returnToStock({ batchId: ret.id as never, quantity: Number(ret.qty), reason: ret.reason });
      toast.success(tr("Imerudishwa kwenye stock ya malighafi: {0}", [r.ingredients.map((i) => `${i.name} +${Math.round(i.qty * 1000) / 1000}`).join(", ")]));
      setRet(null);
    } catch (e) { toast.error(errorText(e, tr("Kurudisha kwenye stock kumeshindikana."))); }
    finally { setBusy(false); }
  };
  const submitEdit = async () => {
    if (!edit) return;
    if (!(Number(edit.qty) > 0)) return toast.error(tr("Weka kiasi cha production (zaidi ya sifuri)."));
    setBusy(true);
    try {
      await editBatch({ batchId: edit.id as never, quantity: Number(edit.qty), notes: edit.notes });
      toast.success(tr("Batch imebadilishwa. Stock imerekebishwa kwa tofauti tu."));
      setEdit(null);
    } catch (e) { toast.error(errorText(e, tr("Kubadilisha batch kumeshindikana."))); }
    finally { setBusy(false); }
  };
  const removeBatch = async (id: string, name: string) => {
    const reason = window.prompt(tr("Futa batch ya {0}? Malighafi zitarudi kwenye stock na bidhaa iliyokamilika itatolewa. Andika sababu (hiari) kisha bonyeza OK.", [name]));
    if (reason === null) return;
    setBusy(true);
    try {
      await deleteBatch({ batchId: id as never, reason: reason.trim() || undefined });
      toast.success(tr("Batch imefutwa. Malighafi zimerudi kwenye stock."));
      setEdit(null);
    } catch (e) { toast.error(errorText(e, tr("Kufuta batch kumeshindikana."))); }
    finally { setBusy(false); }
  };
  const removeRecipe = async (id: string, name: string) => {
    if (!window.confirm(tr("Futa recipe ya {0}? Stock na batch zilizokwisha tengenezwa havitaguswa.", [name]))) return;
    setBusy(true);
    try { await deleteRecipe({ recipeId: id as never }); toast.success(tr("Recipe imefutwa.")); }
    catch (e) { toast.error(errorText(e, tr("Kufuta recipe kumeshindikana."))); }
    finally { setBusy(false); }
  };
  const loadRecipe = (r: NonNullable<typeof recipes>[number]) => {
    setOutputProductId(String(r.outputProductId));
    setOutputQty(String(r.outputQty)); setOutputSmall(false);
    setAutoOnSale(r.autoOnSale === true);
    setPriceFromIngredients(r.priceFromIngredients === true);
    setIngredients(r.ingredients.map((x) => ({ productId: String(x.productId), qty: String(x.qty), small: false })));
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.message(tr("Recipe imepakiwa juu. Badilisha kisha bonyeza Hifadhi Recipe."));
  };
  const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
  if (products === undefined || units === undefined || recipes === undefined || batches === undefined) return <div className="p-6">{tr("Inapakia Production…")}</div>;
  return <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
    <header><h1 className="text-2xl font-bold">{tr("Back Office · Production")}</h1><p className="mt-1 text-sm text-muted-foreground">{tr("Tengeneza recipes na uzalishe batch kwa kutumia stock ya malighafi.")}</p></header>
    <section className="rounded-xl border p-4 space-y-4">
      <div><h2 className="text-lg font-semibold">{tr("1. Recipe / Viambato")}</h2><p className="text-sm text-muted-foreground">{tr("Chagua bidhaa ya mwisho, kisha weka malighafi na kiasi kinachotumika kwa yield moja.")}</p></div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">{tr("Bidhaa inayotengenezwa")}<select className={selectClass} value={outputProductId} onChange={e => { setOutputProductId(e.target.value); setOutputSmall(false); }}><option value="">{tr("-- Chagua bidhaa --")}</option>{productOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="space-y-1 text-sm">{tr("Yield ya recipe (idadi inayotengenezwa)")}<QtyInput label={tr("Yield ya recipe (idadi inayotengenezwa)")} value={outputQty} onChange={setOutputQty} info={infoOf(outputProductId)} small={outputSmall} onSmall={setOutputSmall} /></label>
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={autoOnSale} onChange={e => setAutoOnSale(e.target.checked)} /><span><b>{tr("Tengeneza yenyewe mauzo yanapofanyika")}</b><br /><span className="text-muted-foreground">{tr("Mhudumu akiuza bidhaa hii, mfumo unapunguza viungo kwenye stock yenyewe (bila kutengeneza batch kwanza).")}</span></span></label>
      <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={priceFromIngredients} onChange={e => setPriceFromIngredients(e.target.checked)} /><span><b>{tr("Bei ya kuuzia ichukuliwe kutoka kwa viungo (hiari)")}</b><br /><span className="text-muted-foreground">{tr("Kawaida: bei ya menu unaiweka mwenyewe kwenye bidhaa ya menu, na gharama inatoka kwenye bei za manunuzi za viungo vya stock. Washa hapa tu kama unataka bei ya menu ijijumlishe kutoka bei za kuuzia za viungo.")}</span></span></label>
      <div className="space-y-2">{ingredients.map((line, i) => <div key={i} className="grid grid-cols-[1fr_150px_auto] gap-2">
        <select className={selectClass} value={line.productId} onChange={e => setIngredients(prev => prev.map((x,j) => j === i ? {...x, productId:e.target.value, small:false} : x))}><option value="">{tr("-- Malighafi --")}</option>{productOptions.filter(p => p.id !== outputProductId).map(p => <option key={p.id} value={p.id}>{p.name} (stock {p.qty})</option>)}</select>
        <QtyInput label={tr("Kiasi cha malighafi")} value={line.qty} info={infoOf(line.productId)} small={line.small} onChange={v => setIngredients(prev => prev.map((x,j) => j === i ? {...x, qty:v} : x))} onSmall={v => setIngredients(prev => prev.map((x,j) => j === i ? {...x, small:v} : x))} />
        <Button variant="outline" disabled={ingredients.length === 1} onClick={() => setIngredients(prev => prev.filter((_,j) => j !== i))}>{tr("Ondoa")}</Button>
      </div>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setIngredients(prev => [...prev,{productId:"",qty:"1"}])}>{tr("+ Ongeza malighafi")}</Button><Button disabled={busy} onClick={() => void submitRecipe()}>Hifadhi Recipe</Button></div>
      <p className="text-xs text-muted-foreground">{tr("Recipe ni ya bidhaa na department ya sasa. Batch inatumia kiasi kilichohifadhiwa kwenye recipe wakati wa production.")}</p>
    </section>
    <section className="rounded-xl border p-4 space-y-4">
      <div><h2 className="text-lg font-semibold">{tr("2. Tengeneza Batch")}</h2><p className="text-sm text-muted-foreground">{tr("Mfumo hukagua stock yote kwanza, kisha hupunguza malighafi na kuongeza bidhaa iliyokamilika.")}</p></div>
      <div className="grid gap-3 md:grid-cols-[1fr_210px_auto] items-end">
        <label className="space-y-1 text-sm">{tr("Bidhaa")}<select className={selectClass} value={batchProductId} onChange={e => { setBatchProductId(e.target.value); setBatchSmall(false); }}><option value="">{tr("-- Chagua bidhaa --")}</option>{productOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="space-y-1 text-sm">{tr("Kiasi cha kutengeneza")}<QtyInput label={tr("Kiasi cha kutengeneza")} value={batchQty} onChange={setBatchQty} info={infoOf(batchProductId)} small={batchSmall} onSmall={setBatchSmall} /></label>
        <Button disabled={busy} onClick={() => void submitBatch()}>Kamilisha Production</Button>
        <Button variant="outline" disabled={busy} onClick={() => void submitClearMinus()}>{tr("Futa minus (tengeneza zilizouzwa)")}</Button>
      </div>
    </section>
    <section className="rounded-xl border p-4 space-y-3"><h2 className="text-lg font-semibold">{tr("Recipes zilizopo")}</h2>{recipes.length === 0 ? <p className="text-sm text-muted-foreground">{tr("Bado hakuna recipe.")}</p> : <div className="space-y-2">{recipes.map((r) => <div key={r._id} className="rounded-lg bg-muted/40 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="font-medium">{r.outputName} · yield {r.outputQty}{r.autoOnSale ? <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">{tr("Inatengenezwa yenyewe mauzoni")}</span> : null}</div><div className="flex gap-1"><Button size="sm" variant="outline" disabled={busy} onClick={() => loadRecipe(r)}>{tr("Hariri")}</Button><Button size="sm" variant="destructive" disabled={busy} onClick={() => void removeRecipe(String(r._id), r.outputName)}>{tr("Futa")}</Button></div></div><div className="text-sm text-muted-foreground">{r.ingredients.map((x) => `${x.productName}: ${x.qty}`).join(" · ")}</div><div className="mt-1 text-sm tabular-nums">{tr("Gharama")}: {r.computedCost.toLocaleString()} · {tr("Bei ya kuuzia")}: {(r.priceFromIngredients ? r.computedPrice : r.outputSellingPrice).toLocaleString()} · {tr("Faida")}: {((r.priceFromIngredients ? r.computedPrice : r.outputSellingPrice) - r.computedCost).toLocaleString()}{r.priceFromIngredients ? <span className="ml-2 rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800">{tr("Bei inafuata viungo")}</span> : null}</div></div>)}</div>}</section>
    <section className="rounded-xl border p-4 space-y-3"><h2 className="text-lg font-semibold">{tr("Production ya karibuni")}</h2>{batches.length === 0 ? <p className="text-sm text-muted-foreground">{tr("Bado hakuna batch iliyokamilika.")}</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">{tr("Tarehe")}</th><th className="p-2">{tr("Bidhaa")}</th><th className="p-2">{tr("Kiasi")}</th><th className="p-2">{tr("Gharama jumla")}</th><th className="p-2">{tr("Gharama/unit")}</th><th className="p-2">{tr("Imerudishwa")}</th><th className="p-2 text-right">{tr("Vitendo")}</th></tr></thead><tbody>{batches.map((b)=>{ const left = Math.round((b.producedQty - (b.returnedQty ?? 0)) * 1e6) / 1e6; return <><tr key={b._id} className="border-b"><td className="p-2">{b.createdAt.slice(0,10)}</td><td className="p-2">{b.outputName}</td><td className="p-2">{b.producedQty}</td><td className="p-2">{b.totalCost.toLocaleString()}</td><td className="p-2">{b.unitCost.toLocaleString()}</td><td className="p-2">{b.returnedQty ?? 0}</td><td className="p-2 text-right"><div className="flex flex-wrap justify-end gap-1">{(b.returnedQty ?? 0) === 0 && !b.notes?.startsWith("Imetengenezwa yenyewe") && <><Button size="sm" variant="outline" disabled={busy} onClick={() => { setRet(null); setEdit(edit?.id === String(b._id) ? null : { id: String(b._id), qty: String(b.producedQty), notes: b.notes ?? "" }); }}>{tr("Hariri")}</Button><Button size="sm" variant="destructive" disabled={busy} onClick={() => void removeBatch(String(b._id), b.outputName)}>{tr("Futa")}</Button></>}{left > 0 && <Button size="sm" variant="outline" onClick={() => { setEdit(null); setRet(ret?.id === String(b._id) ? null : { id: String(b._id), qty: String(left), reason: "" }); }}>{tr("Rudisha kwenye stock")}</Button>}</div></td></tr>{edit?.id === String(b._id) && <tr key={`${b._id}-e`} className="border-b bg-muted/40"><td colSpan={7} className="p-3"><div className="grid gap-2 md:grid-cols-[180px_1fr_auto_auto] items-end"><label className="space-y-1 text-xs">{tr("Kiasi kipya cha production")}<Input type="number" min="0.001" step="any" value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value })} /></label><label className="space-y-1 text-xs">{tr("Maelezo")}<Input value={edit.notes} maxLength={300} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label><Button disabled={busy} onClick={() => void submitEdit()}>{tr("Hifadhi mabadiliko")}</Button><Button variant="outline" disabled={busy} onClick={() => setEdit(null)}>{tr("Ghairi")}</Button></div><p className="mt-2 text-xs text-muted-foreground">{tr("Malighafi na bidhaa iliyokamilika zitarekebishwa kwa tofauti tu. Haiwezekani kama sehemu ya bidhaa imeshauzwa.")}</p></td></tr>}{ret?.id === String(b._id) && <tr key={`${b._id}-r`} className="border-b bg-muted/40"><td colSpan={7} className="p-3"><div className="grid gap-2 md:grid-cols-[160px_1fr_auto] items-end"><label className="space-y-1 text-xs">{tr("Kiasi cha kurudisha (hadi {0})", [left])}<Input type="number" min="0.001" max={left} step="any" value={ret.qty} onChange={(e) => setRet({ ...ret, qty: e.target.value })} /></label><label className="space-y-1 text-xs">{tr("Sababu (lazima)")}<Input value={ret.reason} maxLength={300} placeholder={tr("Mfano: haikuuzwa, batch imezidi")} onChange={(e) => setRet({ ...ret, reason: e.target.value })} /></label><Button disabled={busy} onClick={() => void submitReturn()}>{tr("Thibitisha kurudisha")}</Button></div><p className="mt-2 text-xs text-muted-foreground">{tr("Bidhaa iliyokamilika inapungua, na malighafi zinaongezeka kwa kiasi cha recipe ya batch hii.")}</p></td></tr>}</>; })}</tbody></table></div>}</section>
  </main>;
}
