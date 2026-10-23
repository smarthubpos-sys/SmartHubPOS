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
    const tenantA = await ctx.db.insert("tenants", { name: "A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const tenantB = await ctx.db.insert("tenants", { name: "B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const mgrA = await ctx.db.insert("users", { name: "MgrA", username: "mgra", role: "manager", tenantId: tenantA, isActive: true, extraPermissions: ["stock.adjust"] });
    const mgrB = await ctx.db.insert("users", { name: "MgrB", username: "mgrb", role: "manager", tenantId: tenantB, isActive: true, extraPermissions: ["stock.adjust"] });
    const waiter = await ctx.db.insert("users", { name: "W", username: "w", role: "waiter", tenantId: tenantA, isActive: true });
    return { tenantA, tenantB, mgrA, mgrB, waiter };
  });
  const as = (id: Id<"users">, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { t, ...ids, asA: as(ids.mgrA, 1), asB: as(ids.mgrB, 2), asWaiter: as(ids.waiter, 3) };
}
const run = (as: Awaited<ReturnType<typeof setup>>["asA"], rows: { name: string; itemCode?: string; barcode?: string; sellingPrice?: number; quantity?: number; buyingPrice?: number }[], opts: { dryRun?: boolean; updateExisting?: boolean } = {}) =>
  as.mutation(api.products.importBatch, { rows, dryRun: opts.dryRun ?? false, updateExisting: opts.updateExisting ?? true });

describe("Excel product import (regression)", () => {
  it("a new product needs a selling price - it is reported, not saved at price 0", async () => {
    const { asA } = await setup();
    const dry = await run(asA, [{ name: "Bila bei" }, { name: "Na bei", sellingPrice: 100 }], { dryRun: true });
    expect(dry.results.map((r) => r.status)).toEqual(["error", "new"]);
    expect(dry.results[0].message).toMatch(/Bei ya kuuzia/);
    const real = await run(asA, [{ name: "Bila bei" }, { name: "Na bei", sellingPrice: 100 }]);
    expect([real.created, real.errors]).toEqual([1, 1]);
    expect((await asA.query(api.products.list, {})).map((p) => p.name)).toEqual(["Na bei"]);
  });

  it("an existing product may be updated without resending a price", async () => {
    const { asA } = await setup();
    await run(asA, [{ name: "Sukari", itemCode: "S1", sellingPrice: 100 }]);
    const again = await run(asA, [{ name: "Sukari", itemCode: "S1", barcode: "999" }]);
    expect(again.results[0].status).toBe("update");
  });

  it("repeating the same import does not create duplicates (code or name)", async () => {
    const { asA } = await setup();
    const rows = [{ name: "Sukari", itemCode: "S1", sellingPrice: 100, quantity: 5, buyingPrice: 60 }, { name: "Chai", sellingPrice: 50 }];
    const first = await run(asA, rows);
    expect(first.created).toBe(2);
    const second = await run(asA, rows);
    expect([second.created, second.updated]).toEqual([0, 2]);
    expect(await asA.query(api.products.list, {})).toHaveLength(2);
    expect((await asA.query(api.products.list, {})).find((p) => p.itemCode === "S1")!.currentQty).toBe(5); // quantity not doubled
    const third = await run(asA, rows, { updateExisting: false });
    expect([third.created, third.errors]).toEqual([0, 2]);
    expect(await asA.query(api.products.list, {})).toHaveLength(2);
  });

  it("a new item code with the name of an existing product is refused instead of creating a duplicate name", async () => {
    const { asA } = await setup();
    await run(asA, [{ name: "Sukari", itemCode: "S1", sellingPrice: 100 }]);
    for (const dryRun of [true, false]) {
      const res = await run(asA, [{ name: "sukari", itemCode: "S2", sellingPrice: 100 }], { dryRun });
      expect(res.results[0]).toMatchObject({ status: "error" });
      expect(res.results[0].message).toMatch(/S1/);
    }
    expect(await asA.query(api.products.list, {})).toHaveLength(1);
  });

  it("repeats inside one batch are reported", async () => {
    const { asA } = await setup();
    const res = await run(asA, [{ name: "Maji", sellingPrice: 1 }, { name: "MAJI", sellingPrice: 1 }]);
    expect(res.results.map((r) => r.status)).toEqual(["new", "error"]);
  });

  it("is scoped to the signed-in business: the same names/codes in another business are independent", async () => {
    const { asA, asB, tenantA, tenantB, t } = await setup();
    await run(asA, [{ name: "Sukari", itemCode: "S1", barcode: "111", sellingPrice: 100 }]);
    const b = await run(asB, [{ name: "Sukari", itemCode: "S1", barcode: "111", sellingPrice: 200 }]);
    expect([b.created, b.errors]).toEqual([1, 0]); // not treated as "already exists"
    const owners = await t.run(async (ctx) => (await ctx.db.query("products").collect()).map((p) => [p.tenantId, p.sellingPrice]));
    expect(owners).toEqual(expect.arrayContaining([[tenantA, 100], [tenantB, 200]]));
    // B updating "S1" must not touch A's product
    await run(asB, [{ name: "Sukari", itemCode: "S1", sellingPrice: 999 }]);
    expect((await asA.query(api.products.list, {})).find((p) => p.itemCode === "S1")!.sellingPrice).toBe(100);
  });

  it("people without stock rights cannot import, and invalid numbers are reported per row", async () => {
    const { asWaiter, asA } = await setup();
    await expect(run(asWaiter, [{ name: "X", sellingPrice: 1 }])).rejects.toThrow();
    const res = await run(asA, [{ name: "Hasi", sellingPrice: -1 }, { name: "Nan", sellingPrice: Number.NaN }, { name: "Sawa", sellingPrice: 1 }], { dryRun: true });
    expect(res.results.map((r) => r.status)).toEqual(["error", "error", "new"]);
  });

  it("a dry run never writes anything", async () => {
    const { asA, t } = await setup();
    await run(asA, [{ name: "Maji", group: undefined, sellingPrice: 1, quantity: 5, buyingPrice: 1 } as never], { dryRun: true });
    expect(await t.run(async (ctx) => (await ctx.db.query("products").collect()).length + (await ctx.db.query("stockMovements").collect()).length)).toBe(0);
  });
});
