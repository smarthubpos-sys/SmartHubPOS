import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { errorText, tr } from "@/lib/i18n.ts";

type IngredientLine = { productId: string; qty: string };
export default function ProductionPage() {
  const products = useQuery(api.products.listActive, {});
  const recipes = useQuery(api.production.listRecipes, {});
  const batches = useQuery(api.production.recentBatches, {});
  const saveRecipe = useMutation(api.production.saveRecipe);
  const produceBatch = useMutation(api.production.produceBatch);
  const returnToStock = useMutation(api.production.returnToStock);
  const [ret, setRet] = useState<{ id: string; qty: string; reason: string } | null>(null);
  const [outputProductId, setOutputProductId] = useState("");
  const [outputQty, setOutputQty] = useState("1");
  const [autoOnSale, setAutoOnSale] = useState(true);
  const [ingredients, setIngredients] = useState<IngredientLine[]>([{ productId: "", qty: "1" }]);
  const [batchProductId, setBatchProductId] = useState("");
  const [batchQty, setBatchQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const productOptions = useMemo(() => (products ?? []).map((p) => ({ id: String(p._id), name: p.name, qty: p.currentQty })), [products]);
  const submitRecipe = async () => {
    if (!outputProductId || ingredients.some(x => !x.productId || !(Number(x.qty) > 0)) || !(Number(outputQty) > 0)) return toast.error("Jaza bidhaa ya mwisho, yield na malighafi zote.");
    setBusy(true);
    try {
      await saveRecipe({ outputProductId: outputProductId as never, outputQty: Number(outputQty), active: true, autoOnSale, ingredients: ingredients.map(x => ({ productId: x.productId as never, qty: Number(x.qty) })) });
      toast.success("Recipe imehifadhiwa.");
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuhifadhi recipe.")); }
    finally { setBusy(false); }
  };
  const submitBatch = async () => {
    if (!batchProductId || !(Number(batchQty) > 0)) return toast.error("Chagua bidhaa na kiasi cha production.");
    setBusy(true);
    try {
      const result = await produceBatch({ outputProductId: batchProductId as never, quantity: Number(batchQty) });
      toast.success(`Production imekamilika. Gharama jumla: ${result.totalCost.toLocaleString()}`);
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
  const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
  if (products === undefined || recipes === undefined || batches === undefined) return <div className="p-6">{tr("Inapakia Production…")}</div>;
  return <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
    <header><h1 className="text-2xl font-bold">{tr("Back Office · Production")}</h1><p className="mt-1 text-sm text-muted-foreground">{tr("Tengeneza recipes na uzalishe batch kwa kutumia stock ya malighafi.")}</p></header>
    <section className="rounded-xl border p-4 space-y-4">
      <div><h2 className="text-lg font-semibold">{tr("1. Recipe / Viambato")}</h2><p className="text-sm text-muted-foreground">{tr("Chagua bidhaa ya mwisho, kisha weka malighafi na kiasi kinachotumika kwa yield moja.")}</p></div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">{tr("Bidhaa inayotengenezwa")}<select className={selectClass} value={outputProductId} onChange={e => setOutputProductId(e.target.value)}><option value="">-- Chagua bidhaa --</option>{productOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="space-y-1 text-sm">{tr("Yield ya recipe (idadi inayotengenezwa)")}<Input type="number" min="0.001" step="any" value={outputQty} onChange={e => setOutputQty(e.target.value)} /></label>
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={autoOnSale} onChange={e => setAutoOnSale(e.target.checked)} /><span><b>{tr("Tengeneza yenyewe mauzo yanapofanyika")}</b><br /><span className="text-muted-foreground">{tr("Mhudumu akiuza bidhaa hii, mfumo unapunguza viungo kwenye stock yenyewe (bila kutengeneza batch kwanza).")}</span></span></label>
      <div className="space-y-2">{ingredients.map((line, i) => <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-2">
        <select className={selectClass} value={line.productId} onChange={e => setIngredients(prev => prev.map((x,j) => j === i ? {...x, productId:e.target.value} : x))}><option value="">-- Malighafi --</option>{productOptions.filter(p => p.id !== outputProductId).map(p => <option key={p.id} value={p.id}>{p.name} (stock {p.qty})</option>)}</select>
        <Input type="number" min="0.001" step="any" aria-label="Kiasi cha malighafi" value={line.qty} onChange={e => setIngredients(prev => prev.map((x,j) => j === i ? {...x, qty:e.target.value} : x))} />
        <Button variant="outline" disabled={ingredients.length === 1} onClick={() => setIngredients(prev => prev.filter((_,j) => j !== i))}>Ondoa</Button>
      </div>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setIngredients(prev => [...prev,{productId:"",qty:"1"}])}>+ Ongeza malighafi</Button><Button disabled={busy} onClick={() => void submitRecipe()}>Hifadhi Recipe</Button></div>
      <p className="text-xs text-muted-foreground">{tr("Recipe ni ya bidhaa na department ya sasa. Batch inatumia kiasi kilichohifadhiwa kwenye recipe wakati wa production.")}</p>
    </section>
    <section className="rounded-xl border p-4 space-y-4">
      <div><h2 className="text-lg font-semibold">{tr("2. Tengeneza Batch")}</h2><p className="text-sm text-muted-foreground">{tr("Mfumo hukagua stock yote kwanza, kisha hupunguza malighafi na kuongeza bidhaa iliyokamilika.")}</p></div>
      <div className="grid gap-3 md:grid-cols-[1fr_180px_auto] items-end">
        <label className="space-y-1 text-sm">{tr("Bidhaa")}<select className={selectClass} value={batchProductId} onChange={e => setBatchProductId(e.target.value)}><option value="">-- Chagua bidhaa --</option>{productOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="space-y-1 text-sm">{tr("Kiasi cha kutengeneza")}<Input type="number" min="0.001" step="any" value={batchQty} onChange={e => setBatchQty(e.target.value)} /></label>
        <Button disabled={busy} onClick={() => void submitBatch()}>Kamilisha Production</Button>
      </div>
    </section>
    <section className="rounded-xl border p-4 space-y-3"><h2 className="text-lg font-semibold">{tr("Recipes zilizopo")}</h2>{recipes.length === 0 ? <p className="text-sm text-muted-foreground">Bado hakuna recipe.</p> : <div className="space-y-2">{recipes.map((r) => <div key={r._id} className="rounded-lg bg-muted/40 p-3"><div className="font-medium">{r.outputName} · yield {r.outputQty}{r.autoOnSale ? <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">{tr("Inatengenezwa yenyewe mauzoni")}</span> : null}</div><div className="text-sm text-muted-foreground">{r.ingredients.map((x) => `${x.productName}: ${x.qty}`).join(" · ")}</div></div>)}</div>}</section>
    <section className="rounded-xl border p-4 space-y-3"><h2 className="text-lg font-semibold">{tr("Production ya karibuni")}</h2>{batches.length === 0 ? <p className="text-sm text-muted-foreground">Bado hakuna batch iliyokamilika.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Tarehe</th><th className="p-2">Bidhaa</th><th className="p-2">Kiasi</th><th className="p-2">Gharama jumla</th><th className="p-2">Gharama/unit</th><th className="p-2">{tr("Imerudishwa")}</th><th className="p-2" /></tr></thead><tbody>{batches.map((b)=>{ const left = Math.round((b.producedQty - (b.returnedQty ?? 0)) * 1e6) / 1e6; return <><tr key={b._id} className="border-b"><td className="p-2">{b.createdAt.slice(0,10)}</td><td className="p-2">{b.outputName}</td><td className="p-2">{b.producedQty}</td><td className="p-2">{b.totalCost.toLocaleString()}</td><td className="p-2">{b.unitCost.toLocaleString()}</td><td className="p-2">{b.returnedQty ?? 0}</td><td className="p-2 text-right">{left > 0 && <Button size="sm" variant="outline" onClick={() => setRet(ret?.id === String(b._id) ? null : { id: String(b._id), qty: String(left), reason: "" })}>{tr("Rudisha kwenye stock")}</Button>}</td></tr>{ret?.id === String(b._id) && <tr key={`${b._id}-r`} className="border-b bg-muted/40"><td colSpan={7} className="p-3"><div className="grid gap-2 md:grid-cols-[160px_1fr_auto] items-end"><label className="space-y-1 text-xs">{tr("Kiasi cha kurudisha (hadi {0})", [left])}<Input type="number" min="0.001" max={left} step="any" value={ret.qty} onChange={(e) => setRet({ ...ret, qty: e.target.value })} /></label><label className="space-y-1 text-xs">{tr("Sababu (lazima)")}<Input value={ret.reason} maxLength={300} placeholder={tr("Mfano: haikuuzwa, batch imezidi")} onChange={(e) => setRet({ ...ret, reason: e.target.value })} /></label><Button disabled={busy} onClick={() => void submitReturn()}>{tr("Thibitisha kurudisha")}</Button></div><p className="mt-2 text-xs text-muted-foreground">{tr("Bidhaa iliyokamilika inapungua, na malighafi zinaongezeka kwa kiasi cha recipe ya batch hii.")}</p></td></tr>}</>; })}</tbody></table></div>}</section>
  </main>;
}
