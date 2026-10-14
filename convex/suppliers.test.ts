import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const base = { openingBalance: 0, isActive: true };

async function business(t: ReturnType<typeof convexTest>, code: string) {
  return await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: code, code, isActive: true, createdByToken: "t", createdAt: new Date().toISOString() });
    const userId = await ctx.db.insert("users", { name: `Mgr ${code}`, username: `mgr-${code}`, role: "manager", tenantId, isActive: true });
    return { tenantId, userId };
  });
}

describe("suppliers", () => {
  it("the same supplier code can be used by two different businesses", async () => {
    const t = convexTest(schema, modules);
    const a = await business(t, "A"), b = await business(t, "B");
    const asA = t.withIdentity({ subject: a.userId, tokenIdentifier: "x|a" });
    const asB = t.withIdentity({ subject: b.userId, tokenIdentifier: "x|b" });
    await asA.mutation(api.suppliers.upsert, { code: "SUP-1", name: "Alpha", ...base });
    await expect(asB.mutation(api.suppliers.upsert, { code: "SUP-1", name: "Beta", ...base })).resolves.toBeTruthy();
    expect((await asA.query(api.suppliers.list, {})).map((s) => s.name)).toEqual(["Alpha"]);
    expect((await asB.query(api.suppliers.list, {})).map((s) => s.name)).toEqual(["Beta"]);
  });

  it("a blank code is filled in automatically and never clashes", async () => {
    const t = convexTest(schema, modules);
    const a = await business(t, "A");
    const as = t.withIdentity({ subject: a.userId, tokenIdentifier: "x|a" });
    await as.mutation(api.suppliers.upsert, { code: "", name: "One", ...base });
    await as.mutation(api.suppliers.upsert, { code: "  ", name: "Two", ...base });
    expect((await as.query(api.suppliers.list, {})).map((s) => s.code).sort()).toEqual(["SUP-0001", "SUP-0002"]);
  });

  it("a duplicate code inside one business is refused, also when editing", async () => {
    const t = convexTest(schema, modules);
    const a = await business(t, "A");
    const as = t.withIdentity({ subject: a.userId, tokenIdentifier: "x|a" });
    await as.mutation(api.suppliers.upsert, { code: "S1", name: "One", ...base });
    const two = await as.mutation(api.suppliers.upsert, { code: "S2", name: "Two", ...base });
    await expect(as.mutation(api.suppliers.upsert, { code: "s1", name: "Three", ...base })).rejects.toThrow(/tayari inatumika/);
    await expect(as.mutation(api.suppliers.upsert, { id: two, code: "S1", name: "Two", ...base })).rejects.toThrow(/tayari inatumika/);
  });

  it("suppliers saved in one department are visible and usable from the others", async () => {
    const t = convexTest(schema, modules);
    const a = await business(t, "A");
    const now = new Date().toISOString();
    const { bar, lounge } = await t.run(async (ctx) => ({
      bar: await ctx.db.insert("branches", { tenantId: a.tenantId, name: "Bar", code: "BAR", isActive: true, createdAt: now }),
      lounge: await ctx.db.insert("branches", { tenantId: a.tenantId, name: "Lounge", code: "LNG", isActive: true, createdAt: now }),
    }));
    await t.run((ctx) => ctx.db.insert("suppliers", { tenantId: a.tenantId, branchId: bar, code: "OLD", name: "Old supplier", openingBalance: 0, isActive: true }));
    // A manager working in the Lounge department still sees the supplier that was saved in the Bar.
    await t.run((ctx) => ctx.db.patch("users", a.userId, { branchId: lounge }));
    const as = t.withIdentity({ subject: a.userId, tokenIdentifier: "x|a" });
    expect((await as.query(api.suppliers.list, {})).map((s) => s.name)).toEqual(["Old supplier"]);
    expect((await as.query(api.suppliers.listActive, {})).map((s) => s.name)).toEqual(["Old supplier"]);
    await expect(as.mutation(api.suppliers.upsert, { code: "NEW", name: "New supplier", ...base })).resolves.toBeTruthy();
    expect(await as.query(api.suppliers.list, {})).toHaveLength(2);
  });
});
