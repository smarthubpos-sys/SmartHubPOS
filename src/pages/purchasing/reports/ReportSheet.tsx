import { useRef, type ReactNode } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { printElement } from "@/lib/print-area.ts";
import { tr } from "@/lib/i18n.ts";

export type Header = { name: string; address: string; phone: string; email: string; taxId: string; logoUrl: string; currencySymbol: string; decimalPlaces: number; department: string; preparedBy: string };

const KEEP_COLORS = "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]";

export type Column<T> = { key: string; label: string; align?: "left" | "right" | "center"; render?: (row: T) => ReactNode; nowrap?: boolean };

/** Clean report table: dark header, zebra rows, bold totals row. Numbers are right aligned. */
export function DataTable<T extends object>({ columns, rows, totals, empty }: { columns: Column<T>[]; rows: T[]; totals?: Record<string, ReactNode>; empty?: string }) {
  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className={`bg-slate-800 text-white ${KEEP_COLORS}`}>
            {columns.map((c) => <th key={c.key} className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-wide ${align(c.align)}`}>{tr(c.label)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`break-inside-avoid border-b border-slate-200 ${i % 2 === 1 ? "bg-slate-50" : ""} ${KEEP_COLORS}`}>
              {columns.map((c) => <td key={c.key} className={`px-2 py-1.5 align-top ${align(c.align)} ${c.align === "right" ? "tabular-nums" : ""} ${c.nowrap || c.align === "right" ? "whitespace-nowrap" : ""}`}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}</td>)}
            </tr>
          ))}
          {totals && rows.length > 0 && (
            <tr className={`border-t-2 border-slate-800 bg-slate-100 font-bold ${KEEP_COLORS}`}>
              {columns.map((c, i) => <td key={c.key} className={`px-2 py-2 ${align(c.align)} ${c.align === "right" ? "tabular-nums whitespace-nowrap" : ""}`}>{totals[c.key] ?? (i === 0 ? tr("JUMLA") : "")}</td>)}
            </tr>
          )}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-4 text-center text-sm text-slate-500">{empty ?? tr("Hakuna taarifa kwa kipindi hiki.")}</p>}
    </div>
  );
}

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "bad" ? "text-rose-600" : tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-6 border-l-4 border-blue-700 pl-2 text-sm font-bold uppercase tracking-wide text-slate-700">{children}</h3>;
}

function downloadCsv(name: string, header: string[], data: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header.map(esc).join(","), ...data.map((r) => r.map(esc).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${name.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/**
 * Professional report page (A4): letterhead with the business details, report title and period,
 * summary figures, the tables, and signature lines. `Print` produces only the sheet.
 */
export default function ReportSheet({ header, title, period, kpis, csv, children }: {
  header: Header; title: string; period: string; kpis?: { label: string; value: string; tone?: "good" | "bad" | "warn" }[];
  csv?: { header: string[]; rows: (string | number)[][] }; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const generated = new Date().toLocaleString();
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2 print:hidden">
        {csv && <Button variant="outline" size="sm" disabled={!csv.rows.length} onClick={() => downloadCsv(title, csv.header, csv.rows)}><Download className="mr-1 h-4 w-4" />{tr("Export CSV")}</Button>}
        <Button size="sm" onClick={() => printElement(ref.current, "A4")}><Printer className="mr-1 h-4 w-4" />{tr("Print / PDF")}</Button>
      </div>
      <article ref={ref} data-paper="A4" className="print-area mx-auto w-full max-w-5xl bg-white p-6 text-slate-800 shadow-sm">
        <header className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-4">
          <div className="min-w-0">
            {header.logoUrl ? <img src={header.logoUrl} alt={header.name} className="mb-1 max-h-14 max-w-[200px] object-contain" /> : null}
            <h1 className="text-xl font-extrabold tracking-tight text-blue-800">{header.name || tr("Biashara")}</h1>
            <div className="text-[11px] leading-4 text-slate-500">
              {header.department && <p>{header.department}</p>}
              {header.address && <p className="whitespace-pre-line">{header.address}</p>}
              {(header.phone || header.email) && <p>{[header.phone, header.email].filter(Boolean).join("  ·  ")}</p>}
              {header.taxId && <p>TIN: {header.taxId}</p>}
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-light uppercase tracking-wide text-slate-800">{title}</h2>
            <p className="mt-1 text-xs font-semibold text-slate-600">{period}</p>
            <p className="text-[11px] text-slate-400">{tr("Generated")}: {generated}</p>
            <p className="text-[11px] text-slate-400">{tr("Amounts in")} {header.currencySymbol}</p>
          </div>
        </header>
        {kpis && kpis.length > 0 && <section className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">{kpis.map((k) => <Kpi key={k.label} {...k} />)}</section>}
        <div className="mt-4 space-y-2">{children}</div>
        <section className="mt-12 grid grid-cols-3 gap-8 text-[11px] text-slate-600">
          <div className="border-t border-slate-400 pt-1">{tr("Prepared by")}: {header.preparedBy}</div>
          <div className="border-t border-slate-400 pt-1">{tr("Reviewed by")}</div>
          <div className="border-t border-slate-400 pt-1">{tr("Approved by")}</div>
        </section>
        <footer className="mt-4 border-t pt-2 text-center text-[10px] text-slate-400">{header.name} — {title} — {period}</footer>
      </article>
    </div>
  );
}
