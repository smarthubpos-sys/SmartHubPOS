import SearchSelect from "@/components/SearchSelect.tsx";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { FileText } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { PurchaseDocumentDialog, StatusBadge, statusKey } from "@/components/PurchaseDocument.tsx";
import { formatDate, formatNumber, localDate } from "@/lib/format.ts";
import { tr, trValue } from "@/lib/i18n.ts";
import ReportSheet, { DataTable, SectionTitle, type Column, type Header } from "./ReportSheet.tsx";

export type Registers = NonNullable<FunctionReturnType<typeof api.purchasing.purchasingRegisters>>;
type Props = { path: string; startDate: string; endDate: string; data: Registers };

const pct = (n: number, total: number) => (total > 0 ? `${formatNumber((n / total) * 100, 1)}%` : "—");
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0);
const periodText = (s: string, e: string) => `${formatDate(s)} — ${formatDate(e)}`;

/** Dispatches to the professional version of each purchasing report. */
export default function PurchaseReports(props: Props) {
  const header = useQuery(api.purchaseReports.reportHeader, {});
  const [openDoc, setOpenDoc] = useState<Id<"purchases"> | null>(null);
  if (!header) return <p className="p-6 text-sm text-muted-foreground">{tr("Inapakia…")}</p>;
  const p = { ...props, header, openDoc: setOpenDoc };
  const report = props.path.replace(/^reports\//, "");
  return (
    <>
      {report === "invoices" && <InvoiceList {...p} />}
      {report === "supplier-statement" && <SupplierStatement {...p} />}
      {report === "summary" && <Summary {...p} detailed={false} />}
      {report === "analysis" && <Summary {...p} detailed />}
      {report === "by-supplier" && <BySupplier {...p} />}
      {report === "by-product" && <ByProduct {...p} />}
      {report === "payments" && <Payments {...p} />}
      {report === "outstanding" && <Outstanding {...p} />}
      {report === "last-price" && <LastPrice {...p} />}
      {openDoc && <PurchaseDocumentDialog purchaseId={openDoc} onClose={() => setOpenDoc(null)} />}
    </>
  );
}

type R = Props & { header: Header; openDoc: (id: Id<"purchases">) => void };
const useMoney = (h: Header) => (n: number) => formatNumber(n, h.decimalPlaces);
const OpenButton = ({ id, open }: { id: Id<"purchases">; open: (id: Id<"purchases">) => void }) => (
  <Button variant="outline" size="sm" className="h-7 px-2 text-xs print:hidden" onClick={() => open(id)}><FileText className="mr-1 h-3.5 w-3.5" />{tr("Open")}</Button>
);

/* ───────── Purchase Invoice List ───────── */
function InvoiceList({ header, startDate, endDate, data, openDoc }: R) {
  const m = useMoney(header);
  const name = (id: unknown) => data.suppliers.find((s) => s._id === id)?.name ?? tr("Supplier");
  const rows = [...data.purchases].sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.internalRef.localeCompare(b.internalRef));
  const live = rows.filter((x) => x.status === "posted");
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "invoiceNo", label: "Invoice", render: (r) => <b>{r.invoiceNo ?? r.internalRef}</b> },
    { key: "purchaseDate", label: "Tarehe", render: (r) => formatDate(r.purchaseDate), nowrap: true },
    { key: "supplier", label: "Supplier", render: (r) => name(r.supplierId) },
    { key: "supplierInvoiceNo", label: "Supplier Invoice No", render: (r) => (r.supplierInvoiceNo && r.supplierInvoiceNo !== r.invoiceNo ? r.supplierInvoiceNo : "—") },
    { key: "total", label: "Jumla", align: "right", render: (r) => m(r.total) },
    { key: "amountPaid", label: "Imelipwa", align: "right", render: (r) => m(r.amountPaid) },
    { key: "outstanding", label: "Deni", align: "right", render: (r) => m(r.outstanding) },
    { key: "status", label: "Hali", align: "center", render: (r) => <StatusBadge status={statusKey(r)} /> },
    { key: "open", label: "", align: "center", render: (r) => <OpenButton id={r._id} open={openDoc} /> },
  ];
  const total = sum(live, (x) => x.total), paid = sum(live, (x) => x.amountPaid), out = sum(live, (x) => x.outstanding);
  return (
    <ReportSheet header={header} title={tr("Purchase Invoice List")} period={periodText(startDate, endDate)}
      kpis={[{ label: tr("Invoices"), value: String(live.length) }, { label: tr("Purchase Total"), value: m(total) }, { label: tr("Imelipwa"), value: m(paid), tone: "good" }, { label: tr("Outstanding"), value: m(out), tone: out > 0 ? "bad" : "good" }]}
      csv={{ header: ["Invoice", "Date", "Supplier", "Total", "Paid", "Outstanding", "Status"], rows: rows.map((r) => [r.invoiceNo ?? r.internalRef, r.purchaseDate, name(r.supplierId), r.total, r.amountPaid, r.outstanding, statusKey(r)]) }}>
      <DataTable columns={cols} rows={rows} totals={{ total: m(total), amountPaid: m(paid), outstanding: m(out) }} />
      <p className="text-[11px] text-slate-500">{tr("Totals exclude cancelled invoices. Use Open to view and print the full purchase invoice document.")}</p>
    </ReportSheet>
  );
}

