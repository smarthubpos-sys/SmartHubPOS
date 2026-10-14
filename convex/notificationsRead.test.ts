import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

const today = new Date().toISOString().slice(0, 10);

describe("notification read state", () => {
  it("an opened alert stays read (counter drops, item moves to read) and new ones stay unread", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = new Date().toISOString();
      const tenantId = await ctx.db.insert("tenants", { name: "Duka", code: "DK", isActive: true, createdByToken: "t", createdAt: now });
      const user = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "admin", tenantId, isActive: true });
      await ctx.db.insert("products", { tenantId, itemCode: "A", name: "Sukari", sellingPrice: 1, openingQty: 0, currentQty: 0, isActive: true });
      await ctx.db.insert("products", { tenantId, itemCode: "B", name: "Mchele", sellingPrice: 1, openingQty: 0, currentQty: 0, isActive: true });
      return { user };
    });
    const as = t.withIdentity({ subject: ids.user, tokenIdentifier: "x|1" });
    const before = await as.query(api.notifications.feed, { today });
    expect(before.unread).toBe(2);
    await as.mutation(api.notifications.markRead, { keys: [before.items[0].key] });
    const after = await as.query(api.notifications.feed, { today });
    expect(after.unread).toBe(1);
    expect(after.items.filter((i) => i.read)).toHaveLength(1);
    // marking the same alert twice does not duplicate or un-read anything
    await as.mutation(api.notifications.markRead, { keys: [before.items[0].key] });
    expect((await as.query(api.notifications.feed, { today })).unread).toBe(1);
  });
});
