import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";
import { resolveWaiterSettings, waiterOrdersAllowedFor } from "./waiterSettings";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    const otherTenant = await ctx.db.insert("tenants", { name: "Other", code: "OTH", isActive: true, createdByToken: "t", createdAt: now });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const waiter = await ctx.db.insert("users", { name: "Juma", username: "juma", role: "waiter", tenantId, isActive: true });
    const waitress = await ctx.db.insert("users", { name: "Asha", username: "asha", role: "waitress", tenantId, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Bia", sellingPrice: 2000, openingQty: 10, currentQty: 10, isActive: true });
    return { tenantId, otherTenant, boss, waiter, waitress, productId };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asBoss: as(ids.boss, 1), asWaiter: as(ids.waiter, 2), asWaitress: as(ids.waitress, 3) };
}
const base = { name: "Bar", code: "BAR", currency: "TZS" } as const;
const order = (productId: Id<"products">) => ({ customerName: "Mteja", lines: [{ productId, qty: 1 }] });

describe("Waiter / Waitress switches (Edit Business)", () => {
  it("existing businesses with no saved settings read as OFF/OFF with the default mode", async () => {
    const { asBoss, tenantId } = await setup();
    expect(await asBoss.query(api.tenants.getEditable, { tenantId })).toMatchObject({ waiterEnabled: false, waitressEnabled: false, waiterOrderMode: "cashier" });
  });

  it("each switch changes independently and persists after reopening", async () => {
    const { asBoss, tenantId } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: false });
    expect(await asBoss.query(api.tenants.getEditable, { tenantId })).toMatchObject({ waiterEnabled: true, waitressEnabled: false });
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
    expect(await asBoss.query(api.tenants.getEditable, { tenantId })).toMatchObject({ waiterEnabled: true, waitressEnabled: true });
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: false, waitressEnabled: true });
    expect(await asBoss.query(api.tenants.getEditable, { tenantId })).toMatchObject({ waiterEnabled: false, waitressEnabled: true });
  });

  it("saving other business details without the switches does not reset them", async () => {
    const { asBoss, tenantId } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: false, waitressEnabled: true, waiterOrderMode: "print" });
    await asBoss.mutation(api.tenants.update, { tenantId, name: "Bar Mpya", code: "BAR", currency: "KES" });
    expect(await asBoss.query(api.tenants.getEditable, { tenantId })).toMatchObject({ name: "Bar Mpya", currency: "KES", waiterEnabled: false, waitressEnabled: true, waiterOrderMode: "print" });
  });

  it("the mode cannot be changed while Waiter and Waitress are both OFF, and survives until one is switched on", async () => {
    const { asBoss, tenantId } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: false, waiterOrderMode: "print" });
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: false, waitressEnabled: false, waiterOrderMode: "cashier" });
    expect(await asBoss.query(api.tenants.getEditable, { tenantId })).toMatchObject({ waiterEnabled: false, waitressEnabled: false, waiterOrdersEnabled: false, waiterOrderMode: "print" });
  });

  it("saves name, code, currency and modules with and without a tenantSettings record", async () => {
    const { t, asBoss, tenantId, otherTenant } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, name: "Bar Mpya", code: "bar2", currency: "kes", modules: ["sales"] });
    expect(await asBoss.query(api.tenants.getEditable, { tenantId })).toMatchObject({ name: "Bar Mpya", code: "BAR2", currency: "KES" });
    await t.run(async (ctx) => { await ctx.db.insert("tenantSettings", { tenantId: otherTenant, traIntegrationEnabled: false, stockControlEnabled: true, defaultCurrency: "TZS" }); });
    await asBoss.mutation(api.tenants.update, { tenantId: otherTenant, name: "Other 2", code: "OTH", currency: "usd", allModules: true });
    expect(await asBoss.query(api.tenants.getEditable, { tenantId: otherTenant })).toMatchObject({ name: "Other 2", currency: "USD", modules: null });
  });

  it("Weka Order does not deduct; Print deducts exactly once, repeat does not deduct again", async () => {
    const { t, asBoss, asWaiter, tenantId, productId } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: true, waiterOrderMode: "print" });
    const qty = async () => (await t.run(async (ctx) => ctx.db.get("products", productId)))?.currentQty;
    const id = await asWaiter.mutation(api.waiterOrders.place, { customerName: "Mteja", lines: [{ productId, qty: 3 }] });
    expect(await qty()).toBe(10);
    await asWaiter.mutation(api.waiterOrders.markPrinted, { orderId: id });
    await asWaiter.mutation(api.waiterOrders.markPrinted, { orderId: id }); // repeat is idempotent
    expect((await asWaiter.query(api.waiterOrders.list, {}))[0].status).toBe("printed");
    expect(await qty()).toBe(7);
    expect(await t.run(async (ctx) => ctx.db.query("stockMovements").collect())).toHaveLength(1);
  });

  it("a placed order is not in the cashier queue until it is sent (stock deducted once); cashier receiving it deducts nothing more", async () => {
    const { t, asBoss, asWaiter, tenantId, productId } = await setup();
    const cashierId = await t.run(async (ctx) => ctx.db.insert("users", { name: "Cash", username: "cash", role: "cashier", tenantId, isActive: true }));
    const asCashier = t.withIdentity({ subject: cashierId, tokenIdentifier: "x|9" });
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: false });
    const id = await asWaiter.mutation(api.waiterOrders.place, order(productId));
    expect(await asCashier.query(api.waiterOrders.list, {})).toEqual([]);
    expect((await asWaiter.query(api.waiterOrders.list, {})).map((o) => o.status)).toEqual(["placed"]);
    await asWaiter.mutation(api.waiterOrders.sendToCashier, { orderId: id });
    await asWaiter.mutation(api.waiterOrders.sendToCashier, { orderId: id }); // repeated Send
    expect(await t.run(async (ctx) => ctx.db.get("products", productId))).toMatchObject({ currentQty: 9 });
    expect((await asCashier.query(api.waiterOrders.list, {})).map((o) => o.status)).toEqual(["pending"]);
    await asCashier.mutation(api.waiterOrders.markHandled, { orderId: id });
    expect(await t.run(async (ctx) => ctx.db.get("products", productId))).toMatchObject({ currentQty: 9 });
    expect(await asCashier.query(api.waiterOrders.list, {})).toEqual([]); // handled order leaves pending queue
    expect((await t.run(async (ctx) => ctx.db.get("waiterOrders", id)))?.status).toBe("accepted");
    expect((await t.run(async (ctx) => ctx.db.get("products", productId)))?.currentQty).toBe(9);
    await asCashier.mutation(api.waiterOrders.markHandled, { orderId: id }); // repeat is idempotent
  });

  it("when the cashier receives (prints) an order the waiter gets a notification; nobody else does", async () => {
    const { t, asBoss, asWaiter, asWaitress, tenantId, productId } = await setup();
    const cashierId = await t.run(async (ctx) => ctx.db.insert("users", { name: "Cash", username: "cash", role: "cashier", tenantId, isActive: true }));
    const asCashier = t.withIdentity({ subject: cashierId, tokenIdentifier: "x|9" });
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
    const id = await asWaiter.mutation(api.waiterOrders.place, order(productId));
    await asWaiter.mutation(api.waiterOrders.sendToCashier, { orderId: id });
    const today = new Date().toISOString().slice(0, 10);
    expect((await asWaiter.query(api.notifications.feed, { today })).items.filter((i) => i.code === "waiter_order_received")).toHaveLength(0);
    await asCashier.mutation(api.waiterOrders.markHandled, { orderId: id });
    await asCashier.mutation(api.waiterOrders.markHandled, { orderId: id }); // retry must not create a second notification
    expect((await asWaiter.query(api.notifications.feed, { today })).items.filter((i) => i.code === "waiter_order_received")).toHaveLength(1);
    expect((await asWaitress.query(api.notifications.feed, { today })).items.filter((i) => i.code === "waiter_order_received")).toHaveLength(0);
  });

  it("Futa oda needs sales.void, restores the deducted stock once, and hides the order", async () => {
    const { t, asBoss, asWaiter, tenantId, productId } = await setup();
    const cashierId = await t.run(async (ctx) => ctx.db.insert("users", { name: "Cash", username: "cash", role: "cashier", tenantId, isActive: true }));
    const asCashier = t.withIdentity({ subject: cashierId, tokenIdentifier: "x|9" });
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
    const qty = async () => (await t.run(async (ctx) => ctx.db.get("products", productId)))?.currentQty;
    const id = await asWaiter.mutation(api.waiterOrders.place, { customerName: "M", lines: [{ productId, qty: 4 }] });
    await asWaiter.mutation(api.waiterOrders.sendToCashier, { orderId: id });
    expect(await qty()).toBe(6);
    await expect(asCashier.mutation(api.waiterOrders.cancel, { orderId: id })).rejects.toThrow();
    await expect(asWaiter.mutation(api.waiterOrders.cancel, { orderId: id })).rejects.toThrow();
    expect(await qty()).toBe(6);
    await t.run(async (ctx) => ctx.db.patch("users", cashierId, { role: "manager" }));
    await asCashier.mutation(api.waiterOrders.cancel, { orderId: id });
    await asCashier.mutation(api.waiterOrders.cancel, { orderId: id }); // second time changes nothing
    expect(await qty()).toBe(10);
    expect(await asCashier.query(api.waiterOrders.list, {})).toEqual([]);
    expect((await asWaiter.query(api.waiterOrders.list, {})).map((o) => o.status)).toEqual(["cancelled"]);
  });

  it("Weka Order refuses more than the stock on hand and leaves stock untouched", async () => {
    const { t, asBoss, asWaiter, tenantId, productId } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
    await expect(asWaiter.mutation(api.waiterOrders.place, { customerName: "M", lines: [{ productId, qty: 6 }, { productId, qty: 6 }] })).rejects.toThrow(/Stock haitoshi/);
    expect((await t.run(async (ctx) => ctx.db.get("products", productId)))?.currentQty).toBe(10);
  });

  it("a waiter cannot send or print another waiter's order", async () => {
    const { asBoss, asWaiter, asWaitress, tenantId, productId } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
    const id = await asWaiter.mutation(api.waiterOrders.place, order(productId));
    await expect(asWaitress.mutation(api.waiterOrders.sendToCashier, { orderId: id })).rejects.toThrow(/si oda yako/);
    await expect(asWaitress.mutation(api.waiterOrders.markPrinted, { orderId: id })).rejects.toThrow(/si oda yako/);
    expect(await asWaitress.query(api.waiterOrders.list, {})).toEqual([]);
  });

  it("an old client that only sends the single waiterOrdersEnabled flag still works (sets both)", async () => {
    const { asBoss, tenantId } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterOrdersEnabled: true });
    expect(await asBoss.query(api.tenants.getEditable, { tenantId })).toMatchObject({ waiterEnabled: true, waitressEnabled: true });
  });

  it("a business saved before the two switches existed keeps both roles ON when Waiter Orders was ON", async () => {
    const { t, asBoss, tenantId } = await setup();
    await t.run((ctx) => ctx.db.insert("tenantSettings", { tenantId, traIntegrationEnabled: false, stockControlEnabled: true, defaultCurrency: "TZS", waiterOrdersEnabled: true }));
    expect(await asBoss.query(api.tenants.getEditable, { tenantId })).toMatchObject({ waiterEnabled: true, waitressEnabled: true });
  });

  it("only a Super Admin can change them, and other businesses are untouched", async () => {
    const { asWaiter, asBoss, tenantId, otherTenant } = await setup();
    await expect(asWaiter.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: true })).rejects.toThrow(/Super Admin/);
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: true });
    expect(await asBoss.query(api.tenants.getEditable, { tenantId: otherTenant })).toMatchObject({ waiterEnabled: false, waitressEnabled: false });
  });

  it("the Waiter role and the Waitress role follow their own switch on the server", async () => {
    const { asBoss, asWaiter, asWaitress, tenantId, productId } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: true, waitressEnabled: false });
    await asWaiter.mutation(api.waiterOrders.place, order(productId));
    await expect(asWaitress.mutation(api.waiterOrders.place, order(productId))).rejects.toThrow(/imezimwa/);
    expect(await asWaitress.query(api.waiterOrders.list, {})).toEqual([]);
    expect(await asWaiter.query(api.waiterOrders.list, {})).toHaveLength(1);

    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: false, waitressEnabled: true });
    await asWaitress.mutation(api.waiterOrders.place, order(productId));
    await expect(asWaiter.mutation(api.waiterOrders.place, order(productId))).rejects.toThrow(/imezimwa/);
  });

  it("tenants.current exposes both flags to the Waiter Orders page", async () => {
    const { asBoss, asWaiter, tenantId } = await setup();
    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: false, waitressEnabled: true });
    expect(await asWaiter.query(api.tenants.current, {})).toMatchObject({ waiterEnabled: false, waitressEnabled: true, waiterOrdersEnabled: true });
  });
});

describe("resolveWaiterSettings", () => {
  it("handles missing settings, legacy settings and explicit values", () => {
    expect(resolveWaiterSettings(null)).toEqual({ waiterEnabled: false, waitressEnabled: false, waiterOrdersEnabled: false, waiterOrderMode: "cashier" });
    expect(resolveWaiterSettings({ waiterOrdersEnabled: true })).toMatchObject({ waiterEnabled: true, waitressEnabled: true });
    expect(resolveWaiterSettings({ waiterOrdersEnabled: true, waiterEnabled: false })).toMatchObject({ waiterEnabled: false, waitressEnabled: true });
    expect(waiterOrdersAllowedFor("cashier", { waitressEnabled: true })).toBe(true);
    expect(waiterOrdersAllowedFor("cashier", {})).toBe(false);
  });
});
