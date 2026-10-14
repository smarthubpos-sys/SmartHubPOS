import { useRef } from "react";
import { useQuery } from "convex/react";
import { Printer, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { formatDate, formatNumber } from "@/lib/format.ts";
import { printElement } from "@/lib/print-area.ts";
import { tr, trValue } from "@/lib/i18n.ts";
import { statusKey } from "@/lib/purchase-document-utils.ts";

const KEEP_COLORS = "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]";

const STATUS_STYLE: Record<string, { label: string; bg: string; text: string }> = {
  paid: { label: "Paid", bg: "bg-emerald-500", text: "text-white" },
  partial: { label: "Partially paid", bg: "bg-amber-500", text: "text-white" },
  unpaid: { label: "Unpaid", bg: "bg-rose-500", text: "text-white" },
  cancelled: { label: "Cancelled", bg: "bg-slate-400", text: "text-white" },
  draft: { label: "Draft", bg: "bg-slate-400", text: "text-white" },
};


/** Small coloured status label used in the report tables. */
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.bg} ${s.text} ${KEEP_COLORS}`}>{tr(s.label)}</span>;
}

/**
 * A formal purchase invoice document (A4): letterhead, big title bar with the payment status, supplier details,
 * items, totals and, underneath the dashed line, a receipt listing every payment made against the invoice.
 */
export default function PurchaseDocument({ purchaseId, onClose }: { purchaseId: Id<"purchases">; onClose?: () => void }) {
  const doc = useQuery(api.purchaseReports.purchaseDocument, { purchaseId });
  const ref = useRef<HTMLElement>(null);
  if (doc === undefined) return <p className="p-6 text-sm text-muted-foreground">{tr("Inapakia…")}</p>;

  const { header: h, purchase: p, supplier: s, lines, payments } = doc;
  const dp = h.decimalPlaces;
  const money = (n: number) => `${h.currencySymbol} ${formatNumber(n, dp)}`;
  const qty = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 2);
  const st = STATUS_STYLE[statusKey(p)] ?? STATUS_STYLE.draft;
  const paidTotal = payments.reduce((n, x) => n + x.amount, 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2 print:hidden">
        <Button onClick={() => printElement(ref.current, "A4")}><Printer className="mr-1 h-4 w-4" />{tr("Chapisha")}</Button>
        {onClose && <Button variant="outline" onClick={onClose}><X className="mr-1 h-4 w-4" />{tr("Funga")}</Button>}
      </div>
      <article ref={ref} data-paper="A4" className="print-area mx-auto w-full max-w-3xl bg-white p-8 text-[13px] leading-relaxed text-slate-800">
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            {h.logoUrl ? <img src={h.logoUrl} alt={h.name} className="max-h-16 max-w-[220px] object-contain" /> : <h1 className="text-2xl font-extrabold tracking-tight text-blue-800">{h.name || tr("Biashara")}</h1>}
            {h.department && <p className="mt-1 text-xs text-slate-500">{h.department}</p>}
          </div>
          <div className="text-right text-xs leading-5">
            {h.name && h.logoUrl && <p className="font-bold">{h.name}</p>}
            {h.address && <p className="whitespace-pre-line">{h.address}</p>}
            {h.phone && <p>{h.phone}</p>}
            {h.email && <p>{h.email}</p>}
            {h.taxId && <p>TIN: {h.taxId}</p>}
          </div>
        </header>

        <div className={`mt-6 flex items-stretch ${KEEP_COLORS}`}>
          <div className="flex-1 bg-slate-800 px-6 py-4 text-2xl font-light text-white">{tr("Purchase Invoice")} #{p.invoiceNo}</div>
          <div className={`flex w-44 items-center justify-center px-4 text-2xl font-light ${st.bg} ${st.text}`}>{tr(st.label)}</div>
        </div>

        <section className="mt-6 grid grid-cols-2 gap-8">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
            <dt className="text-xs font-bold text-slate-400">{tr("Invoice Date")}</dt><dd>{formatDate(p.date)}</dd>
            <dt className="text-xs font-bold text-slate-400">{tr("Due Date")}</dt><dd>{formatDate(p.dueDate)}</dd>
            {p.supplierInvoiceNo && p.supplierInvoiceNo !== p.invoiceNo && <><dt className="text-xs font-bold text-slate-400">{tr("Supplier Invoice No")}</dt><dd>{p.supplierInvoiceNo}</dd></>}
            <dt className="text-xs font-bold text-slate-400">{tr("Reference")}</dt><dd>{p.internalRef}</dd>
            {p.createdBy && <><dt className="text-xs font-bold text-slate-400">{tr("Prepared by")}</dt><dd>{p.createdBy}</dd></>}
          </dl>
          <div>
            <p className="text-xs font-bold text-slate-400">{tr("Supplied by")}</p>
            <p className="font-bold">{s?.name ?? tr("Supplier")}</p>
            {s?.contactPerson && <p>{s.contactPerson}</p>}
            {s?.address && <p className="whitespace-pre-line">{s.address}</p>}
            {s?.phone && <p>{s.phone}</p>}
            {s?.email && <p>{s.email}</p>}
            {s?.taxId && <p>TIN: {s.taxId}</p>}
          </div>
        </section>

        <table className="mt-8 w-full text-left">
          <thead>
            <tr className="text-xs font-bold uppercase text-slate-400">
              <th className="w-8 py-2 pl-2">#</th><th className="py-2">{tr("Description")}</th><th className="py-2">{tr("Unit")}</th>
              <th className="py-2 text-right">{tr("Idadi")}</th><th className="py-2 text-right">{tr("Unit Cost")}</th><th className="py-2 pr-2 text-right">{tr("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className={`${i % 2 === 0 ? "bg-slate-100" : ""} ${KEEP_COLORS} break-inside-avoid`}>
                <td className="py-2 pl-2 text-slate-400">{i + 1}</td>
                <td className="py-2">{l.name}{l.itemCode && <span className="ml-1 text-xs text-slate-400">({l.itemCode})</span>}</td>
                <td className="py-2">{l.unit}</td>
                <td className="py-2 text-right tabular-nums">{qty(l.qty)}</td>
                <td className="py-2 text-right tabular-nums">{money(l.unitCost)}</td>
                <td className="py-2 pr-2 text-right font-medium tabular-nums">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-3 ml-auto max-w-sm space-y-1">
          <div className="flex justify-between"><span className="font-bold text-slate-400">{tr("Sub Total")}</span><b className="tabular-nums">{money(p.subtotal)}</b></div>
          {p.discount > 0 && <div className="flex justify-between"><span className="font-bold text-slate-400">{tr("Punguzo")}</span><b className="tabular-nums">-{money(p.discount)}</b></div>}
          {p.additionalCharges > 0 && <div className="flex justify-between"><span className="font-bold text-slate-400">{tr("Additional charges")}</span><b className="tabular-nums">{money(p.additionalCharges)}</b></div>}
          <div className="flex justify-between"><span className="font-bold text-slate-400">{tr("Kodi")}</span><b className="tabular-nums">{money(p.taxAmount)}</b></div>
          <div className={`flex justify-between bg-emerald-500 px-3 py-2 text-base font-bold text-white ${KEEP_COLORS}`}><span>{tr("Total")}</span><span className="tabular-nums">{money(p.total)}</span></div>
          <div className="flex justify-between"><span className="font-bold text-slate-400">{tr("Imelipwa")}</span><b className="tabular-nums">{money(p.amountPaid)}</b></div>
          <div className="flex justify-between border-t pt-1 text-base"><span className="font-bold">{tr("Balance Due")}</span><b className={`tabular-nums ${p.outstanding > 0 ? "text-rose-600" : "text-emerald-600"}`}>{money(p.outstanding)}</b></div>
        </section>

        {p.notes && <p className="mt-4 text-xs text-slate-500"><b>{tr("Maelezo")}:</b> {p.notes}</p>}

        <section className="mt-10 break-inside-avoid border-t-2 border-dashed border-slate-300 pt-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-xl font-bold">{tr("Payment Receipt")}</h2>
            <span className="text-xs text-slate-400">{p.internalRef}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="uppercase text-slate-400">{tr("Invoice")}</dt><dd>#{p.invoiceNo}</dd>
            <dt className="uppercase text-slate-400">{tr("Paid to")}</dt><dd>{s?.name ?? ""}</dd>
          </dl>
          {payments.length > 0 ? (
            <table className="mt-3 w-full text-left text-xs">
              <thead><tr className="text-slate-400"><th className="py-1">{tr("Tarehe")}</th><th className="py-1">{tr("Njia")}</th><th className="py-1">{tr("Reference")}</th><th className="py-1 text-right">{tr("Kiasi")}</th></tr></thead>
              <tbody>{payments.map((x, i) => <tr key={i} className="border-t"><td className="py-1">{formatDate(x.date)}</td><td className="py-1">{trValue(x.method)}</td><td className="py-1">{x.reference || "—"}</td><td className="py-1 text-right tabular-nums">{money(x.amount)}</td></tr>)}</tbody>
            </table>
          ) : <p className="mt-3 text-xs text-slate-500">{tr("Hakuna malipo yaliyorekodiwa kwa invoice hii.")}</p>}
          <div className="mt-3 flex items-baseline justify-between border-t pt-2">
            <span className="font-bold">{tr("Amount Paid")}</span>
            <span className="text-xl font-bold tabular-nums">{money(paidTotal || p.amountPaid)}</span>
          </div>
        </section>

        <section className="mt-10 grid grid-cols-2 gap-10 text-xs">
          <div className="border-t border-slate-400 pt-1">{tr("Prepared by")}{p.createdBy ? `: ${p.createdBy}` : ""}</div>
          <div className="border-t border-slate-400 pt-1">{tr("Approved by")}</div>
        </section>

        <footer className="mt-8 border-t pt-3 text-center text-[11px] text-slate-400">
          {[h.name, h.email, h.phone, h.website].filter(Boolean).join("  |  ")}
        </footer>
      </article>
    </div>
  );
}

/** Opens a purchase document over the current page; used from the report tables. */
export function PurchaseDocumentDialog({ purchaseId, onClose }: { purchaseId: Id<"purchases">; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/60 p-4 print:hidden" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mx-auto max-w-4xl rounded-xl bg-background p-4" onClick={(e) => e.stopPropagation()}>
        <PurchaseDocument purchaseId={purchaseId} onClose={onClose} />
      </div>
    </div>
  );
}
