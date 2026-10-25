import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileBarChart, Printer } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, PageHeader, Panel, SelectBox, Table } from "@/components/page-kit.tsx";
import { formatDate, formatNumber, localDate } from "@/lib/format.ts";
import { errorText, getLocale, tr } from "@/lib/i18n.ts";
import { printElement } from "@/lib/print-area.ts";
import { scrollAppToTop } from "@/lib/app-scroll.ts";
import { bucketDaily, chunkRange, halve, periodRange, sumSections, summarize, type Period, type Row, type Summary } from "@/convex/reportCore.ts";
import { toast } from "sonner";

type Section = { bk: string; name: string; rows: Row[] };
type Meta = { period: Period; from: string; to: string; scopeLabel: string; title: string; generatedAt: string; preparedBy: string };
type Header = { businessName: string; address: string; phone: string; email: string; tin: string; currencySymbol: string; decimalPlaces: number; preparedBy: string };

const CHUNK_DAYS = 7;
const SOURCE_LABEL = (k: string) => ({
  customer_receipts: tr("Mapokezi kutoka kwa wateja"), customer_refunds: tr("Marejesho kwa wateja"), suppliers: tr("Malipo kwa wasambazaji"),
  bills: tr("Bili na matumizi"), payroll: tr("Mishahara"), capital: tr("Mtaji na mikopo"), other: tr("Mengineyo (journal za mkono)"),
} as Record<string, string>)[k] ?? k;

/** Accounting style: negatives in brackets, zero as a dash. */
const acct = (n: number, d: number) => (Math.abs(n) < 0.005 ? "–" : n < 0 ? `(${formatNumber(-n, d)})` : formatNumber(n, d));

function periodText(period: Period, from: string, to: string) {
  if (period === "day") return formatDate(from);
  if (period === "month") return new Date(`${from}T00:00:00`).toLocaleDateString(getLocale(), { month: "long", year: "numeric" });
  return `${from.slice(0, 4)}`;
}
const periodName = (p: string) => p === "day" ? tr("Ripoti ya Siku") : p === "month" ? tr("Ripoti ya Mwezi") : tr("Ripoti ya Mwaka");

/* ───────────────────────────────────────── the printable report ───────────────────────────────────────── */

