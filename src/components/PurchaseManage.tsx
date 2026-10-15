/**
 * Edit / Delete buttons for every purchase document (invoice, order, GRN, return).
 * Which buttons a user sees is decided by two permissions, given to a role (Role Management) or to one
 * user (User Settings): purchasing.edit and purchasing.delete. The server checks them again on every call.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { errorText, tr } from "@/lib/i18n.ts";
import { usePurchaseRights } from "@/hooks/use-purchase-rights.ts";

export type PurchaseDocKind = "invoice" | "order" | "grn" | "return";

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 10 });
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl space-y-4 rounded-xl border bg-background p-4 shadow-xl sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="outline" size="sm" onClick={onClose}>{tr("Funga")}</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Line = { productId: string; qty: string; unitCost: string };
const blankLine = (): Line => ({ productId: "", qty: "1", unitCost: "0" });

function LinesEditor({ lines, onChange, products }: { lines: Line[]; onChange: (l: Line[]) => void; products: Array<{ _id: Id<"products">; name: string }> }) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((n, l) => n + (num(l.qty) || 0) * (num(l.unitCost) || 0), 0);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">{tr("Item Name")}</th><th className="p-2">{tr("Quantity")}</th><th className="p-2">{tr("Cost / Unit")}</th><th className="p-2 text-right">{tr("Total")}</th><th className="p-2" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b">
                <td className="p-2">
                  <select className="h-10 w-full min-w-44 rounded-md border bg-background px-2" value={l.productId} onChange={(e) => set(i, { productId: e.target.value })}>
                    <option value="">{tr("-- Chagua bidhaa --")}</option>
                    {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                </td>
                <td className="p-2"><Input className="w-24" type="number" step="any" min="0" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
                <td className="p-2"><Input className="w-28" type="number" step="any" min="0" value={l.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} /></td>
                <td className="p-2 text-right">{money((num(l.qty) || 0) * (num(l.unitCost) || 0))}</td>
                <td className="p-2"><Button variant="outline" size="sm" disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, x) => x !== i))}>{tr("Ondoa")}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => onChange([...lines, blankLine()])}>{tr("＋ Add Line")}</Button>
        <div className="text-right"><span className="text-sm text-muted-foreground">{tr("Jumla")}: </span><span className="text-lg font-bold">{money(total)}</span></div>
      </div>
    </div>
  );
}

function toLines(lines: Line[]) {
  if (lines.some((l) => !l.productId || !(num(l.qty) > 0) || !(num(l.unitCost) >= 0))) throw new Error(tr("Kila mstari uwe na bidhaa, quantity na gharama sahihi."));
  return lines.map((l) => ({ productId: l.productId as Id<"products">, qty: num(l.qty), unitCost: num(l.unitCost) }));
}

function useSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onClose(); } catch (e) { toast.error(errorText(e, tr("Imeshindikana."))); } finally { setBusy(false); }
  };
  return { busy, run };
}

// ───────────── edit dialogs ─────────────

type Products = Array<{ _id: Id<"products">; name: string }>;
type Suppliers = Array<{ _id: Id<"suppliers">; name: string; isActive: boolean }>;
const asLines = (lines: Array<{ productId: Id<"products">; qty: number; unitCost: number }>): Line[] => lines.map((l) => ({ productId: String(l.productId), qty: String(l.qty), unitCost: String(l.unitCost) }));

function InvoiceEditDialog({ id, onClose }: { id: Id<"purchases">; onClose: () => void }) {
  const data = useQuery(api.purchasingEdit.purchaseForEdit, { purchaseId: id });
  const products = useQuery(api.products.listActive, {});
  return (
    <Overlay title={tr("Hariri Purchase Invoice {0}", [data?.purchase.invoiceNo ?? data?.purchase.internalRef ?? ""])} onClose={onClose}>
      {!data || !products ? <p className="text-sm text-muted-foreground">{tr("Inapakia…")}</p> : data.hasReturns ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{tr("Invoice hii ina Purchase Return. Futa return kwanza ndipo uihariri.")}</p>
      ) : <InvoiceEditForm id={id} data={data} products={products} onClose={onClose} />}
    </Overlay>
  );
}

function InvoiceEditForm({ id, data, products, onClose }: { id: Id<"purchases">; data: { purchase: { purchaseDate: string; supplierInvoiceNo?: string; notes?: string }; lines: Array<{ productId: Id<"products">; qty: number; unitCost: number }> }; products: Products; onClose: () => void }) {
  const edit = useMutation(api.purchasingEdit.editPurchase);
  const { busy, run } = useSave(onClose);
  const [f, setF] = useState({ date: data.purchase.purchaseDate, supInv: data.purchase.supplierInvoiceNo ?? "", notes: data.purchase.notes ?? "", lines: asLines(data.lines) });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">{tr("Tarehe")}<Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">{tr("Namba ya invoice ya supplier")}<Input value={f.supInv} onChange={(e) => setF({ ...f, supInv: e.target.value })} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2">{tr("Maelezo")}<Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>
      <LinesEditor lines={f.lines} onChange={(lines) => setF({ ...f, lines })} products={products} />
      <p className="text-xs text-muted-foreground">{tr("Stock na deni la supplier vitarekebishwa kwa tofauti tu. Kilicholipwa tayari hakibadilishwi.")}</p>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void run(() => edit({ purchaseId: id, purchaseDate: f.date, supplierInvoiceNo: f.supInv, notes: f.notes, lines: toLines(f.lines) }), tr("Invoice imehaririwa."))}>{tr("Hifadhi mabadiliko")}</Button>
        <Button variant="outline" onClick={onClose}>{tr("Ghairi")}</Button>
      </div>
    </>
  );
}

function OrderEditDialog({ id, onClose }: { id: Id<"purchaseOrders">; onClose: () => void }) {
  const data = useQuery(api.purchasingEdit.orderForEdit, { orderId: id });
  const products = useQuery(api.products.listActive, {});
  const suppliers = useQuery(api.suppliers.list, {});
  return (
    <Overlay title={tr("Hariri Purchase Order {0}", [data?.order.orderRef ?? ""])} onClose={onClose}>
      {!data || !products || !suppliers ? <p className="text-sm text-muted-foreground">{tr("Inapakia…")}</p> : data.received ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{tr("Order hii ina bidhaa zilizopokelewa (GRN). Futa GRN kwanza ndipo uihariri.")}</p>
      ) : <OrderEditForm id={id} data={data} products={products} suppliers={suppliers} onClose={onClose} />}
    </Overlay>
  );
}

function OrderEditForm({ id, data, products, suppliers, onClose }: { id: Id<"purchaseOrders">; data: { order: { supplierId: Id<"suppliers">; orderDate: string; expectedDelivery?: string; notes?: string }; lines: Array<{ productId: Id<"products">; qty: number; unitCost: number }> }; products: Products; suppliers: Suppliers; onClose: () => void }) {
  const edit = useMutation(api.purchasingEdit.editPurchaseOrder);
  const { busy, run } = useSave(onClose);
  const [f, setF] = useState({ supplierId: String(data.order.supplierId), date: data.order.orderDate, expected: data.order.expectedDelivery ?? "", notes: data.order.notes ?? "", lines: asLines(data.lines) });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">{tr("Supplier")}
          <select className="h-10 rounded-md border bg-background px-3" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
            {suppliers.filter((s) => s.isActive || String(s._id) === f.supplierId).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">{tr("Tarehe")}<Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">{tr("Expected")}<Input type="date" value={f.expected} onChange={(e) => setF({ ...f, expected: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">{tr("Maelezo")}<Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>
      <LinesEditor lines={f.lines} onChange={(lines) => setF({ ...f, lines })} products={products} />
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void run(() => edit({ orderId: id, supplierId: f.supplierId as Id<"suppliers">, orderDate: f.date, expectedDelivery: f.expected, notes: f.notes, lines: toLines(f.lines) }), tr("Order imehaririwa."))}>{tr("Hifadhi mabadiliko")}</Button>
        <Button variant="outline" onClick={onClose}>{tr("Ghairi")}</Button>
      </div>
    </>
  );
}

function GrnEditDialog({ id, onClose }: { id: Id<"goodsReceivedNotes">; onClose: () => void }) {
  const data = useQuery(api.purchasingEdit.grnForEdit, { grnId: id });
  const products = useQuery(api.products.listActive, {});
  return (
    <Overlay title={tr("Hariri GRN {0}", [data?.grn.grnRef ?? ""])} onClose={onClose}>
      {!data || !products ? <p className="text-sm text-muted-foreground">{tr("Inapakia…")}</p> : <GrnEditForm id={id} data={data} products={products} onClose={onClose} />}
    </Overlay>
  );
}

function GrnEditForm({ id, data, products, onClose }: { id: Id<"goodsReceivedNotes">; data: { grn: { receiptDate: string; notes?: string }; lines: Array<{ productId: Id<"products">; qtyReceived: number; qtyRejected: number }> }; products: Products; onClose: () => void }) {
  const edit = useMutation(api.purchasingEdit.editGoodsReceivedNote);
  const { busy, run } = useSave(onClose);
  const [f, setF] = useState({ date: data.grn.receiptDate, notes: data.grn.notes ?? "", lines: data.lines.map((l) => ({ productId: String(l.productId), received: String(l.qtyReceived), rejected: String(l.qtyRejected) })) });
  const nameOf = (pid: string) => products.find((p) => String(p._id) === pid)?.name ?? "—";
  const setLine = (i: number, patch: Partial<(typeof f.lines)[number]>) => setF({ ...f, lines: f.lines.map((x, y) => (y === i ? { ...x, ...patch } : x)) });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">{tr("Tarehe")}<Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">{tr("Maelezo")}<Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">{tr("Item Name")}</th><th className="p-2">{tr("Imepokelewa")}</th><th className="p-2">{tr("Imekataliwa")}</th></tr></thead>
          <tbody>
            {f.lines.map((l, i) => (
              <tr key={l.productId} className="border-b">
                <td className="p-2">{nameOf(l.productId)}</td>
                <td className="p-2"><Input className="w-24" type="number" step="any" min="0" value={l.received} onChange={(e) => setLine(i, { received: e.target.value })} /></td>
                <td className="p-2"><Input className="w-24" type="number" step="any" min="0" value={l.rejected} onChange={(e) => setLine(i, { rejected: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void run(() => edit({ grnId: id, receiptDate: f.date, notes: f.notes, lines: f.lines.map((l) => ({ productId: l.productId as Id<"products">, qtyReceived: num(l.received) || 0, qtyRejected: num(l.rejected) || 0 })) }), tr("GRN imehaririwa."))}>{tr("Hifadhi mabadiliko")}</Button>
        <Button variant="outline" onClick={onClose}>{tr("Ghairi")}</Button>
      </div>
    </>
  );
}

// ───────────── the buttons ─────────────

const EDITABLE: Record<PurchaseDocKind, string[]> = { invoice: ["posted"], order: ["draft", "pending_approval", "approved"], grn: ["draft"], return: [] };
const DELETABLE: Record<PurchaseDocKind, string[]> = { invoice: ["posted"], order: ["draft", "pending_approval", "approved"], grn: ["draft", "confirmed"], return: ["posted"] };

/** Edit and Delete buttons for one purchase document. Shows only what the signed-in user is allowed to do. */
export function PurchaseDocActions({ kind, id, status }: { kind: PurchaseDocKind; id: string; status: string }) {
  const { canEdit, canDelete } = usePurchaseRights();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const voidInvoice = useMutation(api.purchasingEdit.voidPurchase);
  const cancelOrder = useMutation(api.purchasingEdit.cancelPurchaseOrder);
  const cancelGrn = useMutation(api.purchasingEdit.cancelGoodsReceivedNote);
  const voidReturn = useMutation(api.purchasingEdit.voidPurchaseReturn);
  const showEdit = canEdit && EDITABLE[kind].includes(status);
  const showDelete = canDelete && DELETABLE[kind].includes(status);
  if (!showEdit && !showDelete) return null;

  const warn: Record<PurchaseDocKind, string> = {
    invoice: tr("Futa purchase invoice hii? Stock itatolewa, malipo ya wakati wa kupokea yatarudishwa na deni la supplier litafutwa. Andika sababu (hiari) kisha bonyeza OK."),
    order: tr("Futa purchase order hii? Andika sababu (hiari) kisha bonyeza OK."),
    grn: status === "confirmed" ? tr("Futa GRN hii? Bidhaa zilizopokelewa zitatolewa kwenye stock. Andika sababu (hiari) kisha bonyeza OK.") : tr("Futa GRN hii? Andika sababu (hiari) kisha bonyeza OK."),
    return: tr("Futa purchase return hii? Bidhaa zitarudi kwenye stock na deni la supplier litarudishwa. Andika sababu (hiari) kisha bonyeza OK."),
  };
  const remove = async () => {
    const reason = window.prompt(warn[kind]);
    if (reason === null) return;
    setBusy(true);
    try {
      const r = reason.trim() || undefined;
      if (kind === "invoice") await voidInvoice({ purchaseId: id as Id<"purchases">, reason: r });
      else if (kind === "order") await cancelOrder({ orderId: id as Id<"purchaseOrders">, reason: r });
      else if (kind === "grn") await cancelGrn({ grnId: id as Id<"goodsReceivedNotes">, reason: r });
      else await voidReturn({ returnId: id as Id<"purchaseReturns">, reason: r });
      toast.success(tr("Imefutwa."));
    } catch (e) { toast.error(errorText(e, tr("Imeshindikana kufuta."))); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="flex flex-wrap gap-1 print:hidden">
        {showEdit && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => setEditing(true)}>{tr("Edit")}</Button>}
        {showDelete && <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void remove()}>{tr("Futa")}</Button>}
      </div>
      {editing && kind === "invoice" && <InvoiceEditDialog id={id as Id<"purchases">} onClose={() => setEditing(false)} />}
      {editing && kind === "order" && <OrderEditDialog id={id as Id<"purchaseOrders">} onClose={() => setEditing(false)} />}
      {editing && kind === "grn" && <GrnEditDialog id={id as Id<"goodsReceivedNotes">} onClose={() => setEditing(false)} />}
    </>
  );
}