/* ───────── Supplier Statement ───────── */
function SupplierStatement({ header, startDate, endDate, data, openDoc }: R) {
  const m = useMoney(header);
  const [supplierId, setSupplierId] = useState("");
  const balances = useQuery(api.purchaseReports.supplierBalances, { startDate, endDate });
  const ledger = useQuery(api.purchaseReports.supplierLedger, supplierId ? { supplierId: supplierId as Id<"suppliers">, startDate, endDate } : "skip");
  const picker = (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm print:hidden">
      <span className="font-medium">{tr("Supplier")}</span>
      <SearchSelect className="w-72 max-w-full" value={supplierId} onChange={setSupplierId} allowEmpty={tr("Suppliers wote (muhtasari)")} placeholder={tr("Tafuta supplier kwa jina…")}
        options={data.suppliers.map((s) => ({ value: String(s._id), label: s.name, hint: s.code }))} />
    </div>
  );
  const period = periodText(startDate, endDate);

  if (supplierId) {
    if (ledger === undefined) return <>{picker}<p className="p-4 text-sm text-muted-foreground">{tr("Inapakia…")}</p></>;
    const typeLabel = (t: string) => (t === "purchase" ? tr("Purchase") : t === "payment" ? tr("Payment") : tr("Return"));
    const cols: Column<(typeof ledger.rows)[number]>[] = [
      { key: "date", label: "Tarehe", render: (r) => formatDate(r.date), nowrap: true },
      { key: "type", label: "Type", render: (r) => typeLabel(r.type) },
      { key: "reference", label: "Reference", render: (r) => <span className="font-medium">{r.reference}</span> },
      { key: "description", label: "Maelezo" },
      { key: "charge", label: "Charges", align: "right", render: (r) => (r.charge ? m(r.charge) : "") },
      { key: "credit", label: "Payments / Credits", align: "right", render: (r) => (r.credit ? m(r.credit) : "") },
      { key: "balance", label: "Balance", align: "right", render: (r) => m(r.balance) },
      { key: "open", label: "", align: "center", render: (r) => (r.purchaseId ? <OpenButton id={r.purchaseId} open={openDoc} /> : null) },
    ];
    const s = ledger.supplier;
    return (
      <>
        {picker}
        <ReportSheet header={header} title={tr("Supplier Statement")} period={period}
          kpis={[{ label: tr("Opening balance"), value: m(ledger.opening) }, { label: tr("Charges"), value: m(ledger.totals.charges) }, { label: tr("Payments / Credits"), value: m(ledger.totals.credits), tone: "good" }, { label: tr("Closing balance"), value: m(ledger.closing), tone: ledger.closing > 0 ? "bad" : "good" }]}
          csv={{ header: ["Date", "Type", "Reference", "Description", "Charges", "Credits", "Balance"], rows: ledger.rows.map((r) => [r.date, r.type, r.reference, r.description, r.charge, r.credit, r.balance]) }}>
          <section className="grid gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-2">
            <div><p className="text-[11px] font-bold uppercase text-slate-400">{tr("Statement for")}</p><p className="text-sm font-bold">{s.name}</p><p>{s.code}</p>{s.address && <p className="whitespace-pre-line">{s.address}</p>}</div>
            <div className="sm:text-right">{s.phone && <p>{s.phone}</p>}{s.email && <p>{s.email}</p>}{s.taxId && <p>TIN: {s.taxId}</p>}{s.paymentTerms && <p>{tr("Payment terms")}: {trValue(s.paymentTerms)}</p>}</div>
          </section>
          <div className="flex justify-between border-b border-slate-300 bg-slate-100 px-2 py-1.5 text-xs font-bold"><span>{tr("Balance brought forward")}</span><span className="tabular-nums">{m(ledger.opening)}</span></div>
          <DataTable columns={cols} rows={ledger.rows} empty={tr("Hakuna miamala kwa kipindi hiki.")} />
          <div className="flex justify-between border-t-2 border-slate-800 bg-slate-100 px-2 py-2 text-sm font-bold"><span>{ledger.closing > 0 ? tr("Amount we owe the supplier") : ledger.closing < 0 ? tr("Supplier credit in our favour") : tr("Fully settled")}</span><span className="tabular-nums">{m(Math.abs(ledger.closing))}</span></div>
        </ReportSheet>
      </>
    );
  }

  if (balances === undefined) return <>{picker}<p className="p-4 text-sm text-muted-foreground">{tr("Inapakia…")}</p></>;
  const rows = balances.rows;
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "name", label: "Supplier", render: (r) => <button className="text-left font-medium text-blue-700 underline-offset-2 hover:underline print:no-underline" onClick={() => setSupplierId(String(r.supplierId))}>{r.name}</button> },
    { key: "opening", label: "Opening balance", align: "right", render: (r) => m(r.opening) },
    { key: "purchases", label: "Manunuzi", align: "right", render: (r) => m(r.purchases) },
    { key: "payments", label: "Malipo", align: "right", render: (r) => m(r.payments) },
    { key: "returns", label: "Returns", align: "right", render: (r) => m(r.returns) },
    { key: "closing", label: "Closing balance", align: "right", render: (r) => <b className={r.closing > 0 ? "text-rose-600" : ""}>{m(r.closing)}</b> },
    { key: "state", label: "Hali", align: "center", render: (r) => (r.closing > 0 ? tr("Anadaiwa") : r.closing < 0 ? tr("Credit") : tr("Amelipwa")) },
  ];
  const owe = sum(rows.filter((r) => r.closing > 0), (r) => r.closing);
  return (
    <>
      {picker}
      <ReportSheet header={header} title={tr("Supplier Statement")} period={period}
        kpis={[{ label: tr("Suppliers"), value: String(rows.length) }, { label: tr("Manunuzi"), value: m(sum(rows, (r) => r.purchases)) }, { label: tr("Malipo"), value: m(sum(rows, (r) => r.payments)), tone: "good" }, { label: tr("Amount we owe suppliers"), value: m(owe), tone: owe > 0 ? "bad" : "good" }]}
        csv={{ header: ["Supplier", "Opening", "Purchases", "Payments", "Returns", "Closing"], rows: rows.map((r) => [r.name, r.opening, r.purchases, r.payments, r.returns, r.closing]) }}>
        <DataTable columns={cols} rows={rows} totals={{ opening: m(sum(rows, (r) => r.opening)), purchases: m(sum(rows, (r) => r.purchases)), payments: m(sum(rows, (r) => r.payments)), returns: m(sum(rows, (r) => r.returns)), closing: m(sum(rows, (r) => r.closing)) }} />
        <p className="text-[11px] text-slate-500">{tr("Click a supplier name to see its full statement with a running balance.")}</p>
      </ReportSheet>
    </>
  );
}

