/**
 * PERIOD REPORT CORE (day / month / year) - pure functions, no Convex imports.
 *
 * Used twice:
 *  - convex/periodReport.ts turns the posted journal entries of a few days into small additive `Row`s;
 *  - the Accounts > Period Report screen adds the rows of many chunks together (mergeRows) and calls `summarize`.
 * Because rows are additive (a, b, c are plain sums) a year can be built from many small server calls
 * instead of one query that would have to read the whole year.
 *
 * Basis: accrual, from POSTED ledger entries (same source as the Profit and Loss report), so every figure
 * agrees with the books: sales, returns, voids, bills, payroll, purchases and manual journals are all included.
 */

export type Row = { g: string; k: string; label: string; a: number; b: number; c: number };
export type JLine = { code: string; name: string; type: string; subtype?: string; debit: number; credit: number };
export type JEntry = { entryDate: string; sourceType?: string; lines: JLine[] };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Accounts that hold money: Cash 1000, Bank 1010, Mobile money 1020 and the account of each payment method. */
export const isMoneyLine = (l: Pick<JLine, "type" | "code" | "subtype">) => l.type === "asset" && (["1000", "1010", "1020"].includes(l.code) || l.subtype === "payment_method");

const CAPITAL_SOURCES = new Set(["capital", "owner_capital", "director_capital", "shareholder", "bank_loan", "director_loan", "other_loan", "grant"]);
/** Groups the many journal source types into the few cash-flow headings printed on the report. */
export function cashSource(sourceType?: string): string {
  const s = sourceType ?? "manual";
  if (s === "sale" || s === "waiter_sale" || s === "payment") return "customer_receipts";
  if (s === "sale_void" || s === "sale_return") return "customer_refunds";
  if (s === "purchase" || s === "supplier_payment" || s === "purchase_return") return "suppliers";
  if (s === "bill" || s === "bill_payment" || s === "bill_void") return "bills";
  if (s === "payroll") return "payroll";
  if (CAPITAL_SOURCES.has(s)) return "capital";
  return "other";
}

type Acc = Map<string, Row>;
export function addRow(acc: Acc, r: Row) {
  const key = `${r.g}|${r.k}`;
  const cur = acc.get(key);
  if (cur) { cur.a = round2(cur.a + r.a); cur.b = round2(cur.b + r.b); cur.c = round2(cur.c + r.c); if (!cur.label && r.label) cur.label = r.label; }
  else acc.set(key, { ...r, a: round2(r.a), b: round2(r.b), c: round2(r.c) });
}
export const mergeRows = (acc: Acc, rows: Row[]) => { for (const r of rows) addRow(acc, r); return acc; };
export const accRows = (acc: Acc): Row[] => [...acc.values()].filter((r) => r.a !== 0 || r.b !== 0 || r.c !== 0);

/** Journal entry -> additive rows. */
export function entryRows(e: JEntry, acc: Acc = new Map()): Acc {
  const row = (g: string, k: string, label: string, a = 0, b = 0, c = 0) => addRow(acc, { g, k, label, a, b, c });
  row("stat", "entries", "", 1);
  if (e.sourceType === "sale" || e.sourceType === "waiter_sale") row("stat", "invoices", "", 1);
  if (e.sourceType === "sale_void") row("stat", "voids", "", 1);
  if (e.sourceType === "sale_return") row("stat", "returns", "", 1);
  let daySales = 0, dayOpex = 0, dayCogs = 0, moneyIn = 0, moneyOut = 0;
  for (const l of e.lines) {
    const debit = l.debit || 0, credit = l.credit || 0;
    if (l.type === "revenue") {
      const amount = credit - debit;
      row("rev", l.code, l.name, amount);
      if (l.code === "4000" || l.code === "4100") daySales += amount;
    } else if (l.type === "expense") {
      const amount = debit - credit;
      if (l.code === "5000") { row("cogs", l.code, l.name, amount); dayCogs += amount; }
      else { row("exp", l.code, l.name, amount); dayOpex += amount; }
    } else if (l.code === "1100") row("bal", "ar", "", debit - credit);
    else if (l.code === "2000") row("bal", "ap", "", credit - debit);
    else if (l.code === "2100") row("bal", "bills", "", credit - debit);
    else if (l.code === "2150") row("bal", "tax", "", credit - debit);
    if (isMoneyLine(l)) { row("money", l.code, l.name, debit, credit); moneyIn += debit; moneyOut += credit; }
  }
  if (moneyIn || moneyOut) row("src", cashSource(e.sourceType), "", moneyIn, moneyOut);
  if (daySales || dayOpex || dayCogs) row("day", e.entryDate, "", daySales, dayOpex, dayCogs);
  return acc;
}

export type Summary = {
  sales: number; returns: number; netSales: number; otherIncome: number; cogs: number; grossProfit: number; grossMarginPct: number;
  expenses: Array<{ code: string; name: string; amount: number }>; totalExpenses: number; netProfit: number; netMarginPct: number;
  otherIncomeLines: Array<{ code: string; name: string; amount: number }>;
  money: Array<{ code: string; name: string; in: number; out: number; net: number }>; cashIn: number; cashOut: number; netCash: number;
  sources: Array<{ key: string; in: number; out: number; net: number }>;
  receivableChange: number; supplierPayableChange: number; billsPayableChange: number; taxCollected: number;
  counts: { entries: number; invoices: number; voids: number; returns: number };
  daily: Array<{ date: string; sales: number; expenses: number; cogs: number; profit: number }>;
};

