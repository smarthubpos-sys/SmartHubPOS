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
    await asWaiter.mutation(api.waiterOrders.send, order(productId));
    await expect(asWaitress.mutation(api.waiterOrders.send, order(productId))).rejects.toThrow(/imezimwa/);
    expect(await asWaitress.query(api.waiterOrders.list, {})).toEqual([]);
    expect(await asWaiter.query(api.waiterOrders.list, {})).toHaveLength(1);

    await asBoss.mutation(api.tenants.update, { tenantId, ...base, waiterEnabled: false, waitressEnabled: true });
    await asWaitress.mutation(api.waiterOrders.send, order(productId));
    await expect(asWaiter.mutation(api.waiterOrders.send, order(productId))).rejects.toThrow(/imezimwa/);
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
