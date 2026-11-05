import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
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
import { chunkRange, halve, periodRange, statement, sumSections, summarize, type DebtRow, type ExpenseItem, type Period, type Row, type Statement, type Summary } from "@/convex/reportCore.ts";
import { toast } from "sonner";

type Section = { bk: string; name: string; rows: Row[]; items?: ExpenseItem[] };
type Debts = { waiters: DebtRow[]; customers: DebtRow[] };
type Meta = { period: Period; from: string; to: string; scopeLabel: string; title: string; generatedAt: string; preparedBy: string };
type Header = { businessName: string; address: string; phone: string; email: string; tin: string; currencySymbol: string; decimalPlaces: number; preparedBy: string };

const CHUNK_DAYS = 7;
/** Accounting style: negatives in brackets, zero as a dash. */
const acct = (n: number, d: number) => (Math.abs(n) < 0.005 ? "–" : n < 0 ? `(${formatNumber(-n, d)})` : formatNumber(n, d));

function periodText(period: Period, from: string, to: string) {
  if (period === "day") return formatDate(from);
  if (period === "month") return new Date(`${from}T00:00:00`).toLocaleDateString(getLocale(), { month: "long", year: "numeric" });
  return `${from.slice(0, 4)}`;
}
const periodName = (p: string) => p === "day" ? tr("Ripoti ya Siku") : p === "month" ? tr("Ripoti ya Mwezi") : tr("Ripoti ya Mwaka");

/* ───────────────────────────────────────── the printable report ───────────────────────────────────────── */

const INK = "#0f2742"; // one accent colour only: deep navy

