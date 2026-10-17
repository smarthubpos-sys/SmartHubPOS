import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { PageHeader, Panel } from "@/components/page-kit.tsx";
import { errorText, tr } from "@/lib/i18n.ts";

export default function WarehousePage() {
  const warehouses = useQuery(api.warehouses.list, {});
  const balances = useQuery(api.warehouses.stockBalances, {});
  const products = useQuery(api.products.listActive, {});
  const transfers = useQuery(api.warehouses.transfers, {});
  const createWarehouse = useMutation(api.warehouses.create);
  const receive = useMutation(api.warehouses.receive);
  const createTransfer = useMutation(api.warehouses.createTransfer);
  const dispatch = useMutation(api.warehouses.dispatchTransfer);
  const receiveTransfer = useMutation(api.warehouses.receiveTransfer);
  const cancelTransfer = useMutation(api.warehouses.cancelTransfer);
  const rejectTransfer = useMutation(api.warehouses.rejectTransfer);
  const recordWastage = useMutation(api.warehouses.recordWastage);
  const valuation = useQuery(api.warehouses.valuation, {});
  const lossReport = useQuery(api.warehouses.lossReport, {});
  const ledger = useQuery(api.warehouses.movements, { limit: 30 });
  // One idempotency key per form attempt: a double click or a retry sends the SAME key, so the server applies it once.
  const keys = useRef<Record<string, string>>({});
  const idem = (name: string) => (keys.current[name] ??= crypto.randomUUID());
  const resetIdem = (name: string) => { delete keys.current[name]; };
  const [wWarehouse, setWWarehouse] = useState(""); const [wProduct, setWProduct] = useState(""); const [wQty, setWQty] = useState("1"); const [wReason, setWReason] = useState("");
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [kind, setKind] = useState("warehouse");
  const [warehouseId, setWarehouseId] = useState(""); const [productId, setProductId] = useState(""); const [qty, setQty] = useState("1"); const [cost, setCost] = useState("0");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [transferProduct, setTransferProduct] = useState(""); const [transferQty, setTransferQty] = useState("1");
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, success: string) { setBusy(true); try { await fn(); toast.success(success); } catch (e) { toast.error(errorText(e, "Kitendo kimeshindikana.")); } finally { setBusy(false); } }
  return <div className="space-y-5">
    <PageHeader title={tr("Store / Ghala")} subtitle={tr("Stock tofauti kwa kila ghala, uhamisho wenye uthibitisho na thamani ya stock kwa gharama.")} />
    <Panel title={tr("Ongeza ghala au eneo la mauzo")}>
      <form className="grid gap-3 md:grid-cols-4" onSubmit={e => { e.preventDefault(); void run(async () => { await createWarehouse({ code, name, kind }); setCode(""); setName(""); }, "Ghala limehifadhiwa."); }}>
        <input className="rounded-md border bg-background px-3 py-2" placeholder={tr("Code mfano WH1")} value={code} onChange={e=>setCode(e.target.value)} required />
        <input className="rounded-md border bg-background px-3 py-2" placeholder={tr("Jina la ghala") } value={name} onChange={e=>setName(e.target.value)} required />
        <select className="rounded-md border bg-background px-3 py-2" value={kind} onChange={e=>setKind(e.target.value)}><option value="warehouse">Ghala</option><option value="shop">Duka / eneo la mauzo</option><option value="store">Store</option></select>
        <Button type="submit" disabled={busy}>{tr("Hifadhi eneo")}</Button>
      </form>
    </Panel>
    <Panel title={tr("Pokea bidhaa kwenye ghala")}>
      <form className="grid gap-3 md:grid-cols-5" onSubmit={e => { e.preventDefault(); void run(async () => { await receive({ idempotencyKey: idem("receive"), warehouseId: warehouseId as never, productId: productId as never, quantity: Number(qty), unitCost: Number(cost) }); resetIdem("receive"); }, "Stock imepokelewa."); }}>
        <select className="rounded-md border bg-background px-3 py-2" value={warehouseId} onChange={e=>setWarehouseId(e.target.value)} required><option value="">Chagua ghala</option>{(warehouses??[]).map(w=><option key={w._id} value={w._id}>{w.code} — {w.name}</option>)}</select>
        <select className="rounded-md border bg-background px-3 py-2" value={productId} onChange={e=>setProductId(e.target.value)} required><option value="">Chagua bidhaa</option>{(products??[]).map(p=><option key={p._id} value={p._id}>{p.itemCode} — {p.name}</option>)}</select>
        <input className="rounded-md border bg-background px-3 py-2" type="number" min="0.0001" step="any" value={qty} onChange={e=>setQty(e.target.value)} required />
        <input className="rounded-md border bg-background px-3 py-2" type="number" min="0" step="any" placeholder={tr("Gharama kwa unit") } value={cost} onChange={e=>setCost(e.target.value)} required />
        <Button type="submit" disabled={busy}>{tr("Pokea")}</Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">{tr("Chagua bidhaa kwenye orodha; hutahitaji kuingiza Product ID kwa mkono. Stock hii ya ghala haibadilishi moja kwa moja stock ya eneo la mauzo.")}</p>
    </Panel>
    <Panel title={tr("Stock kwa eneo — thamani kwa gharama") }>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{[tr("Ghala"),tr("Code"),tr("Bidhaa"),tr("Kiasi"),tr("Gharama/unit"),tr("Thamani ya stock")].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{(balances??[]).map(x=><tr className="border-t" key={x._id}><td className="p-2">{x.warehouseName}</td><td className="p-2">{x.itemCode}</td><td className="p-2">{x.productName}</td><td className="p-2">{x.quantity.toLocaleString()}</td><td className="p-2">{x.averageCost.toLocaleString()}</td><td className="p-2">{x.stockValue.toLocaleString()}</td></tr>)}</tbody></table></div>
    </Panel>
    <Panel title={tr("Unda uhamisho wa stock") }>
      <form className="grid gap-3 md:grid-cols-5" onSubmit={e=>{e.preventDefault(); void run(async()=>{await createTransfer({idempotencyKey:idem("transfer"),fromWarehouseId:from as never,toWarehouseId:to as never,lines:[{productId:transferProduct as never,quantity:Number(transferQty)}]}); resetIdem("transfer");},"Uhamisho umeundwa na unasubiri kutumwa.");}}>
        <select className="rounded-md border bg-background px-3 py-2" value={from} onChange={e=>setFrom(e.target.value)} required><option value="">Kutoka ghala</option>{(warehouses??[]).map(w=><option key={w._id} value={w._id}>{w.name}</option>)}</select>
        <select className="rounded-md border bg-background px-3 py-2" value={to} onChange={e=>setTo(e.target.value)} required><option value="">Kwenda ghala</option>{(warehouses??[]).map(w=><option key={w._id} value={w._id}>{w.name}</option>)}</select>
        <select className="rounded-md border bg-background px-3 py-2" value={transferProduct} onChange={e=>setTransferProduct(e.target.value)} required><option value="">Chagua bidhaa</option>{(products??[]).map(p=><option key={p._id} value={p._id}>{p.itemCode} — {p.name}</option>)}</select>
        <input className="rounded-md border bg-background px-3 py-2" type="number" min="0.0001" step="any" value={transferQty} onChange={e=>setTransferQty(e.target.value)} required />
        <Button type="submit" disabled={busy}>{tr("Unda uhamisho")}</Button>
      </form>
    </Panel>
    <Panel title={tr("Uhamisho unaosubiri / historia") }>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{[tr("Namba"),tr("Kutoka"),tr("Kwenda"),tr("Hali"),tr("Tarehe"),tr("Kitendo")].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{(transfers??[]).map(t=><tr className="border-t" key={t._id}><td className="p-2">{t.transferNo}</td><td className="p-2">{t.from}</td><td className="p-2">{t.to}</td><td className="p-2">{t.status}</td><td className="p-2">{new Date(t.createdAt).toLocaleString()}</td><td className="p-2">{t.status==="pending"?<Button size="sm" disabled={busy} onClick={()=>void run(()=>dispatch({transferId:t._id}),"Uhamisho umetumwa; unasubiri kupokelewa.")}>{tr("Tuma")}</Button>:t.status==="in_transit"?<Button size="sm" disabled={busy} onClick={()=>{ const lines = t.lines.map(line => { const product = (products??[]).find(p=>p._id===line.productId); const raw = prompt(`${product?.name ?? product?.itemCode ?? "Bidhaa"}: kiasi kilichopokelewa (kilichotumwa ${line.quantity})`, String(line.quantity)); if (raw === null || raw.trim() === "") return null; const receivedQuantity = Number(raw); if (!Number.isFinite(receivedQuantity) || receivedQuantity < 0) { toast.error("Kiasi kilichopokelewa si sahihi."); return null; } let differenceNote: string | undefined; if (receivedQuantity !== line.quantity) { differenceNote = prompt("Eleza sababu ya tofauti ya stock:") ?? ""; if (!differenceNote.trim()) { toast.error("Sababu ya tofauti inahitajika."); return null; } } return { lineId: line._id, receivedQuantity, differenceNote }; }); if (lines.some(x=>x===null)) return; void run(()=>receiveTransfer({transferId:t._id,lines:lines as {lineId: typeof t.lines[number]["_id"]; receivedQuantity:number; differenceNote?:string}[]}),"Kupokea stock kumethibitishwa."); }}>{tr("Thibitisha kupokea")}</Button>:tr("—")}{t.status==="pending" && <Button size="sm" variant="outline" className="ml-2" disabled={busy} onClick={()=>{ const reason = prompt(tr("Sababu ya kufuta uhamisho huu:")); if (reason?.trim()) void run(()=>cancelTransfer({transferId:t._id,reason}),"Uhamisho umefutwa."); }}>{tr("Futa")}</Button>}{t.status==="in_transit" && <Button size="sm" variant="outline" className="ml-2" disabled={busy} onClick={()=>{ const reason = prompt(tr("Sababu ya kukataa mzigo huu (stock itarudi kwa mtumaji):")); if (reason?.trim()) void run(()=>rejectTransfer({transferId:t._id,reason}),"Mzigo umekataliwa; stock imerudi."); }}>{tr("Kataa")}</Button>}</td></tr>)}</tbody></table></div>
      <p className="mt-2 text-xs text-muted-foreground">{tr("Uthibitisho wa kupokea utafanyika kupitia receiveTransfer API; tofauti lazima ziwe na sababu. Stock ya chanzo hupunguzwa wakati wa kutuma.")}</p>
    </Panel>
    <Panel title={tr("Rekodi upotevu / uharibifu (wastage)")}>
      <form className="grid gap-3 md:grid-cols-5" onSubmit={e=>{e.preventDefault(); void run(async()=>{await recordWastage({idempotencyKey:idem("wastage"),warehouseId:wWarehouse as never,productId:wProduct as never,quantity:Number(wQty),reason:wReason}); resetIdem("wastage"); setWReason("");},"Wastage imerekodiwa.");}}>
        <select className="rounded-md border bg-background px-3 py-2" value={wWarehouse} onChange={e=>setWWarehouse(e.target.value)} required><option value="">Chagua ghala</option>{(warehouses??[]).map(w=><option key={w._id} value={w._id}>{w.name}</option>)}</select>
        <select className="rounded-md border bg-background px-3 py-2" value={wProduct} onChange={e=>setWProduct(e.target.value)} required><option value="">Chagua bidhaa</option>{(products??[]).map(p=><option key={p._id} value={p._id}>{p.itemCode} — {p.name}</option>)}</select>
        <input className="rounded-md border bg-background px-3 py-2" type="number" min="0.0001" step="any" value={wQty} onChange={e=>setWQty(e.target.value)} required />
        <input className="rounded-md border bg-background px-3 py-2" placeholder={tr("Sababu (lazima)")} value={wReason} onChange={e=>setWReason(e.target.value)} required />
        <Button type="submit" disabled={busy}>{tr("Rekodi")}</Button>
      </form>
    </Panel>
    <Panel title={tr("Thamani ya stock na hasara")}>
      <p className="text-sm">{tr("Thamani ya stock yote (gharama ya wastani)")}: <b>{(valuation?.total ?? 0).toLocaleString()}</b> · {tr("Hasara (upungufu, vilivyoharibika, wastage)")}: <b>{(lossReport?.totalValue ?? 0).toLocaleString()}</b></p>
    </Panel>
    <Panel title={tr("Ledger ya movement (za karibuni)")}>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{[tr("Tarehe"),tr("Aina"),tr("Ingia"),tr("Toka"),tr("Baki"),tr("Sababu")].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{(ledger?.rows??[]).map(m=><tr className="border-t" key={m._id}><td className="p-2">{new Date(m.createdAt).toLocaleString()}</td><td className="p-2">{m.movementType}</td><td className="p-2">{m.quantityIn}</td><td className="p-2">{m.quantityOut}{m.quantityLost ? ` (+${m.quantityLost} lost)` : ""}</td><td className="p-2">{m.balance}</td><td className="p-2">{m.reason ?? m.notes ?? ""}</td></tr>)}</tbody></table></div>
    </Panel>
  </div>;
}
