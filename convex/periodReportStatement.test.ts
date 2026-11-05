import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";
import { statement, summarize, sumSections } from "./reportCore";

const DAY = "2026-11-05";
const NOW = `${DAY}T08:00:00.000Z`; // 11:00 East Africa Time, the same business day

/** One business, one admin; a sale paid in CASH 2000 + LIPA 1000 + BANK 2000, two expenses, two waiters who owe, one customer on credit. */
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const T = await ctx.db.insert("tenants", { name: "Hotel", code: "H", isActive: true, createdByToken: "t", createdAt: NOW });
    const admin = await ctx.db.insert("users", { name: "Admin", username: "admin", role: "admin", tenantId: T, isActive: true });
    const waiterA = await ctx.db.insert("users", { name: "Asha", username: "asha", role: "waitress", tenantId: T, isActive: true });
    const waiterB = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "waiter", tenantId: T, isActive: true });
    const acc = (code: string, name: string, type: string, subtype?: string) => ctx.db.insert("accounts", { tenantId: T, code, name, type, subtype, balance: 0, isActive: true, isSystem: false });
    const cash = await acc("1000", "Cash", "asset"), bank = await acc("1010", "Bank", "asset"), lipa = await acc("1020", "Mobile money", "asset");
    const sales = await acc("4000", "Sales revenue", "revenue"), cogs = await acc("5000", "Cost of goods sold", "expense"), inv = await acc("1200", "Inventory", "asset");
    const rent = await acc("6100", "Rent", "expense"), transport = await acc("6200", "Transport", "expense"), ap = await acc("2100", "Bills payable", "liability");
    const entry = async (ref: string, description: string, sourceType: string, lines: Array<[Id<"accounts">, number, number]>) => {
      const id = await ctx.db.insert("journalEntries", { tenantId: T, entryDate: DAY, reference: ref, description, status: "posted", sourceType, totalDebit: 0, totalCredit: 0, createdBy: admin });
      for (const [accountId, debit, credit] of lines) await ctx.db.insert("journalLines", { tenantId: T, entryId: id, accountId, debit, credit });
    };
    await entry("S1", "Sale 1", "sale", [[cash, 2000, 0], [lipa, 1000, 0], [bank, 2000, 0], [sales, 0, 5000], [cogs, 3000, 0], [inv, 0, 3000]]);
    await entry("B1", "Bill BILL-0001: Landlord", "bill", [[rent, 1500, 0], [ap, 0, 1500]]);
    await entry("B2", "Bill BILL-0002: Boda", "bill", [[transport, 500, 0], [ap, 0, 500]]);
    const client = await ctx.db.insert("clients", { tenantId: T, code: "C1", name: "Mteja Mkopo", openingBalance: 0, creditPolicy: "allow", isActive: true });
    await ctx.db.insert("invoices", { tenantId: T, invoiceNo: "INV-1", invoiceDate: DAY, clientId: client, subtotal: 400, discount: 0, taxAmount: 0, total: 400, amountPaid: 0, outstanding: 400, paymentStatus: "unpaid", status: "posted", createdBy: admin });
    const product = await ctx.db.insert("products", { tenantId: T, itemCode: "P1", name: "Soda", sellingPrice: 1000, openingQty: 0, currentQty: 0, isActive: true });
    const order = async (waiterId: Id<"users">, waiterName: string, total: number, paid: number, createdAt: string, extra: Record<string, unknown> = {}) => {
      const id = await ctx.db.insert("waiterOrders", { tenantId: T, customerName: "x", waiterId, waiterName, status: "pending", paidAmount: paid, lines: [], total, createdAt, updatedAt: createdAt, ...extra } as never);
      await ctx.db.insert("stockMovements", { tenantId: T, movementDate: DAY, productId: product, movementType: "sale", referenceType: "waiterOrder", referenceId: String(id), qtyIn: 0, qtyOut: 1, runningBalance: 0, unitCost: total / 2, createdBy: admin });
    };
    await order(waiterA, "Asha", 1000, 0, NOW);                                   // owes 1000, cost 500
    await order(waiterA, "Asha", 1000, 600, NOW);                                 // owes 400, cost 200
    await order(waiterB, "Juma", 800, 0, NOW);                                    // owes 800, cost 400
    await order(waiterB, "Juma", 999, 0, NOW, { settledAt: NOW });                // settled: not a debt
    await order(waiterB, "Juma", 999, 0, NOW, { cancelledAt: NOW });              // cancelled: not a debt
    await order(waiterB, "Juma", 700, 0, "2026-11-04T08:00:00.000Z");            // another day: not in this report
    return { admin };
  });
  return { t, as: t.withIdentity({ subject: ids.admin, tokenIdentifier: "x|1" }) };
}

describe("simple day report: sales, expenses in detail, debts by name, CASH / LIPA / BANK", () => {
  it("builds every figure of the report from the books", async () => {
    const { as } = await setup();
    const chunk = await as.query(api.periodReport.chunk, { from: DAY, to: DAY });
    const debts = await as.query(api.periodReport.debts, { from: DAY, to: DAY });

    // expenses exactly as entered (cost of goods is not one of them)
    const items = chunk.sections.flatMap((s) => s.items).sort((a, b) => b.a - a.a);
    expect(items.map((i) => [i.t, i.c, i.a])).toEqual([["Bill BILL-0001: Landlord", "Rent", 1500], ["Bill BILL-0002: Boda", "Transport", 500]]);

    // waiters who still owe, by name, with the number of orders (paid part already taken off)
    expect(debts.waiters.map((w) => [w.name, w.orders, w.amount, w.cost]).sort()).toEqual([["Asha", 2, 1400, 700], ["Juma", 1, 800, 400]]);
    expect(debts.customers.map((c) => [c.name, c.orders, c.amount])).toEqual([["Mteja Mkopo", 1, 400]]);

    const s = summarize(sumSections(chunk.sections.map((x) => x.rows)));
    expect(s.channels).toEqual({ cash: 2000, lipa: 1000, bank: 2000, other: 0, total: 5000 });
    const w = debts.waiters, st = statement(s, w.reduce((n, d) => n + d.amount, 0), w.reduce((n, d) => n + d.cost, 0), 400);
    // booked 5000 + waiters 2200 = 7200 sales; capital 3000 + 1100 = 4100; profit 3100; expenses 2000 -> 1100 left, no capital eaten
    expect(st).toMatchObject({ sales: 7200, debts: 2600, capital: 4100, grossProfit: 3100, expenses: 2000, profitAfter: 1100, capitalEaten: 0 });
  });

  it("is empty and harmless on a day with no activity", async () => {
    const { as } = await setup();
    const chunk = await as.query(api.periodReport.chunk, { from: "2026-10-01", to: "2026-10-01" });
    const debts = await as.query(api.periodReport.debts, { from: "2026-10-01", to: "2026-10-01" });
    expect(chunk.sections).toEqual([]);
    expect(debts).toEqual({ waiters: [], customers: [], truncated: false });
  });
});
