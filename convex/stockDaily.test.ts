import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const eat = (ms: number) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
const DAY = 86400000;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const tenantId = await ctx.db.insert("tenants", { name: "Bar", code: "BAR", isActive: true, createdByToken: "t", createdAt: now });
    await ctx.db.insert("tenantSettings", { tenantId, traIntegrationEnabled: false, stockControlEnabled: false, defaultCurrency: "TZS" });
    const boss = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", tenantId, isActive: true });
    const productId = await ctx.db.insert("products", { tenantId, itemCode: "P1", name: "Bia", sellingPrice: 2000, openingQty: 0, currentQty: 8, weightedAvgCost: 1000, isActive: true });
    const mv = (movementDate: string, movementType: string, qtyIn: number, qtyOut: number, runningBalance: number) =>
      ctx.db.insert("stockMovements", { tenantId, movementDate, productId, movementType, qtyIn, qtyOut, runningBalance, createdBy: boss });
    const today = eat(Date.now()), yesterday = eat(Date.now() - DAY), before = eat(Date.now() - 2 * DAY);
    await mv(before, "opening", 10, 0, 10);
    await mv(yesterday, "purchase", 5, 0, 15);
    await mv(yesterday, "sale", 0, 3, 12);
    await mv(today, "waiter_order", 0, 4, 8);
    return { boss, today, yesterday, before };
  });
  return { as: t.withIdentity({ subject: ids.boss, tokenIdentifier: "x|1" }), ...ids };
}

describe("closing stock of any day", () => {
  it("yesterday shows what it opened with, what was added, what went out and what it closed with", async () => {
    const { as, yesterday } = await setup();
    const r = await as.query(api.stockDaily.closingStock, { date: yesterday });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ opening: 10, purchases: 5, sold: 3, closing: 12, value: 12000 });
  });

  it("today starts from yesterday's closing, and an older day shows only what existed then", async () => {
    const { as, today, before } = await setup();
    expect((await as.query(api.stockDaily.closingStock, { date: today })).rows[0]).toMatchObject({ opening: 12, sold: 4, closing: 8 });
    expect((await as.query(api.stockDaily.closingStock, { date: before })).rows[0]).toMatchObject({ opening: 0, purchases: 10, closing: 10 });
  });

  it("refuses a malformed date", async () => {
    const { as } = await setup();
    await expect(as.query(api.stockDaily.closingStock, { date: "13-11-2026" })).rejects.toThrow();
  });
});
