import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const base = { name: "Bar", code: "BAR", currency: "TZS" } as const;
const day = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const dayBefore = (n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

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
    const group = await ctx.db.insert("productGroups", { tenantId, code: "DR", name: "Vinywaji", isActive: true });
    const bia = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Bia", groupId: group, sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    return { tenantId, boss, waiter, cashier, accountant, bia };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  await as(ids.boss, 1).mutation(api.tenants.update, { tenantId: ids.tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
  const asWaiter = as(ids.waiter, 2), asCashier = as(ids.cashier, 3), asAcc = as(ids.accountant, 4);
  await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "key-hist-aaaaa", mode: "send", lines: [{ productId: ids.bia, qty: 2 }] });
  const report = (date: string, extra: object = {}) => ({ period: "day", startDate: date, endDate: date, scope: "all", scopeLabel: "All", title: `Day ${date}`, sections: [], ...extra });
  return { ...ids, asWaiter, asCashier, asAcc, report };
}

describe("generated reports are lined up in the history, by date", () => {
  it("generating records the report without closing the day, once per date, newest date first", async () => {
    const s = await setup();
    await s.asAcc.mutation(api.periodReport.save, s.report(dayBefore(2), { closeDay: false }));
    await s.asAcc.mutation(api.periodReport.save, s.report(day, { closeDay: false }));
    await s.asAcc.mutation(api.periodReport.save, s.report(dayBefore(1), { closeDay: false }));
    await s.asAcc.mutation(api.periodReport.save, s.report(day, { closeDay: false })); // generated again: same line, not a second one
    const h = await s.asAcc.query(api.periodReport.history, {});
    expect(h.map((r) => r.startDate)).toEqual([day, dayBefore(1), dayBefore(2)]);
    expect(h.every((r) => r.draft)).toBe(true);
    // the waiter's unpaid bill is still on the cashier's normal list: nothing was closed
    expect(await s.asCashier.query(api.waiterCollections.owing, {})).toEqual([expect.objectContaining({ staffId: s.waiter, total: 4000 })]);
    expect(await s.asCashier.query(api.waiterCollections.closedOwing, {})).toEqual([]);
  });

  it("the explicit save closes the day and marks the same line as saved; a later plain generate does not rewrite it", async () => {
    const s = await setup();
    await s.asAcc.mutation(api.periodReport.save, s.report(day, { closeDay: false }));
    await s.asAcc.mutation(api.periodReport.save, s.report(day)); // "Historia ya mfumo (funga siku)"
    let h = await s.asAcc.query(api.periodReport.history, {});
    expect(h).toHaveLength(1);
    expect(h[0].draft).toBe(false);
    expect(await s.asCashier.query(api.waiterCollections.owing, {})).toEqual([]);
    expect(await s.asCashier.query(api.waiterCollections.closedOwing, {})).toEqual([expect.objectContaining({ total: 4000 })]);
    await s.asAcc.mutation(api.periodReport.save, s.report(day, { closeDay: false, title: "changed" }));
    h = await s.asAcc.query(api.periodReport.history, {});
    expect(h).toHaveLength(1);
    expect(h[0].title).toBe(`Day ${day}`); // the saved report stayed as it was
    expect(h[0].draft).toBe(false);
  });
});
