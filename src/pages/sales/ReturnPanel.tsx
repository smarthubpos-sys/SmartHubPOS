import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmt, num, round2 } from "@/pages/shared/report-utils.ts";
import { errorText, tr } from "@/lib/i18n.ts";
import { localDate } from "@/lib/format.ts";
import { methodArgs, pickMethodKey, usePaymentMethods } from "@/hooks/use-payment-methods.ts";

/**
 * Partial sales return: pick the lines and the quantities the customer brings back.
 * The server (sales.returnItems) reduces the customer's debt first and refunds only the rest.
 */
export default function ReturnPanel({ invoiceId, onClose }: { invoiceId: Id<"invoices">; onClose: () => void }) {
  const data = useQuery(api.sales.returnableLines, { invoiceId });
  const returnItems = useMutation(api.sales.returnItems);
  const methods = usePaymentMethods();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(localDate());
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);

  // Estimate shown before saving (the server recalculates exactly): value returned = Σ qty × net unit price, plus tax.
  const est = useMemo(() => {
    if (!data) return { net: 0, tax: 0, total: 0, credit: 0, refund: 0 };
    const net = round2(data.lines.reduce((n, l) => n + Math.min(num(qty[String(l._id)]), l.remaining) * l.unitNet, 0));
    const tax = round2(net * data.taxRate);
    const total = round2(net + tax);
    const credit = round2(Math.min(data.outstanding, total));
    return { net, tax, total, credit, refund: round2(total - credit) };
  }, [data, qty]);

  if (data === undefined) return <section className="rounded-xl border p-4 text-sm text-muted-foreground">{tr("Inapakia…")}</section>;
  if (data === null) return <section className="rounded-xl border p-4 text-sm">{tr("Invoice haipatikani.")} <Button size="sm" variant="outline" onClick={onClose}>{tr("Funga")}</Button></section>;

  const chosen = data.lines.filter((l) => num(qty[String(l._id)]) > 0);
  const submit = async () => {
    if (!chosen.length) { toast.error(tr("Weka kiasi cha angalau bidhaa moja inayorudishwa.")); return; }
    for (const l of chosen) if (num(qty[String(l._id)]) > l.remaining + 1e-8) { toast.error(tr("Huwezi kurudisha zaidi ya kilichobaki: {0}", [l.productName])); return; }
    setBusy(true);
    try {
      const m = methodArgs(methods, pickMethodKey(methods, method));
      const r = await returnItems({
        invoiceId, reason: reason.trim() || undefined, returnDate: date,
        lines: chosen.map((l) => ({ invoiceLineId: l._id, qty: num(qty[String(l._id)]) })),
        ...(est.refund > 0 ? { refundMethod: m.method, refundMethodId: m.methodId } : {}),
      });
      toast.success(tr("Marejesho {0} yamehifadhiwa. Deni limepunguzwa: {1}. Yaliyorudishwa kwa mteja: {2}.", [r.returnRef, fmt(r.creditedToDebt), fmt(r.refunded)]));
      onClose();
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuhifadhi marejesho.")); }
    finally { setBusy(false); }
  };

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{tr("Rejesha bidhaa za invoice {0}", [data.invoiceNo])}</h2>
        <Button variant="outline" size="sm" onClick={onClose}>{tr("Funga")}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{tr("Weka kiasi kinachorudishwa kwa kila bidhaa. Deni la mteja linapunguzwa kwanza; kilichobaki kinarudishwa kwake kutoka kwenye njia ya malipo utakayochagua.")}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left">{[tr("Bidhaa"), tr("Iliyouzwa"), tr("Iliyorudishwa"), tr("Inayoweza kurudishwa"), tr("Bei halisi"), tr("Kurudisha sasa")].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
        <tbody>{data.lines.map((l) => {
          const id = String(l._id);
          return <tr key={id} className="border-b">
            <td className="p-2 font-medium">{l.productName}</td>
            <td className="p-2 tabular-nums">{fmt(l.qty, 4)}</td>
            <td className="p-2 tabular-nums">{fmt(l.returned, 4)}</td>
            <td className="p-2 tabular-nums">{fmt(l.remaining, 4)}</td>
            <td className="p-2 tabular-nums">{fmt(l.unitNet)}</td>
            <td className="p-2"><div className="flex items-center gap-1">
              <Input type="number" min={0} max={l.remaining} step="any" className="h-9 w-28" disabled={l.remaining <= 0} value={qty[id] ?? ""} onChange={(e) => setQty({ ...qty, [id]: e.target.value })} />
              <Button type="button" size="sm" variant="ghost" disabled={l.remaining <= 0} onClick={() => setQty({ ...qty, [id]: String(l.remaining) })}>{tr("Zote")}</Button>
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm"><span className="font-medium">{tr("Tarehe ya marejesho")}</span><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="grid gap-1 text-sm md:col-span-2"><span className="font-medium">{tr("Sababu (hiari)")}</span><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("mf. bidhaa imeharibika / imezidi")} /></label>
        {est.refund > 0 && <label className="grid gap-1 text-sm"><span className="font-medium">{tr("Rudisha pesa kupitia")}</span>
          <select className="h-10 rounded-md border bg-background px-3" value={pickMethodKey(methods, method)} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
        </label>}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-0.5 text-sm">
          <div>{tr("Thamani ya marejesho:")} <b className="tabular-nums">{fmt(est.total)}</b> <span className="text-xs text-muted-foreground">({tr("Tax:")} {fmt(est.tax)})</span></div>
          <div>{tr("Itapunguza deni la mteja:")} <b className="tabular-nums">{fmt(est.credit)}</b></div>
          <div>{tr("Itarudishwa kwa mteja:")} <b className="tabular-nums">{fmt(est.refund)}</b></div>
        </div>
        <Button disabled={busy || !chosen.length} onClick={() => void submit()}>{busy ? tr("Inahifadhi…") : tr("Hifadhi marejesho")}</Button>
      </div>
    </section>
  );
}
