import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

const base = { name: "Bar", code: "BAR", currency: "TZS" } as const;
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: ago(0) });
    const user = (username: string, role: string, extra: object = {}) => ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true, ...extra });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const waiter = await user("juma", "waiter", { staffCode: "W01" });
    const manager = await user("mgr", "manager");
    const trusted = await user("trusted", "cashier", { extraPermissions: ["bills.clear_old"] });
    const group = await ctx.db.insert("productGroups", { tenantId, code: "DR", name: "Vinywaji", isActive: true });
    const bia = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Bia", groupId: group, sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    const order = (createdAt: string) => ctx.db.insert("waiterOrders", {
      tenantId, customerName: "", tableNumber: "3", waiterId: waiter, waiterName: "juma", status: "pending", billSentAt: createdAt,
      lines: [{ productId: bia, productName: "Bia", qty: 1, unitPrice: 2000, lineTotal: 2000 }], total: 2000, createdAt, updatedAt: createdAt,
    });
    return { tenantId, boss, waiter, manager, trusted, old: await order(ago(20)), fresh: await order(ago(0)) };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  await as(ids.boss, 1).mutation(api.tenants.update, { tenantId: ids.tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
  return { t, ...ids, asManager: as(ids.manager, 2), asTrusted: as(ids.trusted, 3), asWaiter: as(ids.waiter, 4) };
}

describe("removing old unused bills from the Bills list", () => {
  it("only a person who was given the permission can do it; a manager or waiter cannot", async () => {
    const { asManager, asWaiter, asTrusted, old } = await setup();
    await expect(asManager.mutation(api.waiterOrders.clearOldBills, { orderIds: [old] })).rejects.toThrow(/bills.clear_old/);
    await expect(asWaiter.mutation(api.waiterOrders.clearOldBills, { orderIds: [old] })).rejects.toThrow(/bills.clear_old/);
    expect(await asTrusted.mutation(api.waiterOrders.clearOldBills, { orderIds: [old] })).toEqual({ removed: 1 });
  });

  it("the bill leaves the list, but the order, its total and history stay", async () => {
    const { t, asTrusted, old, fresh } = await setup();
    expect((await asTrusted.query(api.waiterOrders.listForBills, {})).map((o) => o._id).sort()).toEqual([old, fresh].sort());
    await asTrusted.mutation(api.waiterOrders.clearOldBills, { orderIds: [old] });
    expect((await asTrusted.query(api.waiterOrders.listForBills, {})).map((o) => o._id)).toEqual([fresh]);
    expect((await asTrusted.query(api.waiterOrders.listForBills, { includePrinted: true })).map((o) => o._id)).toContain(old);
    const row = await t.run((ctx) => ctx.db.get("waiterOrders", old));
    expect(row).toMatchObject({ status: "pending", total: 2000 });
    expect(row?.billHiddenAt).toBeTruthy();
  });

  it("a bill of the last 2 days can never be removed, and nothing is removed when one pick is refused", async () => {
    const { t, asTrusted, old, fresh } = await setup();
    await expect(asTrusted.mutation(api.waiterOrders.clearOldBills, { orderIds: [old, fresh] })).rejects.toThrow(/siku chini ya 2/);
    expect((await t.run((ctx) => ctx.db.get("waiterOrders", old)))?.billHiddenAt).toBeUndefined();
    await expect(asTrusted.mutation(api.waiterOrders.clearOldBills, { orderIds: [] })).rejects.toThrow(/angalau/);
  });
});