/** Purchase Entry list: the latest invoices, each with its Edit / Delete buttons. */
export function PurchaseListTable({ purchases }: { purchases: Array<{ _id: Id<"purchases">; invoiceNo?: string; supplierInvoiceNo?: string; internalRef: string; purchaseDate: string; total: number; amountPaid: number; outstanding: number; paymentStatus: string; status: string }> }) {
  const { canEdit, canDelete } = usePurchaseRights();
  const rows = purchases.slice(0, 30);
  const withActions = canEdit || canDelete;
  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="border-b p-4 font-semibold">{tr("Purchase zilizopostiwa")} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>{[tr("Invoice Na."), tr("Supplier Invoice"), tr("Reference"), tr("Tarehe"), tr("Jumla"), tr("Imelipwa"), tr("Deni"), tr("Hali")].map((h) => <th key={h} className="whitespace-nowrap bg-muted/50 p-3">{h}</th>)}{withActions && <th className="bg-muted/50 p-3">{tr("Vitendo")}</th>}</tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x._id} className="border-t">
                <td className="whitespace-nowrap p-3">{x.invoiceNo ?? "—"}</td><td className="whitespace-nowrap p-3">{x.supplierInvoiceNo ?? "—"}</td><td className="whitespace-nowrap p-3">{x.internalRef}</td>
                <td className="whitespace-nowrap p-3">{x.purchaseDate}</td><td className="whitespace-nowrap p-3">{money(x.total)}</td><td className="whitespace-nowrap p-3">{money(x.amountPaid)}</td><td className="whitespace-nowrap p-3">{money(x.outstanding)}</td><td className="whitespace-nowrap p-3">{x.status === "cancelled" ? tr("Imefutwa") : x.paymentStatus}</td>
                {withActions && <td className="p-3"><PurchaseDocActions kind="invoice" id={x._id} status={x.status} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-5 text-sm text-muted-foreground">{tr("Hakuna taarifa bado.")}</p>}
      </div>
    </section>
  );
}
