import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./tes.setup";
import { addDays, tzToday } from "./plans";
import { reminderKey, reminderText } from "./subscriptionReminders";

async function business(endsIn: number, opts: { email?: string; active?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Hotel", code: "H", isActive: opts.active ?? true, createdByToken: "t", createdAt: "2026-01-01T00:00:00.000Z", plan: "paid", planEndsAt: addDays(tzToday(), endsIn) });
    await ctx.db.insert("users", { name: "Boss", username: "boss", role: "admin", tenantId, isActive: true, email: opts.email });
    return tenantId;
  });
  return { t, id };
}

describe("subscription reminders", () => {
  it("reminds on 7, 3, 1 and 0 days left, and on no other day", async () => {
    for (const n of [7, 3, 1, 0]) { const { t } = await business(n, { email: "boss@hotel.co.tz" }); expect(await t.query(internal.subscriptionReminders.due, {})).toHaveLength(1); }
    for (const n of [10, 5, 2, -1]) { const { t } = await business(n, { email: "boss@hotel.co.tz" }); expect(await t.query(internal.subscriptionReminders.due, {})).toHaveLength(0); }
  });
  it("e-mails the business admins, once, and never a suspended business or one without an address", async () => {
    const { t, id } = await business(3, { email: "Boss@Hotel.co.tz" });
    const rows = await t.query(internal.subscriptionReminders.due, {});
    expect(rows[0].recipients).toEqual(["boss@hotel.co.tz"]);
    await t.mutation(internal.subscriptionReminders.markSent, { key: reminderKey(String(id), rows[0].endsAt, 3) });
    expect(await t.query(internal.subscriptionReminders.due, {})).toHaveLength(0);
    expect(await (await business(3, { email: "x@y.co", active: false })).t.query(internal.subscriptionReminders.due, {})).toHaveLength(0);
    expect(await (await business(3)).t.query(internal.subscriptionReminders.due, {})).toHaveLength(0);
  });
  it("writes a clear subject", () => {
    expect(reminderText("Hotel", "paid", "2026-12-01", 0).subject).toContain("unaisha leo");
    expect(reminderText("Hotel", "demo", "2026-12-01", 3).subject).toContain("siku 3");
  });
});
