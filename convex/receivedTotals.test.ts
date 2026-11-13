import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    await ctx.db.insert("tenantSettings", { tenantId, traIntegrationEnabled: false, stockControlEnabled: false, defaultCurrency: "TZS", waiterEnabled: true, waitressEnabled: true, waiterOrdersEnabled: true, waiterOrderMode: "cashier" });
    const waiter = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "waiter", tenantId, isActive: true });
    const cashier = await ctx.db.insert("users", { name: "Neema", username: "neema", role: "cashier", tenantId, isActive: true });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", tenantId, isActive: true });
    const clientId = await ctx.db.insert("clients", { tenantId, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Bia", sellingPrice: 2000, openingQty: 100, currentQty: 100, weightedAvgCost: 1200, isActive: true });
    return { waiter, cashier, boss, clientId, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { ...ids, asWaiter: as(ids.waiter, 1), asCashier: as(ids.cashier, 2), asBoss: as(ids.boss, 4) };
}
type S = Awaited<ReturnType<typeof setup>>;

/** The same "money received" total as every screen shows it: Sales report card, day-end summary, Daily report (CASH + LIPA + BANK + other), Dashboard. */
async function received(s: S) {
  const d = today();
  const reg = await s.asBoss.query(api.sales.salesRegisters, {});
  const byMethod = reg.payments.reduce((n, p) => n + p.amount, 0) + reg.spByMethod.reduce((n, p) => n + p.amount, 0);
  const ch = await s.asBoss.query(api.periodReport.chunk, { from: d, to: d, scope: "all" });
  const daily = ch.sections.flatMap((x) => x.rows).filter((r) => r.g === "chan").reduce((n, r) => n + r.a, 0);
  const dash = (await s.asBoss.query(api.dashboard.getMetrics, { date: d })).todayCash;
  return { card: reg.totals.received, byMethod, daily, dash };
}

describe("money received (cash + mobile + bank) is the same number on every screen", () => {
  it("the Sales report card includes the money cashiers received from waiters, per method", async () => {
    const s = await setup();
    const phone = await s.asBoss.mutation(api.paymentMethods.upsert, { name: "M-Pesa", kind: "mobile", isActive: true });
    const bank = await s.asBoss.mutation(api.paymentMethods.upsert, { name: "CRDB", kind: "bank", isActive: true });
    const o = await s.asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-11111111", mode: "send", lines: [{ productId: s.productId, qty: 5 }] }); // 10,000
    await s.asCashier.mutation(api.waiterCollections.collect, { staffId: s.waiter, orderIds: [o.orderId], splits: [{ method: "cash", amount: 4000 }, { method: "x", methodId: phone, amount: 3000 }, { method: "x", methodId: bank, amount: 3000 }] });
    await s.asBoss.mutation(api.sales.createInvoice, { clientId: s.clientId, invoiceDate: today(), lines: [{ productId: s.productId, qty: 5, unitPrice: 2000 }], paymentAmount: 5000, paymentMethod: "x", paymentMethodId: phone });
    const r = await received(s);
    expect(r).toEqual({ card: 15000, byMethod: 15000, daily: 15000, dash: 15000 });
  });

  it("a paid invoice corrected downwards: the refund is taken out of the Daily report's received total too", async () => {
    const s = await setup();
    const inv = await s.asBoss.mutation(api.sales.createInvoice, { clientId: s.clientId, invoiceDate: today(), lines: [{ productId: s.productId, qty: 5, unitPrice: 2000 }], paymentAmount: 10000, paymentMethod: "cash" });
    await s.asBoss.mutation(api.sales.editInvoice, { invoiceId: inv.invoiceId, reason: "kupunguza", lines: [{ productId: s.productId, qty: 2, unitPrice: 2000 }], refundMethod: "cash" });
    const r = await received(s);
    expect(r).toEqual({ card: 4000, byMethod: 4000, daily: 4000, dash: 4000 }); // used to be: Daily report 10,000 (refund of 6,000 missing)
  });
});
