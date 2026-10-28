import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DUKA", isActive: true, createdByToken: "t", createdAt: now });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const seller = await ctx.db.insert("users", { name: "juma", username: "juma", role: "waiter", tenantId, isActive: true, staffCode: "W01" });
    const group = await ctx.db.insert("productGroups", { tenantId, code: "EL", name: "Umeme", isActive: true });
    const shoes = await ctx.db.insert("products", { tenantId, itemCode: "S1", name: "Viatu", groupId: group, sellingPrice: 15000, openingQty: 10, currentQty: 10, isActive: true });
    return { tenantId, boss, seller, shoes };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  await as(ids.boss, 1).mutation(api.tenants.update, { tenantId: ids.tenantId, name: "Duka", code: "DUKA", currency: "TZS", waiterEnabled: true, waitressEnabled: true });
  return { t, ...ids, asSeller: as(ids.seller, 2) };
}

describe("a seller can give a price reduction on the Sales screen", () => {
  it("the discount lowers the line and the order total the cashier collects", async () => {
    const { t, asSeller, shoes } = await setup();
    const r = await asSeller.mutation(api.waiterOrders.submit, { clientKey: "key-disc-aaaaaaa", mode: "send", customerName: "Mteja / Customer", lines: [{ productId: shoes, qty: 2, discount: 1000 }] });
    const order = (await t.run(async (ctx) => ctx.db.get("waiterOrders", r.orderId)))!;
    expect(order.customerName).toBe("Mteja / Customer");
    expect(order.lines[0]).toMatchObject({ qty: 2, unitPrice: 15000, discount: 1000, lineTotal: 29000 });
    expect(order.total).toBe(29000);
    expect(order.status).toBe("pending"); // waiting in the cashier's queue
  });

  it("a discount larger than the line, or a negative one, is refused and nothing is saved", async () => {
    const { t, asSeller, shoes } = await setup();
    await expect(asSeller.mutation(api.waiterOrders.submit, { clientKey: "key-disc-bbbbbbb", mode: "send", lines: [{ productId: shoes, qty: 1, discount: 20000 }] })).rejects.toThrow(/linazidi/);
    await expect(asSeller.mutation(api.waiterOrders.submit, { clientKey: "key-disc-ccccccc", mode: "send", lines: [{ productId: shoes, qty: 1, discount: -5 }] })).rejects.toThrow(/Punguzo/);
    expect(await t.run(async (ctx) => ctx.db.query("waiterOrders").collect())).toHaveLength(0);
  });
});
