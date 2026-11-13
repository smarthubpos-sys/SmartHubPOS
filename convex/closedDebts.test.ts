import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const base = { name: "Bar", code: "BAR", currency: "TZS" } as const;
const day = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const user = (username: string, role: string, extra: object = {}) => ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true, ...extra });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const waiter = await user("juma", "waiter", { staffCode: "W01" });
    const cashier = await user("cash", "cashier");
    const accountant = await user("acc", "manager", { extraPermissions: ["accounts.reports.view"] });
    const owner = await user("owner", "super_admin");
    const group = await ctx.db.insert("productGroups", { tenantId, code: "DR", name: "Vinywaji", isActive: true });
    const bia = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Bia", groupId: group, sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    return { tenantId, boss, waiter, cashier, accountant, owner, bia };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  await as(ids.boss, 1).mutation(api.tenants.update, { tenantId: ids.tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
  const asWaiter = as(ids.waiter, 2), asCashier = as(ids.cashier, 3), asAcc = as(ids.accountant, 4), asOwner = as(ids.owner, 5);
  await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-closed-aaaa", mode: "send", lines: [{ productId: ids.bia, qty: 2 }] });
  const saveDayReport = () => asAcc.mutation(api.periodReport.save, { period: "day", startDate: day, endDate: day, scope: "all", scopeLabel: "All", title: "Day report", sections: [] });
  return { ...ids, asWaiter, asCashier, asAcc, asOwner, saveDayReport };
}

describe("Closing the day report moves unpaid waiter debts to 'Closed debts'", () => {
  it("before closing the debt is on the normal list; after closing it leaves it but is still receivable under Closed debts", async () => {
    const s = await setup();
    expect(await s.asCashier.query(api.waiterCollections.owing, {})).toEqual([expect.objectContaining({ staffId: s.waiter, total: 4000 })]);
    expect(await s.asCashier.query(api.waiterCollections.closedOwing, {})).toEqual([]);
    await s.saveDayReport();
    expect(await s.asCashier.query(api.waiterCollections.owing, {})).toEqual([]);
    // the report itself still lists the unpaid sale as the waiter's debt (it counts in total sales)
    const d = await s.asAcc.query(api.periodReport.debts, { from: day, to: day });
    expect(d.waiters).toEqual([expect.objectContaining({ name: "juma", amount: 4000 })]);
    const closed = await s.asCashier.query(api.waiterCollections.closedOwing, {});
    expect(closed).toEqual([expect.objectContaining({ staffId: s.waiter, total: 4000 })]);
    // the cashier can still receive it
    const r = await s.asCashier.mutation(api.waiterCollections.collect, { staffId: s.waiter, orderIds: closed[0].orders.map((o) => o._id), splits: [{ method: "cash", amount: 4000 }] as never });
    expect(r.total).toBe(4000);
    expect(await s.asCashier.query(api.waiterCollections.closedOwing, {})).toEqual([]);
  });

  it("deleting the day report puts its debts back on the normal list", async () => {
    const s = await setup();
    const id = await s.saveDayReport();
    expect(await s.asCashier.query(api.waiterCollections.owing, {})).toEqual([]);
    await s.asOwner.mutation(api.periodReport.deleteRun, { id });
    expect(await s.asCashier.query(api.waiterCollections.owing, {})).toEqual([expect.objectContaining({ total: 4000 })]);
    expect(await s.asCashier.query(api.waiterCollections.closedOwing, {})).toEqual([]);
  });
});