function ReportDocument({ meta, sections, header, innerRef }: { meta: Meta; sections: Section[]; header: Header; innerRef: RefObject<HTMLDivElement | null> }) {
  const d = header.decimalPlaces;
  const cols = useMemo(() => {
    const own = sections.map((s) => ({ key: s.bk, label: s.name, s: summarize(s.rows) }));
    return own.length > 1 ? [...own, { key: "total", label: tr("JUMLA"), s: summarize(sumSections(sections.map((x) => x.rows))) }] : own;
  }, [sections]);
  const total: Summary = (cols[cols.length - 1] ?? { s: summarize([]) }).s;
  const multi = cols.length > 1;
  const expenseCodes = total.expenses.map((e) => ({ code: e.code, name: e.name }));
  const otherIncomeCodes = total.otherIncomeLines.map((e) => ({ code: e.code, name: e.name }));
  const trend = useMemo(() => meta.period === "day" ? [] : bucketDaily(total.daily, meta.period === "year" ? "month" : "day"), [total.daily, meta.period]);

  const th = "border border-[#1e3a5f] bg-[#1e3a5f] px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white";
  const td = "px-2 py-1 text-right tabular-nums";
  const rowOf = (label: string, pick: (s: Summary) => number, opts: { bold?: boolean; indent?: boolean; top?: boolean; double?: boolean; muted?: boolean } = {}) => (
    <tr className={`${opts.top ? "border-t border-neutral-500" : ""} ${opts.double ? "border-b-4 border-double border-neutral-700" : "border-b border-neutral-200"} ${opts.bold ? "font-bold" : ""} ${opts.muted ? "text-neutral-500" : ""}`}>
      <td className={`px-2 py-1 ${opts.indent ? "pl-6" : ""}`}>{label}</td>
      {cols.map((c) => <td key={c.key} className={`${td} ${multi && c.key === "total" ? "bg-neutral-100 font-semibold" : ""}`}>{acct(pick(c.s), d)}</td>)}
    </tr>
  );
  const band = (label: string) => <tr><td colSpan={cols.length + 1} className="bg-neutral-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[#1e3a5f]">{label}</td></tr>;
  const kpi = (label: string, value: number, sub?: string, tone = "text-neutral-900") => (
    <div className="rounded border border-neutral-300 bg-white p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p><p className={`text-lg font-bold tabular-nums ${tone}`}>{acct(value, d)}</p>{sub && <p className="text-[11px] text-neutral-500">{sub}</p>}</div>
  );

  return (
    <div ref={innerRef} className="mx-auto w-full max-w-5xl space-y-5 rounded-lg border border-neutral-300 bg-white p-6 text-neutral-900 shadow-sm md:p-8">
      {/* Letterhead */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#1e3a5f] pb-3">
        <div>
          <p className="text-xl font-bold tracking-tight text-[#1e3a5f]">{header.businessName || tr("Biashara")}</p>
          <p className="text-xs text-neutral-600">{[header.address, header.phone, header.email].filter(Boolean).join(" · ")}</p>
          {header.tin && <p className="text-xs text-neutral-600">TIN: {header.tin}</p>}
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">{periodName(meta.period)}</p>
          <p className="text-lg font-bold text-[#1e3a5f]">{tr("Taarifa ya Mapato, Matumizi na Fedha")}</p>
          <p className="text-xs text-neutral-600">{tr("Statement of Income, Expenses and Cash Movement")}</p>
        </div>
      </header>

      <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 md:grid-cols-4">
        <p><span className="text-neutral-500">{tr("Kipindi")}:</span> <b>{periodText(meta.period, meta.from, meta.to)}</b></p>
        <p><span className="text-neutral-500">{tr("Tarehe")}:</span> <b>{formatDate(meta.from)}{meta.to !== meta.from ? ` – ${formatDate(meta.to)}` : ""}</b></p>
        <p><span className="text-neutral-500">{tr("Idara")}:</span> <b>{meta.scopeLabel}</b></p>
        <p><span className="text-neutral-500">{tr("Sarafu")}:</span> <b>{header.currencySymbol}</b></p>
      </div>

      {/* Key figures */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpi(tr("Mauzo halisi"), total.netSales, total.returns > 0 ? tr("Baada ya marejesho: {0}", [acct(total.returns, d)]) : undefined)}
        {kpi(tr("Faida ya mauzo"), total.grossProfit, `${total.grossMarginPct}%`)}
        {kpi(tr("Jumla ya matumizi"), total.totalExpenses)}
        {kpi(tr("Faida halisi"), total.netProfit, `${total.netMarginPct}%`, total.netProfit < 0 ? "text-red-700" : "text-emerald-700")}
      </div>

      {/* 1. Income statement */}
      <section>
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-[#1e3a5f]">1. {tr("Taarifa ya Mapato na Matumizi (Income Statement)")}</h2>
        <div className="overflow-x-auto"><table className="w-full border-collapse text-xs">
          <thead><tr><th className={`${th} text-left`}>{tr("Maelezo")}</th>{cols.map((c) => <th key={c.key} className={th}>{c.label}</th>)}</tr></thead>
          <tbody>
            {band(tr("Mapato"))}
            {rowOf(tr("Mauzo (baada ya punguzo)"), (s) => s.sales, { indent: true })}
            {rowOf(tr("Toa: marejesho ya mauzo"), (s) => -s.returns, { indent: true })}
            {rowOf(tr("Mauzo halisi"), (s) => s.netSales, { bold: true, top: true })}
            {band(tr("Gharama ya mauzo"))}
            {rowOf(tr("Gharama ya bidhaa zilizouzwa"), (s) => s.cogs, { indent: true })}
            {rowOf(tr("FAIDA YA MAUZO (Gross profit)"), (s) => s.grossProfit, { bold: true, top: true })}
            {rowOf(tr("Kiwango cha faida ya mauzo (%)"), (s) => s.grossMarginPct, { indent: true, muted: true })}
            {otherIncomeCodes.length > 0 && band(tr("Mapato mengine"))}
            {otherIncomeCodes.map((x) => rowOf(x.name, (s) => s.otherIncomeLines.find((l) => l.code === x.code)?.amount ?? 0, { indent: true }))}
            {band(tr("Matumizi ya uendeshaji"))}
            {expenseCodes.length === 0 && <tr><td colSpan={cols.length + 1} className="px-2 py-1 pl-6 text-neutral-500">{tr("Hakuna matumizi yaliyorekodiwa kwenye kipindi hiki.")}</td></tr>}
            {expenseCodes.map((x) => rowOf(x.name, (s) => s.expenses.find((l) => l.code === x.code)?.amount ?? 0, { indent: true }))}
            {rowOf(tr("Jumla ya matumizi"), (s) => s.totalExpenses, { bold: true, top: true })}
            {rowOf(tr("FAIDA HALISI / (HASARA)"), (s) => s.netProfit, { bold: true, top: true, double: true })}
            {rowOf(tr("Kiwango cha faida halisi (%)"), (s) => s.netMarginPct, { indent: true, muted: true })}
          </tbody>
        </table></div>
      </section>

      {/* 2. Cash movement */}
      <section>
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-[#1e3a5f]">2. {tr("Mwenendo wa Fedha (Cash and Money Accounts Movement)")}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="overflow-x-auto"><table className="w-full border-collapse text-xs">
            <thead><tr><th className={`${th} text-left`}>{tr("Akaunti ya fedha")}</th><th className={th}>{tr("Zilizoingia")}</th><th className={th}>{tr("Zilizotoka")}</th><th className={th}>{tr("Net")}</th></tr></thead>
            <tbody>
              {total.money.length === 0 && <tr><td colSpan={4} className="px-2 py-1 text-neutral-500">{tr("Hakuna mwenendo wa fedha.")}</td></tr>}
              {total.money.map((m) => <tr key={m.code} className="border-b border-neutral-200"><td className="px-2 py-1">{m.name}</td><td className={td}>{acct(m.in, d)}</td><td className={td}>{acct(m.out, d)}</td><td className={td}>{acct(m.net, d)}</td></tr>)}
              <tr className="border-t border-neutral-500 font-bold"><td className="px-2 py-1">{tr("Jumla")}</td><td className={td}>{acct(total.cashIn, d)}</td><td className={td}>{acct(total.cashOut, d)}</td><td className={td}>{acct(total.netCash, d)}</td></tr>
            </tbody>
          </table></div>
          <div className="overflow-x-auto"><table className="w-full border-collapse text-xs">
            <thead><tr><th className={`${th} text-left`}>{tr("Chanzo / matumizi ya fedha")}</th><th className={th}>{tr("Zilizoingia")}</th><th className={th}>{tr("Zilizotoka")}</th><th className={th}>{tr("Net")}</th></tr></thead>
            <tbody>
              {total.sources.length === 0 && <tr><td colSpan={4} className="px-2 py-1 text-neutral-500">{tr("Hakuna mwenendo wa fedha.")}</td></tr>}
              {total.sources.map((x) => <tr key={x.key} className="border-b border-neutral-200"><td className="px-2 py-1">{SOURCE_LABEL(x.key)}</td><td className={td}>{acct(x.in, d)}</td><td className={td}>{acct(x.out, d)}</td><td className={td}>{acct(x.net, d)}</td></tr>)}
            </tbody>
          </table></div>
        </div>
        <p className="mt-1 text-[10px] text-neutral-500">{tr("Uhamisho kati ya akaunti za fedha unaonekana kama kuingia na kutoka kwa wakati mmoja.")}</p>
      </section>

      {/* 3. Other figures */}
      <section>
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-[#1e3a5f]">3. {tr("Taarifa Nyingine za Kipindi")}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <table className="w-full border-collapse text-xs"><tbody>
            {([
              [tr("Mabadiliko ya madeni ya wateja (Receivables)"), total.receivableChange],
              [tr("Mabadiliko ya madeni ya wasambazaji (Payables)"), total.supplierPayableChange],
              [tr("Mabadiliko ya madeni ya bili (Bills payable)"), total.billsPayableChange],
              [tr("Kodi iliyokusanywa (Tax collected, net)"), total.taxCollected],
            ] as Array<[string, number]>).map(([l, v]) => <tr key={l} className="border-b border-neutral-200"><td className="px-2 py-1">{l}</td><td className={td}>{acct(v, d)}</td></tr>)}
          </tbody></table>
          <table className="w-full border-collapse text-xs"><tbody>
            {([
              [tr("Idadi ya invoices zilizotolewa"), total.counts.invoices],
              [tr("Invoices zilizobatilishwa"), total.counts.voids],
              [tr("Marejesho ya bidhaa (returns)"), total.counts.returns],
              [tr("Miamala yote ya hesabu iliyochakatwa"), total.counts.entries],
            ] as Array<[string, number]>).map(([l, v]) => <tr key={l} className="border-b border-neutral-200"><td className="px-2 py-1">{l}</td><td className={td}>{formatNumber(v, 0)}</td></tr>)}
          </tbody></table>
        </div>
      </section>

      {/* 4. Trend */}
      {trend.length > 1 && (
        <section>
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-[#1e3a5f]">4. {meta.period === "year" ? tr("Mwenendo kwa Mwezi") : tr("Mwenendo kwa Siku")}</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d4" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => (v.length === 7 ? v.slice(5) : v.slice(8))} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatNumber(v, 0)} width={70} />
                <Tooltip formatter={(v) => formatNumber(Number(v), d)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sales" name={tr("Mauzo halisi")} fill="#1e3a5f" isAnimationActive={false} />
                <Bar dataKey="expenses" name={tr("Matumizi")} fill="#c2410c" isAnimationActive={false} />
                <Bar dataKey="profit" name={tr("Faida")} fill="#15803d" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Sign-off */}
      <section className="grid gap-6 pt-6 text-xs sm:grid-cols-3">
        {[tr("Imeandaliwa na"), tr("Imekaguliwa na"), tr("Imeidhinishwa na")].map((l, i) => (
          <div key={l}><div className="h-8 border-b border-neutral-500">{i === 0 ? <span className="text-neutral-700">{meta.preparedBy}</span> : null}</div><p className="pt-1 text-neutral-500">{l} · {tr("Sahihi / Tarehe")}</p></div>
        ))}
      </section>
      <footer className="border-t border-neutral-300 pt-2 text-[10px] leading-relaxed text-neutral-500">
        {tr("Msingi wa ripoti: accrual, kutoka kwenye miamala iliyopostiwa kwenye daftari la hesabu (ledger). Mauzo ni baada ya punguzo na bila kodi; marejesho na invoices zilizobatilishwa zimeondolewa.")}{" "}
        {tr("Imetolewa na SmartHub POS tarehe {0}.", [new Date(meta.generatedAt).toLocaleString(getLocale())])}
      </footer>
    </div>
  );
}

/* ───────────────────────────────────────── page ───────────────────────────────────────── */

export default function PeriodReportPage() {
  const convex = useConvex();
  const [params] = useSearchParams();
  const options = useQuery(api.periodReport.options);
  const header = useQuery(api.periodReport.header);
  const history = useQuery(api.periodReport.history, {});
  const save = useMutation(api.periodReport.save);
  const deleteRun = useMutation(api.periodReport.deleteRun);
  const superAdminInfo = useQuery(api.maintenance.clearDataOverview);
  const myPerms = useQuery(api.maintenance.myPermissions, {});
  const canDeleteReports = !!myPerms?.includes("accounts.reports.delete");  

  const initialPeriod = (["day", "month", "year"].includes(params.get("period") ?? "") ? params.get("period") : "day") as Period;
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [anchor, setAnchor] = useState(params.get("date") && /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? (params.get("date") as string) : localDate());
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ meta: Meta; sections: Section[] } | null>(null);
  const [openId, setOpenId] = useState<Id<"reportRuns"> | null>(null);
  const opened = useQuery(api.periodReport.getRun, openId ? { id: openId } : "skip");
  const docRef = useRef<HTMLDivElement>(null);
  const autoRan = useRef(false);

  const departments = useMemo(() => options?.departments ?? [], [options?.departments]);
  const fixed = options?.fixedDepartment ?? null;
  const effectiveScope = fixed ?? scope;
  const nameOf = useCallback((bk: string) => bk === "none" ? tr("Bila idara") : departments.find((x) => x.id === bk)?.name ?? tr("Idara"), [departments]);
  const scopeLabel = effectiveScope === "all" ? tr("Idara zote") : nameOf(effectiveScope);

  const generate = useCallback(async () => {
    if (!header) return;
    const { from, to } = periodRange(period, anchor);
    setBusy(true); setOpenId(null);
    try {
      // The range is read in short pieces and added up; a piece with too many entries is halved until it fits.
      const queue = chunkRange(from, to, CHUNK_DAYS);
      setProgress({ done: 0, total: queue.length });
      const byBranch = new Map<string, Map<string, Row>>();
      let done = 0;
      while (queue.length) {
        const piece = queue.shift()!;
        const res = await convex.query(api.periodReport.chunk, { from: piece.from, to: piece.to, scope: effectiveScope });
        if (res.tooBig) {
          const parts = halve(piece.from, piece.to);
          if (!parts) throw new Error(tr("Siku {0} ina miamala mingi mno kwa ripoti moja.", [piece.from]));
          queue.unshift(...parts); setProgress((p) => ({ ...p, total: p.total + 1 })); continue;
        }
        for (const s of res.sections) {
          let acc = byBranch.get(s.bk); if (!acc) { acc = new Map(); byBranch.set(s.bk, acc); }
          for (const r of s.rows) {
            const key = `${r.g}|${r.k}`; const cur = acc.get(key);
            if (cur) { cur.a += r.a; cur.b += r.b; cur.c += r.c; } else acc.set(key, { ...r });
          }
        }
        done++; setProgress((p) => ({ ...p, done }));
      }
      // One column per department (all of them, even those with no activity, so the report always shows every department asked for).
      const wanted = effectiveScope === "all" ? [...departments.map((x) => x.id), ...(byBranch.has("none") ? ["none"] : [])] : [effectiveScope];
      const sections: Section[] = (wanted.length ? wanted : ["none"]).map((bk) => ({ bk, name: departments.length === 0 ? header.businessName || tr("Biashara") : nameOf(bk), rows: [...(byBranch.get(bk)?.values() ?? [])].map((r) => ({ ...r, a: Math.round(r.a * 100) / 100, b: Math.round(r.b * 100) / 100, c: Math.round(r.c * 100) / 100 })) }));
      const meta: Meta = { period, from, to, scopeLabel, title: `${periodName(period)} — ${periodText(period, from, to)} — ${scopeLabel}`, generatedAt: new Date().toISOString(), preparedBy: header.preparedBy };
      setResult({ meta, sections });
      try { await save({ period, startDate: from, endDate: to, scope: effectiveScope, scopeLabel, title: meta.title, sections }); toast.success(tr("Ripoti imeundwa na kuhifadhiwa kwenye historia.")); }
      catch (e) { toast.warning(errorText(e, "Ripoti imeundwa lakini haikuhifadhiwa kwenye historia.")); }
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuunda ripoti.")); }
    finally { setBusy(false); }
  }, [convex, header, period, anchor, effectiveScope, departments, nameOf, scopeLabel, save]);

  // Coming from the "Maliza siku" switch on the Expenses page: build today's report straight away.
  useEffect(() => {
    if (autoRan.current || params.get("auto") !== "1" || !header || !options) return;
    autoRan.current = true; void generate();
  }, [params, header, options, generate]);

  const shown = openId && opened ? { meta: { period: opened.period as Period, from: opened.startDate, to: opened.endDate, scopeLabel: opened.scopeLabel, title: opened.title, generatedAt: opened.createdAt, preparedBy: opened.createdByName }, sections: opened.sections } : result;
  const monthValue = anchor.slice(0, 7);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader icon={FileBarChart} title={tr("Ripoti ya Siku / Mwezi / Mwaka")} subtitle={tr("Mauzo, marejesho, matumizi, faida na mwenendo wa fedha kwa idara moja au zote.")} />

      <Panel title={tr("Unda ripoti")}>
        <div className="grid gap-3 md:grid-cols-4">
          <FormField label={tr("Aina ya ripoti")}>
            <SelectBox value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              <option value="day">{tr("Siku")}</option><option value="month">{tr("Mwezi")}</option><option value="year">{tr("Mwaka")}</option>
            </SelectBox>
          </FormField>
          <FormField label={period === "day" ? tr("Tarehe") : period === "month" ? tr("Mwezi") : tr("Mwaka")}>
            {period === "day" && <Input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} />}
            {period === "month" && <Input type="month" value={monthValue} onChange={(e) => e.target.value && setAnchor(`${e.target.value}-01`)} />}
            {period === "year" && <Input type="number" min={2000} max={2100} value={anchor.slice(0, 4)} onChange={(e) => /^\d{4}$/.test(e.target.value) && setAnchor(`${e.target.value}-01-01`)} />}
          </FormField>
          <FormField label={tr("Idara")} hint={fixed ? tr("Akaunti yako imefungwa kwenye idara hii.") : undefined}>
            <SelectBox value={effectiveScope} disabled={!!fixed || departments.length === 0} onChange={(e) => setScope(e.target.value)}>
              {!fixed && <option value="all">{departments.length ? tr("Idara zote") : tr("Biashara nzima")}</option>}
              {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </SelectBox>
          </FormField>
          <div className="flex items-end"><Button className="w-full" disabled={busy || !header || !options} onClick={() => void generate()}>{busy ? tr("Inaunda… {0}/{1}", [progress.done, progress.total]) : tr("Unda Ripoti")}</Button></div>
        </div>
      </Panel>

      {shown && header && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => printElement(docRef.current, "A4", { landscape: shown.sections.length > 2 })}><Printer className="mr-1 h-4 w-4" />{tr("Chapisha / Hifadhi PDF")}</Button>
          </div>
          <ReportDocument meta={shown.meta} sections={shown.sections} header={header} innerRef={docRef} />
        </div>
      )}
      {openId && opened === null && <Empty>{tr("Ripoti hii haipatikani.")}</Empty>}

      <Panel title={tr("Historia ya ripoti zilizoundwa")}>
        {!history ? <p className="text-sm text-muted-foreground">{tr("Inapakia…")}</p> : history.length === 0 ? <Empty>{tr("Hakuna ripoti iliyoundwa bado.")}</Empty> : (
          <Table head={[tr("Ripoti"), tr("Aina"), tr("Idara"), tr("Mauzo halisi"), tr("Matumizi"), tr("Faida halisi"), tr("Ameunda"), ""]}>
            {history.map((h) => (
              <tr key={h._id}>
                <td className="font-medium">{periodText(h.period as Period, h.startDate, h.endDate)}</td>
                <td>{periodName(h.period)}</td><td>{h.scopeLabel}</td>
                <td className="whitespace-nowrap tabular-nums">{formatNumber(h.netSales, header?.decimalPlaces ?? 0)}</td>
                <td className="whitespace-nowrap tabular-nums">{formatNumber(h.totalExpenses, header?.decimalPlaces ?? 0)}</td>
                <td className={`whitespace-nowrap tabular-nums font-semibold ${h.netProfit < 0 ? "text-destructive" : ""}`}>{acct(h.netProfit, header?.decimalPlaces ?? 0)}</td>
                <td className="whitespace-nowrap text-xs text-muted-foreground">{h.createdByName}<br />{new Date(h.createdAt).toLocaleString(getLocale())}</td>
                <td className="text-right">
  <div className="flex justify-end gap-2">
    <Button size="sm" variant="outline" onClick={() => { setResult(null); setOpenId(h._id); scrollAppToTop("smooth"); }}>{tr("Fungua")}</Button>
    {(superAdminInfo?.isSuperAdmin === true || canDeleteReports) && <Button size="sm" variant="destructive" onClick={async () => {
      if (!window.confirm(`Una uhakika unataka kufuta ripoti "${periodText(h.period as Period, h.startDate, h.endDate)}"? Kitendo hiki hakiwezi kutenguliwa.`)) return;
      try {
        await deleteRun({ id: h._id });
        if (openId === h._id) { setOpenId(null); setResult(null); }
        toast.success(tr("Ripoti imefutwa."));
      } catch (e) {
        toast.error(errorText(e, tr("Imeshindikana kufuta ripoti.")));
      }
    }}>{tr("Futa")}</Button>}
  </div>
</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