function ReportDocument({ meta, sections, debts, header, innerRef }: { meta: Meta; sections: Section[]; debts: Debts | null; header: Header; innerRef: RefObject<HTMLDivElement | null> }) {
  const d = header.decimalPlaces;
  const money = (n: number) => formatNumber(n, d);
  const W = useMemo(() => debts?.waiters ?? [], [debts]);
  const C = useMemo(() => debts?.customers ?? [], [debts]);
  const sum = (rows: DebtRow[], f: (r: DebtRow) => number) => rows.reduce((n, r) => n + f(r), 0);

  const total = useMemo(() => summarize(sumSections(sections.map((x) => x.rows))), [sections]);
  const st: Statement = useMemo(() => statement(total, sum(W, (r) => r.amount), sum(W, (r) => r.cost), sum(C, (r) => r.amount)), [total, W, C]);
  const perDept = useMemo(() => sections.length < 2 ? [] : sections.map((x) => {
    const w = W.filter((r) => r.bk === x.bk), c = C.filter((r) => r.bk === x.bk);
    return { bk: x.bk, name: x.name, st: statement(summarize(x.rows), sum(w, (r) => r.amount), sum(w, (r) => r.cost), sum(c, (r) => r.amount)) };
  }), [sections, W, C]);

  // Expenses exactly as entered; an old saved report without the list falls back to its category totals.
  const items = useMemo(() => {
    const list = sections.flatMap((x) => x.items ?? []).sort((p, q) => p.d.localeCompare(q.d) || p.t.localeCompare(q.t));
    return list.length ? list : total.expenses.map((e) => ({ bk: "", d: "", t: e.name, c: "", a: e.amount }));
  }, [sections, total.expenses]);
  const hasDates = items.some((i) => i.d);
  const dateCol = meta.period === "day" ? false : hasDates;

  const num = "px-2 py-1.5 text-right tabular-nums";
  const head = "border-b-2 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500";
  const h2 = "mb-2 text-[11px] font-bold uppercase tracking-[0.18em]";
  const loss = st.profitAfter < 0;
  const channelBoxes: Array<[string, number]> = [["CASH", total.channels.cash], ["LIPA", total.channels.lipa], ["BANK", total.channels.bank], ...(Math.abs(total.channels.other) >= 0.005 ? [[tr("NYINGINE"), total.channels.other] as [string, number]] : [])];
  const big = (label: string, value: number, tone = "") => (
    <div className="border-t-2 pt-2" style={{ borderColor: INK }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{acct(value, d)}</p>
    </div>
  );
  const line = (label: string, value: number, o: { strong?: boolean; sub?: boolean; double?: boolean; tone?: string } = {}) => (
    <tr className={`${o.strong ? "font-bold" : ""} ${o.double ? "border-t-2 border-neutral-800" : "border-t border-neutral-200"}`}>
      <td className={`px-2 py-1.5 ${o.sub ? "pl-6 text-neutral-600" : ""}`}>{label}</td>
      <td className={`${num} ${o.tone ?? ""}`}>{acct(value, d)}</td>
    </tr>
  );

  return (
    <div ref={innerRef} className="mx-auto w-full max-w-3xl space-y-6 rounded-lg border border-neutral-200 bg-white p-6 text-[12px] leading-snug text-neutral-900 shadow-sm md:p-10">
      {/* Letterhead */}
      <header className="flex items-end justify-between gap-4 border-b-2 pb-3" style={{ borderColor: INK }}>
        <div>
          <p className="text-xl font-bold tracking-tight" style={{ color: INK }}>{header.businessName || tr("Biashara")}</p>
          <p className="text-[11px] text-neutral-500">{[header.address, header.phone, header.email].filter(Boolean).join(" · ")}</p>
          {header.tin && <p className="text-[11px] text-neutral-500">TIN: {header.tin}</p>}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">{periodName(meta.period)}</p>
          <p className="text-lg font-bold" style={{ color: INK }}>{periodText(meta.period, meta.from, meta.to)}</p>
          {meta.to !== meta.from && <p className="text-[11px] text-neutral-500">{formatDate(meta.from)} – {formatDate(meta.to)}</p>}
        </div>
      </header>

      {/* The four numbers that matter */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-4">
        {big(tr("MAUZO"), st.sales)}
        {big(tr("MATUMIZI"), st.expenses)}
        {big(tr("MADENI"), st.debts)}
        {big(loss ? tr("HASARA") : tr("FAIDA"), loss ? -st.profitAfter : st.profitAfter, loss ? "text-red-700" : "text-emerald-700")}
      </div>

      {/* 1. Sales, capital, profit */}
      <section>
        <h2 className={h2} style={{ color: INK }}>1. {tr("Mauzo, Mtaji na Faida")}</h2>
        <table className="w-full border-collapse"><tbody>
          {line(tr("Mauzo ya jumla"), st.sales, { strong: true })}
          {line(tr("Mtaji (gharama ya bidhaa zilizouzwa)"), st.capital, { sub: true })}
          {line(tr("Faida ya mauzo"), st.grossProfit, { strong: true })}
          {Math.abs(st.otherIncome) >= 0.005 && line(tr("Mapato mengine"), st.otherIncome, { sub: true })}
          {line(tr("Toa: matumizi"), -st.expenses, { sub: true })}
          {line(loss ? tr("HASARA") : tr("FAIDA HALISI"), st.profitAfter, { strong: true, double: true, tone: loss ? "text-red-700" : "text-emerald-700" })}
        </tbody></table>
        {loss ? (
          <div className="mt-3 border-l-4 border-red-600 bg-red-50 px-3 py-2 text-red-900">
            <p className="font-bold">{tr("Matumizi yamezidi faida. Mtaji umeliwa: {0}", [money(st.capitalEaten)])}</p>
            <p>{tr("Mtaji uliobaki: {0} kati ya {1}.", [money(st.capitalLeft), money(st.capital)])}</p>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-neutral-500">{tr("Matumizi yamelipwa kutoka kwenye faida; mtaji wote ({0}) umebaki salama.", [money(st.capital)])}</p>
        )}
        {st.debts > 0 && <p className="mt-1 text-[11px] text-neutral-500">{tr("Mauzo ya jumla yanajumuisha madeni ambayo hayajakusanywa.")}</p>}
      </section>

      {/* 2. Expenses in detail */}
      <section>
        <h2 className={h2} style={{ color: INK }}>2. {tr("Matumizi (kwa undani)")}</h2>
        <table className="w-full border-collapse">
          <thead><tr>
            {dateCol && <th className={`${head} text-left`} style={{ borderColor: INK }}>{tr("Tarehe")}</th>}
            <th className={`${head} text-left`} style={{ borderColor: INK }}>{tr("Maelezo")}</th>
            <th className={`${head} text-left`} style={{ borderColor: INK }}>{tr("Aina")}</th>
            <th className={`${head} text-right`} style={{ borderColor: INK }}>{tr("Kiasi")}</th>
          </tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={dateCol ? 4 : 3} className="px-2 py-2 text-neutral-500">{tr("Hakuna matumizi yaliyorekodiwa kwenye kipindi hiki.")}</td></tr>}
            {items.map((i, n) => (
              <tr key={n} className="border-b border-neutral-200">
                {dateCol && <td className="whitespace-nowrap px-2 py-1.5 text-neutral-600">{i.d ? formatDate(i.d) : ""}</td>}
                <td className="px-2 py-1.5">{i.t}</td>
                <td className="px-2 py-1.5 text-neutral-600">{i.c}</td>
                <td className={num}>{acct(i.a, d)}</td>
              </tr>
            ))}
            {items.length > 0 && <tr className="border-t-2 border-neutral-800 font-bold"><td colSpan={dateCol ? 3 : 2} className="px-2 py-1.5">{tr("Jumla ya matumizi")}</td><td className={num}>{acct(st.expenses, d)}</td></tr>}
          </tbody>
        </table>
      </section>

      {/* 3. Debts */}
      <section>
        <h2 className={h2} style={{ color: INK }}>3. {tr("Madeni")}</h2>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{tr("Wahudumu (waiters / waitresses) — hawajakabidhi pesa")}</p>
        <table className="w-full border-collapse">
          <thead><tr><th className={`${head} text-left`} style={{ borderColor: INK }}>{tr("Jina")}</th><th className={`${head} text-right`} style={{ borderColor: INK }}>{tr("Oda")}</th><th className={`${head} text-right`} style={{ borderColor: INK }}>{tr("Anadaiwa")}</th></tr></thead>
          <tbody>
            {W.length === 0 && <tr><td colSpan={3} className="px-2 py-2 text-neutral-500">{tr("Hakuna deni la mhudumu.")}</td></tr>}
            {mergeByName(W).map((r) => <tr key={r.name} className="border-b border-neutral-200"><td className="px-2 py-1.5">{r.name}</td><td className={num}>{formatNumber(r.orders, 0)}</td><td className={num}>{acct(r.amount, d)}</td></tr>)}
            {W.length > 0 && <tr className="border-t-2 border-neutral-800 font-bold"><td className="px-2 py-1.5">{tr("Jumla")}</td><td className={num}>{formatNumber(sum(W, (r) => r.orders), 0)}</td><td className={num}>{acct(sum(W, (r) => r.amount), d)}</td></tr>}
          </tbody>
        </table>
        {C.length > 0 && (
          <>
            <p className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{tr("Wateja (mauzo ya mkopo)")}</p>
            <table className="w-full border-collapse">
              <tbody>
                {mergeByName(C).map((r) => <tr key={r.name} className="border-b border-neutral-200"><td className="px-2 py-1.5">{r.name}</td><td className={num}>{formatNumber(r.orders, 0)}</td><td className={num}>{acct(r.amount, d)}</td></tr>)}
                <tr className="border-t-2 border-neutral-800 font-bold"><td className="px-2 py-1.5">{tr("Jumla")}</td><td className={num}>{formatNumber(sum(C, (r) => r.orders), 0)}</td><td className={num}>{acct(sum(C, (r) => r.amount), d)}</td></tr>
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* 4. Money received */}
      <section>
        <h2 className={h2} style={{ color: INK }}>4. {tr("Pesa Zilizopokelewa")}</h2>
        <div className={`grid gap-x-5 gap-y-3 ${channelBoxes.length > 3 ? "grid-cols-4" : "grid-cols-3"}`}>
          {channelBoxes.map(([label, value]) => (
            <div key={label} className="border-t border-neutral-300 pt-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">{label}</p><p className="mt-0.5 text-base font-bold tabular-nums">{acct(value, d)}</p></div>
          ))}
        </div>
        <p className="mt-2 text-right text-[11px] text-neutral-600">{tr("Jumla iliyopokelewa")}: <b className="tabular-nums text-neutral-900">{acct(total.channels.total, d)}</b></p>
      </section>

      {/* By department (only when the report covers more than one) */}
      {perDept.length > 1 && (
        <section>
          <h2 className={h2} style={{ color: INK }}>{tr("Kwa Idara")}</h2>
          <table className="w-full border-collapse">
            <thead><tr><th className={`${head} text-left`} style={{ borderColor: INK }}>{tr("Idara")}</th><th className={`${head} text-right`} style={{ borderColor: INK }}>{tr("Mauzo")}</th><th className={`${head} text-right`} style={{ borderColor: INK }}>{tr("Matumizi")}</th><th className={`${head} text-right`} style={{ borderColor: INK }}>{tr("Faida / (Hasara)")}</th></tr></thead>
            <tbody>{perDept.map((x) => <tr key={x.bk} className="border-b border-neutral-200"><td className="px-2 py-1.5">{x.name}</td><td className={num}>{acct(x.st.sales, d)}</td><td className={num}>{acct(x.st.expenses, d)}</td><td className={`${num} ${x.st.profitAfter < 0 ? "text-red-700" : ""}`}>{acct(x.st.profitAfter, d)}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      {/* Sign-off */}
      <section className="grid grid-cols-2 gap-8 pt-6">
        {[tr("Imeandaliwa na"), tr("Imekaguliwa na")].map((l, i) => (
          <div key={l}><div className="h-8 border-b border-neutral-500">{i === 0 ? <span className="text-neutral-700">{meta.preparedBy}</span> : null}</div><p className="pt-1 text-[10px] text-neutral-500">{l} · {tr("Sahihi / Tarehe")}</p></div>
        ))}
      </section>
      <footer className="border-t border-neutral-200 pt-2 text-[10px] text-neutral-400">
        {tr("Imetolewa na SmartHub POS tarehe {0}.", [new Date(meta.generatedAt).toLocaleString(getLocale())])} · {header.currencySymbol}
      </footer>
    </div>
  );
}

/** One line per person (a name can come from several departments). */
function mergeByName(rows: DebtRow[]) {
  const m = new Map<string, { name: string; orders: number; amount: number }>();
  for (const r of rows) { const c = m.get(r.name) ?? { name: r.name, orders: 0, amount: 0 }; c.orders += r.orders; c.amount += r.amount; m.set(r.name, c); }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
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
  const [result, setResult] = useState<{ meta: Meta; sections: Section[]; debts: Debts | null } | null>(null);
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
      const itemsBy = new Map<string, ExpenseItem[]>();
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
          if (s.items.length) itemsBy.set(s.bk, [...(itemsBy.get(s.bk) ?? []), ...s.items]);
        }
        done++; setProgress((p) => ({ ...p, done }));
      }
      const debtsRes = await convex.query(api.periodReport.debts, { from, to, scope: effectiveScope });
      const debts: Debts = { waiters: debtsRes.waiters, customers: debtsRes.customers };
      // One section per department (all of them, even those with no activity, so the report always shows every department asked for).
      const wanted = effectiveScope === "all" ? [...departments.map((x) => x.id), ...(byBranch.has("none") ? ["none"] : [])] : [effectiveScope];
      const sections: Section[] = (wanted.length ? wanted : ["none"]).map((bk) => ({ bk, name: departments.length === 0 ? header.businessName || tr("Biashara") : nameOf(bk), rows: [...(byBranch.get(bk)?.values() ?? [])].map((r) => ({ ...r, a: Math.round(r.a * 100) / 100, b: Math.round(r.b * 100) / 100, c: Math.round(r.c * 100) / 100 })), items: itemsBy.get(bk) ?? [] }));
      const meta: Meta = { period, from, to, scopeLabel, title: `${periodName(period)} — ${periodText(period, from, to)} — ${scopeLabel}`, generatedAt: new Date().toISOString(), preparedBy: header.preparedBy };
      setResult({ meta, sections, debts });
      try { await save({ period, startDate: from, endDate: to, scope: effectiveScope, scopeLabel, title: meta.title, sections, debts }); toast.success(tr("Ripoti imeundwa na kuhifadhiwa kwenye historia.")); }
      catch (e) { toast.warning(errorText(e, "Ripoti imeundwa lakini haikuhifadhiwa kwenye historia.")); }
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuunda ripoti.")); }
    finally { setBusy(false); }
  }, [convex, header, period, anchor, effectiveScope, departments, nameOf, scopeLabel, save]);

  // Coming from the "Maliza siku" switch on the Expenses page: build today's report straight away.
  useEffect(() => {
    if (autoRan.current || params.get("auto") !== "1" || !header || !options) return;
    autoRan.current = true; void generate();
  }, [params, header, options, generate]);

  const shown = openId && opened ? { meta: { period: opened.period as Period, from: opened.startDate, to: opened.endDate, scopeLabel: opened.scopeLabel, title: opened.title, generatedAt: opened.createdAt, preparedBy: opened.createdByName }, sections: opened.sections, debts: opened.debts } : result;
  const monthValue = anchor.slice(0, 7);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader icon={FileBarChart} title={tr("Ripoti ya Siku / Mwezi / Mwaka")} subtitle={tr("Mauzo, matumizi, madeni, mtaji na faida kwa siku, mwezi au mwaka.")} />

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
            <Button variant="outline" size="sm" onClick={() => printElement(docRef.current, "A4")}><Printer className="mr-1 h-4 w-4" />{tr("Chapisha / Hifadhi PDF")}</Button>
          </div>
          <ReportDocument meta={shown.meta} sections={shown.sections} debts={shown.debts} header={header} innerRef={docRef} />
        </div>
      )}
      {openId && opened === null && <Empty>{tr("Ripoti hii haipatikani.")}</Empty>}

      <Panel title={tr("Historia ya ripoti zilizoundwa")}>
        {!history ? <p className="text-sm text-muted-foreground">{tr("Inapakia…")}</p> : history.length === 0 ? <Empty>{tr("Hakuna ripoti iliyoundwa bado.")}</Empty> : (
          <Table head={[tr("Ripoti"), tr("Aina"), tr("Idara"), tr("Mauzo"), tr("Matumizi"), tr("Faida halisi"), tr("Ameunda"), ""]}>
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
