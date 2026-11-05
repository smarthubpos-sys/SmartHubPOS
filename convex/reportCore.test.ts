import { describe, expect, it } from "vitest";
import { accRows, addDays, bucketDaily, chunkRange, daysBetween, entryRows, halve, isDate, mergeRows, periodRange, statement, summarize, type JEntry, type Row } from "./reportCore";

const L = (code: string, name: string, type: string, debit: number, credit: number, subtype?: string) => ({ code, name, type, subtype, debit, credit });
const cash = (d: number, c: number) => L("1000", "Cash", "asset", d, c);
const entries: JEntry[] = [
  { entryDate: "2026-10-14", sourceType: "sale", lines: [cash(100000, 0), L("1100", "AR", "asset", 18000, 0), L("4000", "Sales", "revenue", 0, 100000), L("2150", "Tax", "liability", 0, 18000), L("5000", "COGS", "expense", 60000, 0), L("1200", "Inv", "asset", 0, 60000)] },
  { entryDate: "2026-10-14", sourceType: "bill", lines: [L("6100", "Rent", "expense", 20000, 0), L("2100", "AP bills", "liability", 0, 20000)] },
  { entryDate: "2026-10-14", sourceType: "sale_return", lines: [L("4100", "Returns", "revenue", 10000, 0), L("2150", "Tax", "liability", 1800, 0), cash(0, 11800), L("1200", "Inv", "asset", 6000, 0), L("5000", "COGS", "expense", 0, 6000)] },
  { entryDate: "2026-10-13", sourceType: "owner_capital", lines: [L("1300", "M-Pesa", "asset", 500000, 0, "payment_method"), L("3000", "Equity", "equity", 0, 500000)] },
];
const build = (list: JEntry[]) => { const acc = new Map<string, Row>(); for (const e of list) entryRows(e, acc); return accRows(acc); };

describe("report core", () => {
  it("builds the income statement and money movement from journal entries", () => {
    const s = summarize(build(entries));
    expect(s).toMatchObject({ sales: 100000, returns: 10000, netSales: 90000, cogs: 54000, grossProfit: 36000, totalExpenses: 20000, netProfit: 16000, cashIn: 600000, cashOut: 11800, netCash: 588200, receivableChange: 18000, billsPayableChange: 20000, taxCollected: 16200 });
    expect(s.counts).toEqual({ entries: 4, invoices: 1, voids: 0, returns: 1 });
    expect(s.daily.find((d) => d.date === "2026-10-14")).toMatchObject({ sales: 90000, cogs: 54000, expenses: 20000, profit: 16000 });
  });
  it("adding chunks gives the same answer as one pass", () => {
    const merged = mergeRows(mergeRows(new Map<string, Row>(), build(entries.slice(0, 2))), build(entries.slice(2)));
    expect(summarize(accRows(merged))).toEqual(summarize(build(entries)));
  });
  it("date helpers", () => {
    expect(periodRange("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("year", "2026-10-14")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(365);
    expect(chunkRange("2026-01-01", "2026-01-31", 7)).toHaveLength(5);
    expect(halve("2026-01-01", "2026-01-07")).toEqual([{ from: "2026-01-01", to: "2026-01-03" }, { from: "2026-01-04", to: "2026-01-07" }]);
    expect(halve("2026-01-01", "2026-01-01")).toBeNull();
    expect(isDate("2026-02-30")).toBe(false);
    expect(bucketDaily([{ date: "2026-01-02", sales: 1, expenses: 0, cogs: 0, profit: 1 }, { date: "2026-01-20", sales: 2, expenses: 0, cogs: 0, profit: 2 }], "month")[0].sales).toBe(3);
  });
  it("splits money received into CASH / LIPA / BANK (net of refunds)", () => {
    const list: JEntry[] = [
      { entryDate: "2026-11-05", sourceType: "sale", lines: [L("1000", "Cash", "asset", 2000, 0), L("4000", "Sales", "revenue", 0, 2000)] },
      { entryDate: "2026-11-05", sourceType: "sale", lines: [L("1020", "Mobile", "asset", 1000, 0), L("4000", "Sales", "revenue", 0, 1000)] },
      { entryDate: "2026-11-05", sourceType: "waiter_sale", lines: [L("1010", "Bank", "asset", 2000, 0), L("4000", "Sales", "revenue", 0, 2000)] },
      { entryDate: "2026-11-05", sourceType: "sale_void", lines: [L("1000", "Cash", "asset", 0, 500), L("4000", "Sales", "revenue", 500, 0)] },
      { entryDate: "2026-11-05", sourceType: "owner_capital", lines: [L("1000", "Cash", "asset", 9000, 0), L("3000", "Equity", "equity", 0, 9000)] },
    ];
    expect(summarize(build(list)).channels).toEqual({ cash: 1500, lipa: 1000, bank: 2000, other: 0, total: 4500 });
    const custom = entryRows({ entryDate: "2026-11-05", sourceType: "sale", lines: [{ ...L("1300", "Tigo Lipa", "asset", 700, 0, "payment_method"), channel: "lipa" }, L("4000", "Sales", "revenue", 0, 700)] }, new Map());
    expect(summarize(accRows(custom)).channels.lipa).toBe(700);
  });
  it("statement: expenses come out of the profit first, then eat the capital", () => {
    const sale = (sales: number, cogs: number): JEntry => ({ entryDate: "2026-11-05", sourceType: "sale", lines: [cash(sales, 0), L("4000", "Sales", "revenue", 0, sales), L("5000", "COGS", "expense", cogs, 0), L("1200", "Inv", "asset", 0, cogs)] });
    const exp = (n: number): JEntry => ({ entryDate: "2026-11-05", sourceType: "bill", lines: [L("6100", "Rent", "expense", n, 0), L("2100", "AP", "liability", 0, n)] });
    // sales 8000 booked + 2000 owed by waiters = 10000; capital 6000 (5000 + 1000 of the unpaid goods); profit 4000
    const ok = statement(summarize(build([sale(8000, 5000), exp(3000)])), 2000, 1000);
    expect(ok).toMatchObject({ sales: 10000, debts: 2000, capital: 6000, grossProfit: 4000, expenses: 3000, profitAfter: 1000, capitalEaten: 0, capitalLeft: 6000, profitLeft: 1000 });
    // expenses 5500 > profit 4000 -> 1500 of the capital is eaten
    const bad = statement(summarize(build([sale(8000, 5000), exp(5500)])), 2000, 1000);
    expect(bad).toMatchObject({ profitAfter: -1500, capitalEaten: 1500, capitalLeft: 4500, profitLeft: 0 });
    // the capital eaten can never be more than the capital itself
    expect(statement(summarize(build([sale(1000, 800), exp(9000)])), 0, 0).capitalEaten).toBe(800);
  });
});
