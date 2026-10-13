import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n.ts";

export type Row = Record<string, string | number>;

export const today = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => `${today().slice(0, 8)}01`;
export const fmt = (n: number, digits = 2) => n.toLocaleString("en-US", { maximumFractionDigits: digits });
export const num = (v: string | number | undefined) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Group items by one or more keys and fold them into rows. */
export function groupRows<T, R extends Row>(items: T[], key: (item: T) => string, init: (item: T) => R, add: (acc: R, item: T) => void): R[] {
  const map = new Map<string, R>();
  for (const item of items) {
    const k = key(item);
    let acc = map.get(k);
    if (!acc) { acc = init(item); map.set(k, acc); }
    add(acc, item);
  }
  return [...map.values()];
}

function downloadCsv(name: string, rows: Row[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [cols.map((c) => esc(tr(c))).join(","), ...rows.map((r) => cols.map((c) => esc(r[c] ?? "")).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${name.replace(/\s+/g, "-").toLowerCase()}-${today()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function DateRange({ startDate, endDate, onStart, onEnd }: { startDate: string; endDate: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <label className="grid gap-1 text-xs">{tr("Kuanzia")}<Input type="date" value={startDate} onChange={(e) => onStart(e.target.value)} /></label>
      <label className="grid gap-1 text-xs">{tr("Mpaka")}<Input type="date" value={endDate} onChange={(e) => onEnd(e.target.value)} /></label>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold">{typeof value === "number" ? fmt(value) : value}</div>
    </div>
  );
}

/** Report table with automatic number formatting, optional totals row, CSV export and print. */
export function ReportTable({ title, rows, sumCols = [], note }: { title: string; rows: Row[]; sumCols?: string[]; note?: string }) {
  const cols = Object.keys(rows[0] ?? {});
  const sendReport = useAction(api.reportEmails.sendReport);
  const [sending, setSending] = useState(false);
  const emailReport = async () => {
    setSending(true);
    try {
      const result = await sendReport({ title, rows: rows.slice(0, 500) });
      toast.success(`Ripoti imetumwa kwa wapokeaji ${result.recipients}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Imeshindikana kutuma ripoti kwa email.");
    } finally { setSending(false); }
  };
  const totals: Row | null = rows.length && sumCols.length ? Object.fromEntries(cols.map((c, i) => [c, sumCols.includes(c) ? round2(rows.reduce((n, r) => n + num(r[c]), 0)) : i === 0 ? tr("JUMLA") : ""])) : null;
  const show = (v: string | number | undefined) => (typeof v === "number" ? fmt(v, 4) : String(v ?? ""));
  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="font-semibold">{title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></div>
        <div className="flex gap-2 print:hidden">
          <Button size="sm" variant="outline" disabled={!rows.length} onClick={() => downloadCsv(title, rows)}>{tr("Export CSV")}</Button>
          <Button size="sm" variant="outline" disabled={!rows.length || sending} onClick={() => void emailReport()}>{sending ? tr("Inatuma…") : tr("Tuma kwa Email")}</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>{tr("Print")}</Button>
        </div>
      </div>
      {note && <p className="border-b bg-muted/30 p-3 text-xs text-muted-foreground">{note}</p>}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-full table-auto text-left text-sm">
          <thead><tr>{cols.map((c) => <th key={c} className={`bg-muted/50 p-3 align-bottom font-semibold ${rows.some((r) => typeof r[c] === "number") ? "text-right" : "text-left"} break-words`}>{tr(c)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">{cols.map((c) => <td key={c} className={`max-w-xs p-3 align-top break-words ${typeof r[c] === "number" ? "text-right tabular-nums whitespace-nowrap" : "text-left"}`}>{show(r[c])}</td>)}</tr>
            ))}
            {totals && <tr className="border-t-2 bg-muted/40 font-semibold">{cols.map((c) => <td key={c} className={`p-3 align-top ${sumCols.includes(c) ? "text-right tabular-nums whitespace-nowrap" : "text-left"}`}>{show(totals[c])}</td>)}</tr>}
          </tbody>
        </table>
        {!rows.length && <p className="p-5 text-sm text-muted-foreground">{tr("Hakuna taarifa kwa kipindi/chaguo hili.")}</p>}
      </div>
    </section>
  );
}
