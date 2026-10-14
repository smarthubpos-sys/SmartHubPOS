import { useRef, useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n.ts";
import { printElement, readPaper, savePaper, type Paper } from "@/lib/print-area.ts";

import { fmt, num, round2, today, type Row } from "./report-utils.ts";

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
export function ReportTable({ title, rows, sumCols = [], note, onPrintRow }: { title: string; rows: Row[]; sumCols?: string[]; note?: string; onPrintRow?: (row: Row, copies: number, paper: Paper) => void }) {
  const cols = Object.keys(rows[0] ?? {});
  const sendReport = useAction(api.reportEmails.sendReport);
  const [sending, setSending] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [copies, setCopies] = useState(1);
  const [paper, setPaper] = useState<Paper>(readPaper());
  const emailReport = async () => {
    setSending(true);
    try {
      const result = await sendReport({ title, rows: rows.slice(0, 500) });
      toast.success(`Ripoti imetumwa kwa wapokeaji ${result.recipients}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Imeshindikana kutuma ripoti kwa email.");
    } finally { setSending(false); }
  };
  // Row keys are written in Kiswahili but callers pass translated names, so match either form (otherwise totals vanish in English).
  const isSum = (c: string) => sumCols.includes(c) || sumCols.includes(tr(c));
  const totals: Row | null = rows.length && sumCols.length ? Object.fromEntries(cols.map((c, i) => [c, isSum(c) ? round2(rows.reduce((n, r) => n + num(r[c]), 0)) : i === 0 ? tr("JUMLA") : ""])) : null;
  const show = (v: string | number | undefined) => (typeof v === "number" ? fmt(v, 4) : String(v ?? ""));
  return (
    <section ref={sectionRef} className="overflow-hidden rounded-xl border">
      <div className="hidden border-b p-3 text-xs text-slate-600 print:block">{tr("Imechapishwa")}: {new Date().toLocaleString()}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="font-semibold">{title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {onPrintRow && (
            <>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={paper} aria-label={tr("Aina ya printer")} onChange={(e) => { const v = e.target.value as Paper; setPaper(v); savePaper(v); }}>
                <option value="80mm">80mm</option><option value="58mm">58mm</option><option value="A4">A4</option>
              </select>
              <label className="flex items-center gap-1 text-xs">{tr("Nakala")}
                <Input type="number" min={1} max={10} className="h-9 w-16" value={copies} onChange={(e) => setCopies(Math.min(10, Math.max(1, Math.floor(Number(e.target.value) || 1))))} />
              </label>
              <Button size="sm" disabled={picked === null || !rows[picked]} onClick={() => { if (picked !== null && rows[picked]) onPrintRow(rows[picked], copies, paper); }}>{tr("Chapisha item iliyochaguliwa")}</Button>
            </>
          )}
          <Button size="sm" variant="outline" disabled={!rows.length} onClick={() => downloadCsv(title, rows)}>{tr("Export CSV")}</Button>
          <Button size="sm" variant="outline" disabled={!rows.length || sending} onClick={() => void emailReport()}>{sending ? tr("Inatuma…") : tr("Tuma kwa Email")}</Button>
          <Button size="sm" variant="outline" onClick={() => printElement(sectionRef.current, "A4", { landscape: cols.length > 6 })}>{tr("Print")}</Button>
        </div>
      </div>
      {note && <p className="border-b bg-muted/30 p-3 text-xs text-muted-foreground">{note}</p>}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-full table-auto text-left text-sm">
          <thead><tr>{onPrintRow && <th className="w-10 bg-muted/50 p-3 print:hidden" aria-label={tr("Chagua")} />}{cols.map((c) => <th key={c} className={`bg-muted/50 p-3 align-bottom font-semibold ${rows.some((r) => typeof r[c] === "number") ? "text-right" : "text-left"} break-words`}>{tr(c)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} onClick={onPrintRow ? () => setPicked(i) : undefined} className={`border-t ${onPrintRow ? "cursor-pointer" : ""} ${picked === i ? "bg-primary/10" : ""}`}>{onPrintRow && <td className="p-3 align-top print:hidden"><input type="radio" name="report-row" checked={picked === i} onChange={() => setPicked(i)} aria-label={tr("Chagua")} /></td>}{cols.map((c) => <td key={c} className={`max-w-xs p-3 align-top break-words ${typeof r[c] === "number" ? "text-right tabular-nums whitespace-nowrap" : "text-left"}`}>{show(r[c])}</td>)}</tr>
            ))}
            {totals && <tr className="border-t-2 bg-muted/40 font-semibold">{onPrintRow && <td className="print:hidden" />}{cols.map((c) => <td key={c} className={`p-3 align-top ${isSum(c) ? "text-right tabular-nums whitespace-nowrap" : "text-left"}`}>{show(totals[c])}</td>)}</tr>}
          </tbody>
        </table>
        {!rows.length && <p className="p-5 text-sm text-muted-foreground">{tr("Hakuna taarifa kwa kipindi/chaguo hili.")}</p>}
      </div>
    </section>
  );
}