/* ───────── Summary / Analysis ───────── */
function Summary({ header, startDate, endDate, data, detailed }: R & { detailed: boolean }) {
  const m = useMoney(header);
  const live = data.purchases.filter((p) => p.status === "posted");
  const liveIds = new Set(live.map((p) => String(p._id)));
  const returns = data.returns.filter((r) => r.status === "posted");
  const total = sum(live, (p) => p.total), paid = sum(live, (p) => p.amountPaid), out = sum(live, (p) => p.outstanding), ret = sum(returns, (r) => r.total);
  const months = useMemo(() => {
    const map = new Map<string, { month: string; invoices: number; purchases: number; payments: number; returns: number }>();
    const get = (d: string) => { const k = d.slice(0, 7); let r = map.get(k); if (!r) { r = { month: k, invoices: 0, purchases: 0, payments: 0, returns: 0 }; map.set(k, r); } return r; };
    for (const p of live) { const r = get(p.purchaseDate); r.invoices++; r.purchases += p.total; }
    for (const p of data.payments) get(p.paymentDate).payments += p.amount;
    for (const r of returns) get(r.returnDate).returns += r.total;
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxMonth = Math.max(1, ...months.map((x) => x.purchases));
  const monthCols: Column<(typeof months)[number] & { change: string }>[] = [
    { key: "month", label: "Month", render: (r) => formatDate(`${r.month}-01`).replace(/^\d+\s/, "") },
    { key: "invoices", label: "Invoices", align: "right" },
    { key: "purchases", label: "Manunuzi", align: "right", render: (r) => m(r.purchases) },
    { key: "bar", label: "", render: (r) => <div className="h-2 w-28 rounded bg-slate-100"><div className="h-2 rounded bg-blue-600 [print-color-adjust:exact]" style={{ width: `${(r.purchases / maxMonth) * 100}%` }} /></div> },
    ...(detailed ? [{ key: "change", label: "vs previous month", align: "right" as const }] : []),
    { key: "payments", label: "Malipo", align: "right", render: (r) => m(r.payments) },
    { key: "returns", label: "Returns", align: "right", render: (r) => m(r.returns) },
    { key: "net", label: "Net purchases", align: "right", render: (r) => m(r.purchases - r.returns) },
  ];
  const monthRows = months.map((r, i) => ({ ...r, change: i === 0 || months[i - 1].purchases === 0 ? "—" : `${r.purchases >= months[i - 1].purchases ? "+" : ""}${formatNumber(((r.purchases - months[i - 1].purchases) / months[i - 1].purchases) * 100, 1)}%` }));

  const supplierName = (id: unknown) => data.suppliers.find((s) => s._id === id)?.name ?? tr("Supplier");
  const topSuppliers = useMemo(() => {
    const map = new Map<string, { name: string; invoices: number; total: number }>();
    for (const p of live) { const k = String(p.supplierId); const r = map.get(k) ?? { name: supplierName(p.supplierId), invoices: 0, total: 0 }; r.invoices++; r.total += p.total; map.set(k, r); }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; total: number }>();
    for (const l of data.lines) { if (!liveIds.has(String(l.purchaseId))) continue; const k = String(l.productId); const r = map.get(k) ?? { name: l.productName, qty: 0, total: 0 }; r.qty += l.qty; r.total += l.total; map.set(k, r); }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const statusMix = (["paid", "partial", "unpaid"] as const).map((k) => { const l = live.filter((p) => p.paymentStatus === k); return { key: k, count: l.length, total: sum(l, (p) => p.total), outstanding: sum(l, (p) => p.outstanding) }; });

  return (
    <ReportSheet header={header} title={detailed ? tr("Purchase Analysis") : tr("Purchase Report")} period={periodText(startDate, endDate)}
      kpis={[
        { label: tr("Invoices"), value: String(live.length) }, { label: tr("Purchase Total"), value: m(total) },
        { label: tr("Average invoice"), value: m(live.length ? total / live.length : 0) }, { label: tr("Returns"), value: m(ret), tone: ret > 0 ? "warn" : undefined },
        { label: tr("Net purchases"), value: m(total - ret) }, { label: tr("Imelipwa"), value: m(paid), tone: "good" },
        { label: tr("Payments"), value: m(sum(data.payments, (p) => p.amount)) }, { label: tr("Outstanding"), value: m(out), tone: out > 0 ? "bad" : "good" },
      ]}
      csv={{ header: ["Month", "Invoices", "Purchases", "Payments", "Returns"], rows: months.map((r) => [r.month, r.invoices, r.purchases, r.payments, r.returns]) }}>
      <SectionTitle>{tr("Monthly trend")}</SectionTitle>
      <DataTable columns={monthCols} rows={monthRows} totals={{ invoices: String(sum(months, (r) => r.invoices)), purchases: m(total), payments: m(sum(months, (r) => r.payments)), returns: m(ret), net: m(total - ret) }} />
      {detailed && (
        <>
          <SectionTitle>{tr("Payment status of invoices")}</SectionTitle>
          <DataTable columns={[
            { key: "key", label: "Hali", render: (r) => <StatusBadge status={r.key} /> }, { key: "count", label: "Invoices", align: "right" },
            { key: "total", label: "Jumla", align: "right", render: (r) => m(r.total) }, { key: "outstanding", label: "Deni", align: "right", render: (r) => m(r.outstanding) },
            { key: "share", label: "Share", align: "right", render: (r) => pct(r.total, total) },
          ]} rows={statusMix} />
          <SectionTitle>{tr("Top 5 suppliers")}</SectionTitle>
          <DataTable columns={[
            { key: "name", label: "Supplier" }, { key: "invoices", label: "Invoices", align: "right" },
            { key: "total", label: "Jumla", align: "right", render: (r) => m(r.total) }, { key: "share", label: "Share", align: "right", render: (r) => pct(r.total, total) },
          ]} rows={topSuppliers} />
          <SectionTitle>{tr("Top 5 products")}</SectionTitle>
          <DataTable columns={[
            { key: "name", label: "Bidhaa" }, { key: "qty", label: "Idadi", align: "right", render: (r) => formatNumber(r.qty, Number.isInteger(r.qty) ? 0 : 2) },
            { key: "total", label: "Jumla", align: "right", render: (r) => m(r.total) }, { key: "share", label: "Share", align: "right", render: (r) => pct(r.total, total) },
          ]} rows={topProducts} />
        </>
      )}
    </ReportSheet>
  );
}

/* ───────── Purchase by Supplier ───────── */
function BySupplier({ header, startDate, endDate, data }: R) {
  const m = useMoney(header);
  const live = data.purchases.filter((p) => p.status === "posted");
  const rows = useMemo(() => {
    const map = new Map<string, { name: string; invoices: number; total: number; paid: number; outstanding: number; last: string }>();
    for (const p of live) {
      const k = String(p.supplierId);
      const r = map.get(k) ?? { name: data.suppliers.find((s) => s._id === p.supplierId)?.name ?? tr("Supplier"), invoices: 0, total: 0, paid: 0, outstanding: 0, last: "" };
      r.invoices++; r.total += p.total; r.paid += p.amountPaid; r.outstanding += p.outstanding; if (p.purchaseDate > r.last) r.last = p.purchaseDate; map.set(k, r);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = sum(rows, (r) => r.total);
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "name", label: "Supplier", render: (r) => <b>{r.name}</b> }, { key: "invoices", label: "Invoices", align: "right" },
    { key: "total", label: "Jumla", align: "right", render: (r) => m(r.total) }, { key: "avg", label: "Average invoice", align: "right", render: (r) => m(r.total / r.invoices) },
    { key: "paid", label: "Imelipwa", align: "right", render: (r) => m(r.paid) }, { key: "outstanding", label: "Deni", align: "right", render: (r) => m(r.outstanding) },
    { key: "share", label: "Share", align: "right", render: (r) => pct(r.total, total) }, { key: "last", label: "Last purchase", render: (r) => formatDate(r.last), nowrap: true },
  ];
  return (
    <ReportSheet header={header} title={tr("Purchase by Supplier")} period={periodText(startDate, endDate)}
      kpis={[{ label: tr("Suppliers"), value: String(rows.length) }, { label: tr("Invoices"), value: String(live.length) }, { label: tr("Purchase Total"), value: m(total) }, { label: tr("Outstanding"), value: m(sum(rows, (r) => r.outstanding)), tone: "bad" }]}
      csv={{ header: ["Supplier", "Invoices", "Total", "Paid", "Outstanding"], rows: rows.map((r) => [r.name, r.invoices, r.total, r.paid, r.outstanding]) }}>
      <DataTable columns={cols} rows={rows} totals={{ invoices: String(sum(rows, (r) => r.invoices)), total: m(total), avg: m(live.length ? total / live.length : 0), paid: m(sum(rows, (r) => r.paid)), outstanding: m(sum(rows, (r) => r.outstanding)), share: rows.length ? "100%" : "" }} />
    </ReportSheet>
  );
}

/* ───────── Purchase by Product ───────── */
function ByProduct({ header, startDate, endDate, data }: R) {
  const m = useMoney(header);
  const liveIds = new Set(data.purchases.filter((p) => p.status === "posted").map((p) => String(p._id)));
  const rows = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; qty: number; total: number; invoices: Set<string>; lastCost: number; lastDate: string; lastSupplier: string }>();
    for (const l of data.lines) {
      if (!liveIds.has(String(l.purchaseId))) continue;
      const k = String(l.productId);
      const r = map.get(k) ?? { name: l.productName, unit: l.unit, qty: 0, total: 0, invoices: new Set<string>(), lastCost: l.unitCost, lastDate: "", lastSupplier: l.supplierName };
      r.qty += l.qty; r.total += l.total; r.invoices.add(String(l.purchaseId));
      if (l.date >= r.lastDate) { r.lastDate = l.date; r.lastCost = l.unitCost; r.lastSupplier = l.supplierName; }
      map.set(k, r);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = sum(rows, (r) => r.total);
  const q = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 2);
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "name", label: "Bidhaa", render: (r) => <b>{r.name}</b> }, { key: "unit", label: "Unit" },
    { key: "qty", label: "Idadi", align: "right", render: (r) => q(r.qty) }, { key: "total", label: "Jumla", align: "right", render: (r) => m(r.total) },
    { key: "avg", label: "Average cost", align: "right", render: (r) => m(r.qty ? r.total / r.qty : 0) }, { key: "lastCost", label: "Last cost", align: "right", render: (r) => m(r.lastCost) },
    { key: "lastSupplier", label: "Last supplier" }, { key: "share", label: "Share", align: "right", render: (r) => pct(r.total, total) },
  ];
  return (
    <ReportSheet header={header} title={tr("Purchase by Product")} period={periodText(startDate, endDate)}
      kpis={[{ label: tr("Products"), value: String(rows.length) }, { label: tr("Purchase Total"), value: m(total) }, { label: tr("Top product"), value: rows[0]?.name ?? "—" }, { label: tr("Top product share"), value: rows[0] ? pct(rows[0].total, total) : "—" }]}
      csv={{ header: ["Product", "Unit", "Quantity", "Total", "Average cost", "Last cost"], rows: rows.map((r) => [r.name, r.unit, r.qty, r.total, r.qty ? r.total / r.qty : 0, r.lastCost]) }}>
      <DataTable columns={cols} rows={rows} totals={{ total: m(total), share: rows.length ? "100%" : "" }} />
    </ReportSheet>
  );
}

/* ───────── Purchase Payment Report ───────── */
function Payments({ header, startDate, endDate, data }: R) {
  const m = useMoney(header);
  const rows = [...data.payments].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
  const name = (id: unknown) => data.suppliers.find((s) => s._id === id)?.name ?? tr("Supplier");
  const total = sum(rows, (p) => p.amount);
  const byMethod = useMemo(() => {
    const map = new Map<string, { method: string; count: number; total: number }>();
    for (const p of rows) { const r = map.get(p.paymentMethod) ?? { method: p.paymentMethod, count: 0, total: 0 }; r.count++; r.total += p.amount; map.set(p.paymentMethod, r); }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "paymentDate", label: "Tarehe", render: (r) => formatDate(r.paymentDate), nowrap: true }, { key: "supplier", label: "Supplier", render: (r) => name(r.supplierId) },
    { key: "paymentMethod", label: "Njia", render: (r) => trValue(r.paymentMethod) }, { key: "reference", label: "Reference", render: (r) => r.reference ?? "—" },
    { key: "notes", label: "Maelezo", render: (r) => r.notes ?? "—" }, { key: "amount", label: "Kiasi", align: "right", render: (r) => m(r.amount) },
  ];
  return (
    <ReportSheet header={header} title={tr("Purchase Payment Report")} period={periodText(startDate, endDate)}
      kpis={[{ label: tr("Payments"), value: String(rows.length) }, { label: tr("Total paid"), value: m(total), tone: "good" }, { label: tr("Average payment"), value: m(rows.length ? total / rows.length : 0) }, { label: tr("Suppliers paid"), value: String(new Set(rows.map((r) => String(r.supplierId))).size) }]}
      csv={{ header: ["Date", "Supplier", "Method", "Reference", "Amount"], rows: rows.map((r) => [r.paymentDate, name(r.supplierId), r.paymentMethod, r.reference ?? "", r.amount]) }}>
      <DataTable columns={cols} rows={rows} totals={{ amount: m(total) }} />
      {byMethod.length > 0 && <>
        <SectionTitle>{tr("Summary by payment method")}</SectionTitle>
        <DataTable columns={[{ key: "method", label: "Njia", render: (r) => trValue(r.method) }, { key: "count", label: "Payments", align: "right" }, { key: "total", label: "Kiasi", align: "right", render: (r) => m(r.total) }, { key: "share", label: "Share", align: "right", render: (r) => pct(r.total, total) }]} rows={byMethod} totals={{ count: String(rows.length), total: m(total) }} />
      </>}
    </ReportSheet>
  );
}

/* ───────── Outstanding Supplier (ageing) ───────── */
function Outstanding({ header, openDoc }: R) {
  const m = useMoney(header);
  const [asOf, setAsOf] = useState(localDate());
  const ageing = useQuery(api.purchaseReports.payablesAgeing, { asOf });
  const picker = <label className="mb-3 flex items-center gap-2 text-sm print:hidden"><span className="font-medium">{tr("As at")}</span><input type="date" className="h-9 rounded-md border bg-background px-2" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></label>;
  if (ageing === undefined) return <>{picker}<p className="p-4 text-sm text-muted-foreground">{tr("Inapakia…")}</p></>;
  const buckets: { key: Bucket; label: string; test: (d: number) => boolean }[] = [
    { key: "current", label: "Not yet due", test: (d: number) => d <= 0 }, { key: "d30", label: "1–30 days", test: (d: number) => d >= 1 && d <= 30 },
    { key: "d60", label: "31–60 days", test: (d: number) => d >= 31 && d <= 60 }, { key: "d90", label: "61–90 days", test: (d: number) => d >= 61 && d <= 90 }, { key: "d90p", label: "Over 90 days", test: (d: number) => d > 90 },
  ];
  type Bucket = "current" | "d30" | "d60" | "d90" | "d90p";
  type Row = { name: string; total: number } & Record<Bucket, number>;
  const bySupplier = new Map<string, Row>();
  for (const r of ageing.rows) {
    const row = bySupplier.get(String(r.supplierId)) ?? { name: r.supplierName, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 };
    const b = buckets.find((x) => x.test(r.daysOverdue))!;
    row[b.key] += r.outstanding; row.total += r.outstanding; bySupplier.set(String(r.supplierId), row);
  }
  const rows = [...bySupplier.values()].sort((a, b) => b.total - a.total);
  const total = sum(rows, (r) => r.total), overdue = total - sum(rows, (r) => r.current);
  const bucketCols: Column<Row>[] = [
    { key: "name", label: "Supplier", render: (r) => <b>{r.name}</b> },
    ...buckets.map((b) => ({ key: b.key, label: b.label, align: "right" as const, render: (r: Row) => (r[b.key] ? m(r[b.key]) : "—") })),
    { key: "total", label: "Total", align: "right", render: (r) => <b>{m(r.total)}</b> },
  ];
  const totalsRow: Record<string, string> = { total: m(total) };
  for (const b of buckets) totalsRow[b.key] = m(sum(rows, (r) => r[b.key]));
  const detail = ageing.rows;
  return (
    <>
      {picker}
      <ReportSheet header={header} title={tr("Outstanding Supplier")} period={`${tr("As at")} ${formatDate(asOf)}`}
        kpis={[{ label: tr("Total payable"), value: m(total), tone: total > 0 ? "bad" : "good" }, { label: tr("Overdue"), value: m(overdue), tone: overdue > 0 ? "bad" : "good" }, { label: tr("Overdue share"), value: pct(overdue, total) }, { label: tr("Open invoices"), value: String(detail.length) }]}
        csv={{ header: ["Invoice", "Supplier", "Invoice date", "Due date", "Days overdue", "Total", "Paid", "Outstanding"], rows: detail.map((r) => [r.invoiceNo, r.supplierName, r.purchaseDate, r.dueDate, Math.max(0, r.daysOverdue), r.total, r.paid, r.outstanding]) }}>
        <SectionTitle>{tr("Ageing by supplier")}</SectionTitle>
        <DataTable columns={bucketCols} rows={rows} totals={totalsRow} empty={tr("Hakuna madeni ya suppliers.")} />
        <SectionTitle>{tr("Open invoices")}</SectionTitle>
        <DataTable columns={[
          { key: "invoiceNo", label: "Invoice", render: (r) => <b>{r.invoiceNo}</b> }, { key: "supplierName", label: "Supplier" },
          { key: "purchaseDate", label: "Tarehe", render: (r) => formatDate(r.purchaseDate), nowrap: true }, { key: "dueDate", label: "Due Date", render: (r) => formatDate(r.dueDate), nowrap: true },
          { key: "daysOverdue", label: "Days overdue", align: "right", render: (r) => (r.daysOverdue > 0 ? <span className="font-semibold text-rose-600">{r.daysOverdue}</span> : "—") },
          { key: "total", label: "Jumla", align: "right", render: (r) => m(r.total) }, { key: "paid", label: "Imelipwa", align: "right", render: (r) => m(r.paid) },
          { key: "outstanding", label: "Deni", align: "right", render: (r) => <b>{m(r.outstanding)}</b> }, { key: "open", label: "", align: "center", render: (r) => <OpenButton id={r.purchaseId} open={openDoc} /> },
        ]} rows={detail} totals={{ total: m(sum(detail, (r) => r.total)), paid: m(sum(detail, (r) => r.paid)), outstanding: m(sum(detail, (r) => r.outstanding)) }} empty={tr("Hakuna invoice zenye deni.")} />
        <p className="text-[11px] text-slate-500">{tr("Due date = invoice date + the supplier's payment terms. Invoices with no terms are due on the invoice date.")}</p>
      </ReportSheet>
    </>
  );
}

/* ───────── Last Purchase Price ───────── */
function LastPrice({ header, startDate, endDate, data }: R) {
  const m = useMoney(header);
  const liveIds = new Set(data.purchases.filter((p) => p.status === "posted").map((p) => String(p._id)));
  const rows = useMemo(() => {
    const byProduct = new Map<string, (typeof data.lines)[number][]>();
    for (const l of data.lines) { if (!liveIds.has(String(l.purchaseId))) continue; const k = String(l.productId); byProduct.set(k, [...(byProduct.get(k) ?? []), l]); }
    return [...byProduct.values()].map((list) => {
      const s = [...list].sort((a, b) => a.date.localeCompare(b.date));
      const last = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : null;
      const costs = s.map((x) => x.unitCost);
      return { name: last.productName, unit: last.unit, supplier: last.supplierName, date: last.date, cost: last.unitCost, previous: prev?.unitCost ?? null, min: Math.min(...costs), max: Math.max(...costs), purchases: s.length };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (r: (typeof rows)[number]) => (r.previous === null || r.previous === 0 ? null : ((r.cost - r.previous) / r.previous) * 100);
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "name", label: "Bidhaa", render: (r) => <b>{r.name}</b> }, { key: "unit", label: "Unit" }, { key: "supplier", label: "Last supplier" },
    { key: "date", label: "Tarehe", render: (r) => formatDate(r.date), nowrap: true }, { key: "cost", label: "Last cost", align: "right", render: (r) => m(r.cost) },
    { key: "previous", label: "Previous cost", align: "right", render: (r) => (r.previous === null ? "—" : m(r.previous)) },
    { key: "change", label: "Change", align: "right", render: (r) => { const c = change(r); return c === null ? "—" : <span className={c > 0 ? "font-semibold text-rose-600" : c < 0 ? "font-semibold text-emerald-600" : ""}>{c > 0 ? "+" : ""}{formatNumber(c, 1)}%</span>; } },
    { key: "range", label: "Lowest – Highest", align: "right", render: (r) => `${m(r.min)} – ${m(r.max)}` },
  ];
  const up = rows.filter((r) => (change(r) ?? 0) > 0).length, down = rows.filter((r) => (change(r) ?? 0) < 0).length;
  return (
    <ReportSheet header={header} title={tr("Last Purchase Price")} period={periodText(startDate, endDate)}
      kpis={[{ label: tr("Products"), value: String(rows.length) }, { label: tr("Prices went up"), value: String(up), tone: up ? "bad" : undefined }, { label: tr("Prices went down"), value: String(down), tone: down ? "good" : undefined }, { label: tr("Unchanged"), value: String(rows.length - up - down) }]}
      csv={{ header: ["Product", "Unit", "Last supplier", "Date", "Last cost", "Previous cost"], rows: rows.map((r) => [r.name, r.unit, r.supplier, r.date, r.cost, r.previous ?? ""]) }}>
      <DataTable columns={cols} rows={rows} />
      <p className="text-[11px] text-slate-500">{tr("Prices are taken from the purchases inside the selected period.")}</p>
    </ReportSheet>
  );
}
