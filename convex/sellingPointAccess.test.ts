import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";
import { waiterOrdersAllowedFor } from "./waiterSettings";

const base = { name: "Bar", code: "BAR", currency: "TZS" } as const;

/** Two businesses; the first has two departments. Waiter switches are ON unless a test turns them off. */
async function setup(switches = true) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const other = await ctx.db.insert("tenants", { name: "Other", code: "OTH", isActive: true, createdByToken: "t", createdAt: now });
    const brA = await ctx.db.insert("branches", { tenantId, name: "Bar", code: "BR", isActive: true, createdAt: now });
    const brB = await ctx.db.insert("branches", { tenantId, name: "Jikoni", code: "JK", isActive: true, createdAt: now });
    const user = (tid: Id<"tenants">, username: string, role: string, extra: object = {}) =>
      ctx.db.insert("users", { name: username, username, role, tenantId: tid, isActive: true, ...extra });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    // a Super Admin who is "inside" the business (picked it), with an odd role label from older data
    const bossInside = await user(tenantId, "boss2", "Super Admin", { branchId: brA });
    const waiter = await user(tenantId, "juma", "waiter", { branchId: brA });
    const waiterB = await user(tenantId, "neema", "waitress", { branchId: brB });
    const waiterOtherBiz = await user(other, "w-other", "waiter");
    const cashier = await user(tenantId, "cash", "cashier", { branchId: brA });
    const cashierB = await user(tenantId, "cashb", "cashier", { branchId: brB });
    const messyWaitress = await user(tenantId, "messy", " Waitress ", { branchId: brA }); // label with spaces / capital letter
    const nobody = await user(tenantId, "nobody", "no_such_role", { branchId: brA }); // role with no permissions at all
    const adminOther = await user(other, "admin2", "admin");
    const group = await ctx.db.insert("productGroups", { tenantId, code: "DR", name: "Vinywaji", isActive: true });
    const bia = await ctx.db.insert("products", { tenantId, branchId: brA, itemCode: "P1", name: "Bia", groupId: group, sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    return { tenantId, other, boss, bossInside, waiter, waiterB, waiterOtherBiz, cashier, cashierB, messyWaitress, nobody, adminOther, bia };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  const asBoss = as(ids.boss, 1);
  if (switches) await asBoss.mutation(api.tenants.update, { tenantId: ids.tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
  const qty = async () => (await t.run(async (ctx) => ctx.db.get("products", ids.bia)))?.currentQty;
  return { t, ...ids, asBoss, as, qty };
}

describe("Selling Point access: Super Admin", () => {
  it("a Super Admin inside a business uses Selling Point even when the Waiter/Waitress switches are OFF and no role grants it", async () => {
    const { as, bossInside, waiter, bia, qty, asBoss, tenantId } = await setup(false);
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: false, waitressEnabled: false });
    const asSuper = as(bossInside, 10);
    // ordinary waiter is refused while the switch is off ...
    await expect(as(waiter, 11).mutation(api.waiterOrders.submit, { clientKey: "sa-w-1-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 1 }] })).rejects.toThrow(/imezimwa/);
    expect(await qty()).toBe(10);
    // ... the Super Admin (label "Super Admin") is not
    const r = await asSuper.mutation(api.waiterOrders.submit, { clientKey: "sa-s-1-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 2 }] });
    expect(r.duplicate).toBe(false);
    expect(await qty()).toBe(8);
    expect(await asSuper.query(api.waiterOrders.listForBills, {})).toHaveLength(1);
    expect((await asSuper.query(api.waiterOrders.list, {})).length).toBe(1);
  });

  it("the switch rule itself: Super Admin labels pass, other roles keep following their switch", () => {
    for (const r of ["super_admin", "superadmin", "Super Admin", "super-admin"]) expect(waiterOrdersAllowedFor(r, {}), r).toBe(true);
    expect(waiterOrdersAllowedFor("admin", {})).toBe(false);
    expect(waiterOrdersAllowedFor("cashier", {})).toBe(false);
    expect(waiterOrdersAllowedFor("Waiter ", { waiterEnabled: true, waitressEnabled: false })).toBe(true);
    expect(waiterOrdersAllowedFor(" WAITRESS", { waiterEnabled: true, waitressEnabled: false })).toBe(false);
  });
});

describe("Selling Point access: waiter / waitress and ordinary users", () => {
  it("a waiter with waiterOrders.view sees Selling Point data and only HIS orders; the cashier sees a bill only after the waiter sent it", async () => {
    const { as, waiter, cashier, bia } = await setup();
    const asWaiter = as(waiter, 20);
    await asWaiter.mutation(api.waiterOrders.submit, { clientKey: "w-1-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 1 }] });
    expect(await asWaiter.query(api.waiterOrders.listForBills, {})).toHaveLength(1);
    expect(await as(cashier, 21).query(api.waiterOrders.listForBills, {})).toHaveLength(0); // the waiter's bill stays his own until he sends it
    const mine = await asWaiter.query(api.waiterOrders.listForBills, {});
    await asWaiter.mutation(api.waiterOrders.sendBillToCashier, { orderIds: [mine[0]._id] });
    expect(await as(cashier, 21).query(api.waiterOrders.listForBills, {})).toHaveLength(1);
  });

  it("a user whose role has no waiterOrders.view is refused, and so is an anonymous caller", async () => {
    const { t, as, nobody } = await setup();
    await expect(as(nobody, 22).query(api.waiterOrders.listForBills, {})).rejects.toThrow(/waiterOrders\.view/);
    await expect(as(nobody, 22).query(api.waiterOrders.list, {})).rejects.toThrow();
    await expect(t.query(api.waiterOrders.listForBills, {})).rejects.toThrow(/Unauthenticated/);
  });

  it("a role label with spaces/capitals ('  Waitress ') is still treated as a waitress: own orders only, cannot receive orders", async () => {
    const { as, waiter, messyWaitress, cashier, bia } = await setup();
    const sent = await as(waiter, 23).mutation(api.waiterOrders.submit, { clientKey: "m-1-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 1 }] });
    const asMessy = as(messyWaitress, 24);
    expect(await asMessy.query(api.waiterOrders.listForBills, {})).toHaveLength(0); // not the department's orders
    expect(await asMessy.query(api.waiterOrders.list, {})).toHaveLength(0);
    await expect(asMessy.mutation(api.waiterOrders.markHandled, { orderId: sent.orderId })).rejects.toThrow(/Cashier pekee/);
    await as(cashier, 25).mutation(api.waiterOrders.markHandled, { orderId: sent.orderId }); // the real cashier still can
  });

  it("tenant and department isolation: other business and other department never see these orders", async () => {
    const { as, waiter, waiterOtherBiz, cashierB, adminOther, bia } = await setup();
    const o = await as(waiter, 26).mutation(api.waiterOrders.submit, { clientKey: "iso-1-abcdefgh", mode: "send", lines: [{ productId: bia, qty: 1 }] });
    expect(await as(cashierB, 27).query(api.waiterOrders.listForBills, {})).toHaveLength(0); // other department of the same business
    expect(await as(waiterOtherBiz, 28).query(api.waiterOrders.listForBills, {})).toHaveLength(0); // other business
    await expect(as(adminOther, 29).query(api.waiterOrders.billSummary, { orderIds: [o.orderId] })).rejects.toThrow();
  });
});

describe("setStaffCode: authorization, validation, isolation", () => {
  it("only someone with maintenance.users may set it: waiter, cashier and anonymous are refused", async () => {
    const { t, as, waiter, cashier, waiterB } = await setup();
    await expect(as(waiter, 30).mutation(api.maintenance.setStaffCode, { userId: waiterB, staffCode: "AB1" })).rejects.toThrow();
    await expect(as(cashier, 31).mutation(api.maintenance.setStaffCode, { userId: waiterB, staffCode: "AB1" })).rejects.toThrow();
    await expect(t.mutation(api.maintenance.setStaffCode, { userId: waiterB, staffCode: "AB1" })).rejects.toThrow(/Unauthenticated/);
    expect((await t.run(async (ctx) => ctx.db.get("users", waiterB)))?.staffCode).toBeUndefined();
  });

  it("an administrator of ANOTHER business cannot touch this business's users", async () => {
    const { as, adminOther, waiter, t } = await setup();
    await expect(as(adminOther, 32).mutation(api.maintenance.setStaffCode, { userId: waiter, staffCode: "ZZ9" })).rejects.toThrow(/hapatikani/);
    expect((await t.run(async (ctx) => ctx.db.get("users", waiter)))?.staffCode).toBeUndefined();
  });

  it("saves trimmed + upper-cased, keeps every other field of the user, can be cleared", async () => {
    const { asBoss, waiter, t } = await setup();
    const before = await t.run(async (ctx) => ctx.db.get("users", waiter));
    await asBoss.mutation(api.maintenance.setStaffCode, { userId: waiter, staffCode: "  jm-01 " });
    const after = await t.run(async (ctx) => ctx.db.get("users", waiter));
    expect(after?.staffCode).toBe("JM-01");
    expect({ ...after, staffCode: undefined }).toEqual({ ...before, staffCode: undefined });
    await asBoss.mutation(api.maintenance.setStaffCode, { userId: waiter, staffCode: "" });
    expect((await t.run(async (ctx) => ctx.db.get("users", waiter)))?.staffCode).toBeUndefined();
  });

  it("refuses bad codes and duplicates, and the REAL reason reaches the screen (ConvexError, not a hidden 'Server Error')", async () => {
    const { asBoss, waiter, waiterB } = await setup();
    await asBoss.mutation(api.maintenance.setStaffCode, { userId: waiter, staffCode: "W01" });
    const reasons: Array<[string, RegExp]> = [["bad code", /Staff code/], ["A", /Staff code/], ["X".repeat(21), /Staff code/], ["w01", /inatumika/]];
    for (const [code, re] of reasons) {
      const err = await asBoss.mutation(api.maintenance.setStaffCode, { userId: waiterB, staffCode: code }).then(() => null, (e: unknown) => e);
      expect(err, code).toBeInstanceOf(ConvexError);
      expect(String((err as ConvexError<string>).data), code).toMatch(re);
    }
  });
});
