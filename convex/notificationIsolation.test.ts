import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const today = new Date().toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const mk = (n: string, c: string) => ctx.db.insert("tenants", { name: n, code: c, isActive: true, createdByToken: "t", createdAt: now });
    const T = await mk("A", "A"); const U = await mk("B", "B");
    const user = (username: string, role: string, tenantId: typeof T) => ctx.db.insert("users", { name: username, username, role, tenantId, isActive: true });
    const admin = await user("admin", "admin", T); const admin2 = await user("admin2", "admin", T); const waiter = await user("waiter", "waiter", T); const otherAdmin = await user("other", "admin", U);
    await ctx.db.insert("products", { tenantId: T, itemCode: "A", name: "Sukari", sellingPrice: 1, openingQty: 0, currentQty: 0, isActive: true });
    return { admin, admin2, waiter, otherAdmin };
  });
  const as = (id: typeof ids.admin, n: number) => t.withIdentity({ subject: id, tokenIdentifier: `x|${n}` });
  return { as1: as(ids.admin, 1), as2: as(ids.admin2, 2), asW: as(ids.waiter, 3), asO: as(ids.otherAdmin, 4) };
}

describe("notifications: isolation and least privilege", () => {
  it("read state is per user: one user marking read does not change another's unread count", async () => {
    const { as1, as2 } = await setup();
    const a = await as1.query(api.notifications.feed, { today });
    expect(a.unread).toBe(1);
    await as1.mutation(api.notifications.markRead, { keys: [a.items[0].key] });
    expect((await as1.query(api.notifications.feed, { today })).unread).toBe(0);
    expect((await as2.query(api.notifications.feed, { today })).unread).toBe(1);
  });

  it("another business sees none of this business's alerts; a waiter without stock.view sees no stock alerts", async () => {
    const { asO, asW } = await setup();
    expect((await asO.query(api.notifications.feed, { today })).items).toHaveLength(0);
    expect((await asW.query(api.notifications.feed, { today })).items).toHaveLength(0);
  });

  it("junk keys are ignored", async () => {
    const { as1 } = await setup();
    await as1.mutation(api.notifications.markRead, { keys: ["", "x".repeat(500)] });
    expect((await as1.query(api.notifications.feed, { today })).unread).toBe(1);
  });
});
