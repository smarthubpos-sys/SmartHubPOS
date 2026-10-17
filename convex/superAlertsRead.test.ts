import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";

describe("Super Admin alerts keep a read state", () => {
  it("opening an alert marks it read, it drops below unread ones, and it is per Super Admin", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    const { root, root2 } = await t.run(async (ctx) => {
      await ctx.db.insert("tenants", { name: "Stopped Shop", code: "S", isActive: false, createdByToken: "t", createdAt: now });
      const root = await ctx.db.insert("users", { name: "root", username: "root", role: "super_admin", isActive: true });
      const root2 = await ctx.db.insert("users", { name: "root2", username: "root2", role: "super_admin", isActive: true });
      return { root, root2 };
    });
    const a = t.withIdentity({ subject: root, tokenIdentifier: "x|1" });
    const b = t.withIdentity({ subject: root2, tokenIdentifier: "x|2" });
    const before = await a.query(api.subscriptions.dashboardSummary, {});
    const alert = before.alerts.find((x) => x.code === "suspended");
    expect(alert?.read).toBe(false);
    await a.mutation(api.notifications.markRead, { keys: [alert!.readKey] });
    const after = await a.query(api.subscriptions.dashboardSummary, {});
    expect(after.alerts.find((x) => x.code === "suspended")?.read).toBe(true);
    expect((await b.query(api.subscriptions.dashboardSummary, {})).alerts.find((x) => x.code === "suspended")?.read).toBe(false);
  });
});
