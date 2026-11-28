import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createScanBuffer, scannerSuffix } from "@/lib/scanner.ts";
import { tr, errorText } from "@/lib/i18n.ts";

type ScanProduct = { _id: Id<"products">; name: string; itemCode?: string; barcode?: string; isMenuItem?: boolean; lastPurchaseCost?: number; weightedAvgCost?: number };
const num = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };

/**
 * Barcode scanner for Purchase Entry. With no box focused, a scan opens a small window:
 *  - product found  -> type the quantity (cost can be changed) and it is added to the purchase table;
 *  - product unknown -> register it right there (name, selling price, buying price; the barcode is filled in) and add it to the purchase.
 */
export default function PurchaseScanner({ products, onAdd }: { products: ScanProduct[]; onAdd: (productId: string, qty: number, unitCost: number) => void }) {
  const settings = useQuery(api.maintenance.getSettings, {});
  const upsert = useMutation(api.products.upsert);
  const hardware = (settings?.app?.hardware ?? {}) as { scannerSuffix?: string };
  const suffix = scannerSuffix(hardware.scannerSuffix);

  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sell, setSell] = useState("");
  const [cost, setCost] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const find = (raw: string) => {
    const c = raw.trim().toLowerCase();
    return products.find((p) => !p.isMenuItem && ((p.barcode ?? "").toLowerCase() === c || (p.itemCode ?? "").toLowerCase() === c));
  };
  const hit = code ? find(code) : undefined;

  // A scan opens the window (always the latest product list).
  const scanRef = useRef<(c: string) => void>(() => undefined);
  scanRef.current = (c) => {
    const p = find(c);
    setCode(c); setQty("1"); setName(""); setSell("");
    setCost(p ? String(p.lastPurchaseCost ?? p.weightedAvgCost ?? 0) : "");
  };
  const open = code !== null;
  useEffect(() => {
    const buf = createScanBuffer(suffix);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const editable = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const scanned = buf.push(e.key, Date.now(), editable);
      if (scanned) { e.preventDefault(); scanRef.current(scanned); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [suffix]);
  useEffect(() => { if (open) window.setTimeout(() => (hit ? qtyRef : nameRef).current?.focus(), 50); }, [open, hit]);

  const close = () => setCode(null);

  function addExisting() {
    if (!hit) return;
    if (!(num(qty) > 0)) { toast.error(tr("Weka idadi.")); return; }
    onAdd(String(hit._id), num(qty), num(cost));
    toast.success(tr("{0} imeongezwa kwenye purchase.", [hit.name]));
    close();
  }

  async function registerNew() {
    if (!code || busy) return;
    if (!name.trim()) { toast.error(tr("Weka jina la bidhaa.")); return; }
    if (!(num(qty) > 0)) { toast.error(tr("Weka idadi.")); return; }
    const used = products.map((p) => /^ITM-(\d+)$/.exec(p.itemCode ?? "")?.[1]).filter(Boolean).map(Number);
    let next = (used.length ? Math.max(...used) : 0) + 1;
    setBusy(true);
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const id = await upsert({ itemCode: `ITM-${String(next).padStart(4, "0")}`, name: name.trim(), barcode: code, sellingPrice: num(sell), openingQty: 0, openingCost: 0, isActive: true, showInSales: true, isStockItem: true });
          onAdd(String(id), num(qty), num(cost));
          toast.success(tr("Bidhaa mpya {0} imesajiliwa na kuongezwa kwenye purchase.", [name.trim()]));
          close();
          return;
        } catch (e) {
          // the code may be taken by an inactive product that is not in this list: try the next number
          if (/Item code .* tayari ipo/.test(errorText(e, ""))) { next += 1; continue; }
          throw e;
        }
      }
      toast.error(tr("Imeshindikana kupata item code mpya. Jaribu tena."));
    } catch (e) {
      toast.error(errorText(e, tr("Imeshindikana kusajili bidhaa.")));
    } finally { setBusy(false); }
  }

  if (!open) return null;
  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); fn(); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm space-y-3 rounded-xl border bg-background p-4 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{hit ? hit.name : tr("Bidhaa mpya")}</h2>
          <Button variant="outline" size="sm" onClick={close}>{tr("Funga")}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{tr("Barcode")}: <b>{code}</b>{!hit && <> · {tr("haipo kwenye mfumo; isajili hapa.")}</>}</p>
        {!hit && (
          <>
            <label className="grid gap-1 text-sm">{tr("Jina la bidhaa")}<Input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">{tr("Bei ya kuuzia")}<Input type="number" min="0" step="any" value={sell} onChange={(e) => setSell(e.target.value)} /></label>
              <label className="grid gap-1 text-sm">{tr("Bei ya kununua")}<Input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
            </div>
          </>
        )}
        {hit && <label className="grid gap-1 text-sm">{tr("Bei ya kununua")}<Input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} /></label>}
        <label className="grid gap-1 text-sm">{tr("Idadi")}<Input ref={qtyRef} type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={onEnter(hit ? addExisting : () => void registerNew())} /></label>
        <Button className="w-full" disabled={busy} onClick={() => (hit ? addExisting() : void registerNew())}>{busy ? tr("Inahifadhi…") : hit ? tr("Weka kwenye purchase") : tr("Sajili na weka kwenye purchase")}</Button>
      </div>
    </div>
  );
}