const pct = (part: number, whole: number) => (whole > 0 ? round2((part / whole) * 100) : 0);

export function summarize(rows: Row[]): Summary {
  const get = (g: string, k: string) => rows.find((r) => r.g === g && r.k === k);
  const of = (g: string) => rows.filter((r) => r.g === g);
  const sales = round2(get("rev", "4000")?.a ?? 0);
  const returns = round2(-(get("rev", "4100")?.a ?? 0));
  const otherIncomeLines = of("rev").filter((r) => r.k !== "4000" && r.k !== "4100" && r.a !== 0).map((r) => ({ code: r.k, name: r.label, amount: r.a })).sort((x, y) => x.code.localeCompare(y.code));
  const otherIncome = round2(otherIncomeLines.reduce((n, r) => n + r.amount, 0));
  const cogs = round2(of("cogs").reduce((n, r) => n + r.a, 0));
  const netSales = round2(sales - returns);
  const grossProfit = round2(netSales - cogs);
  const expenses = of("exp").filter((r) => r.a !== 0).map((r) => ({ code: r.k, name: r.label, amount: r.a })).sort((x, y) => y.amount - x.amount || x.code.localeCompare(y.code));
  const totalExpenses = round2(expenses.reduce((n, r) => n + r.amount, 0));
  const netProfit = round2(grossProfit + otherIncome - totalExpenses);
  const money = of("money").map((r) => ({ code: r.k, name: r.label, in: r.a, out: r.b, net: round2(r.a - r.b) })).sort((x, y) => x.code.localeCompare(y.code));
  const cashIn = round2(money.reduce((n, r) => n + r.in, 0)), cashOut = round2(money.reduce((n, r) => n + r.out, 0));
  const sources = of("src").map((r) => ({ key: r.k, in: r.a, out: r.b, net: round2(r.a - r.b) }));
  const stat = (k: string) => get("stat", k)?.a ?? 0;
  const daily = of("day").map((r) => ({ date: r.k, sales: r.a, expenses: r.b, cogs: r.c, profit: round2(r.a - r.c - r.b) })).sort((x, y) => x.date.localeCompare(y.date));
  return {
    sales, returns, netSales, otherIncome, cogs, grossProfit, grossMarginPct: pct(grossProfit, netSales),
    expenses, totalExpenses, netProfit, netMarginPct: pct(netProfit, netSales), otherIncomeLines,
    money, cashIn, cashOut, netCash: round2(cashIn - cashOut), sources,
    receivableChange: round2(get("bal", "ar")?.a ?? 0), supplierPayableChange: round2(get("bal", "ap")?.a ?? 0), billsPayableChange: round2(get("bal", "bills")?.a ?? 0), taxCollected: round2(get("bal", "tax")?.a ?? 0),
    counts: { entries: stat("entries"), invoices: stat("invoices"), voids: stat("voids"), returns: stat("returns") },
    daily,
  };
}

/** Sums several summaries' source rows into one (used for the "All departments" total column). */
export const sumSections = (sections: Row[][]): Row[] => accRows(sections.reduce((acc, rows) => mergeRows(acc, rows), new Map<string, Row>() as Acc));

/* ───────────────────────── dates (pure string math, no timezone surprises) ───────────────────────── */

export type Period = "day" | "month" | "year";
const pad = (n: number) => String(n).padStart(2, "0");
const utc = (d: string) => { const [y, m, day] = d.split("-").map(Number); return Date.UTC(y, m - 1, day); };
export const addDays = (d: string, n: number) => { const t = new Date(utc(d) + n * 86_400_000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
export const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(utc(d)) && addDays(d, 0) === d;

export function periodRange(period: Period, anchor: string): { from: string; to: string } {
  const [y, m] = anchor.split("-").map(Number);
  if (period === "day") return { from: anchor, to: anchor };
  if (period === "month") { const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` }; }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** Cuts a range into pieces of at most `size` days (oldest first). */
export function chunkRange(from: string, to: string, size: number): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (let s = from; s <= to; s = addDays(s, size)) { const e = addDays(s, size - 1); out.push({ from: s, to: e > to ? to : e }); }
  return out;
}
/** Halves a range (used when one chunk holds too many entries for a single server call). null = cannot be split further (one day). */
export function halve(from: string, to: string): [{ from: string; to: string }, { from: string; to: string }] | null {
  const n = daysBetween(from, to); if (n < 2) return null;
  const mid = addDays(from, Math.floor(n / 2) - 1);
  return [{ from, to: mid }, { from: addDays(mid, 1), to }];
}

/** Daily figures -> one bar per day (month view) or per month (year view). */
export function bucketDaily(daily: Summary["daily"], by: "day" | "month") {
  const m = new Map<string, { date: string; sales: number; expenses: number; cogs: number; profit: number }>();
  for (const d of daily) {
    const key = by === "month" ? d.date.slice(0, 7) : d.date;
    const cur = m.get(key) ?? { date: key, sales: 0, expenses: 0, cogs: 0, profit: 0 };
    cur.sales = round2(cur.sales + d.sales); cur.expenses = round2(cur.expenses + d.expenses); cur.cogs = round2(cur.cogs + d.cogs); cur.profit = round2(cur.profit + d.profit);
    m.set(key, cur);
  }
  return [...m.values()].sort((x, y) => x.date.localeCompare(y.date));
}
