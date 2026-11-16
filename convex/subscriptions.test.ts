import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { TestConvex } from "convex-test";
import { modules } from "./tes.setup";
import { addDays, addMonths, tzToday } from "./plans";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date().toISOString();
    const a = await ctx.db.insert("tenants", { name: "Duka A", code: "A", isActive: true, createdByToken: "t", createdAt: now });
    const b = await ctx.db.insert("tenants", { name: "Duka B", code: "B", isActive: true, createdByToken: "t", createdAt: now });
    const admin = await ctx.db.insert("users", { name: "Boss", username: "boss", role: "super_admin", isActive: true });
    const mgrA = await ctx.db.insert("users", { name: "Mgr A", username: "mgra", role: "manager", tenantId: a, isActive: true });
    const mgrB = await ctx.db.insert("users", { name: "Mgr B", username: "mgrb", role: "manager", tenantId: b, isActive: true });
    return { a, b, admin, mgrA, mgrB };
  });
  const asAdmin = t.withIdentity({ subject: ids.admin, tokenIdentifier: "x|1" });
  const asA = t.withIdentity({ subject: ids.mgrA, tokenIdentifier: "x|2" });
  const asB = t.withIdentity({ subject: ids.mgrB, tokenIdentifier: "x|3" });
  return { t, asAdmin, asA, asB, ...ids };
}
const setEnd = (t: TestConvex<typeof schema>, id: Id<"tenants">, plan: string, endsAt: string) => t.run(async (ctx) => { await ctx.db.patch("tenants", id, { plan, planEndsAt: endsAt }); });

describe("date helpers", () => {
  it("adds months without overflowing short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-10-12", 3)).toBe("2027-01-12");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("business subscriptions", () => {
  it("a new business is a 3-day demo unless a paid plan is given", async () => {
    const { asAdmin, t } = await setup();
    const demo = await asAdmin.mutation(api.tenants.create, { name: "Demo Shop", code: "D1" });
    const paid = await asAdmin.mutation(api.tenants.create, { name: "Paid Shop", code: "P1", plan: "paid", months: 3, amount: 150000 });
    const d = await t.run((ctx) => ctx.db.get("tenants", demo.tenantId));
    const p = await t.run((ctx) => ctx.db.get("tenants", paid.tenantId));
    expect(d?.plan).toBe("demo");
    expect(d?.planEndsAt).toBe(addDays(tzToday(), 2));
    expect(p?.plan).toBe("paid");
    expect(p?.planEndsAt).toBe(addDays(addMonths(tzToday(), 3), -1));
    expect(p?.planAmount).toBe(150000);
    await expect(asAdmin.mutation(api.tenants.create, { name: "Bad", code: "B1", plan: "paid", months: 0, amount: 10 })).rejects.toThrow(/miezi/);
    await expect(asAdmin.mutation(api.tenants.create, { name: "Bad2", code: "B2", plan: "paid", months: 2 })).rejects.toThrow(/kiasi/);
  });

  it("renewing a running paid plan extends from its end date and keeps the payment history", async () => {
    const { asAdmin, a } = await setup();
    await asAdmin.mutation(api.subscriptions.set, { tenantId: a, plan: "paid", months: 1, amount: 50000 });
    const first = addDays(addMonths(tzToday(), 1), -1);
    const r = await asAdmin.mutation(api.subscriptions.set, { tenantId: a, plan: "paid", months: 2, amount: 90000 });
    expect(r.startsAt).toBe(addDays(first, 1));
    expect(r.endsAt).toBe(addDays(addMonths(addDays(first, 1), 2), -1));
    const h = await asAdmin.query(api.subscriptions.history, { tenantId: a });
    expect(h.payments.map((x) => x.amount).sort()).toEqual([50000, 90000]);
  });

  it("only the Super Admin can change plans", async () => {
    const { asA, a } = await setup();
    await expect(asA.mutation(api.subscriptions.set, { tenantId: a, plan: "demo" })).rejects.toThrow();
  });

  it("an expired business is blocked (screen + backend); legacy businesses without a plan never expire", async () => {
    const { t, asA, asB, asAdmin, a } = await setup();
    expect((await asB.query(api.tenants.current, {}))?.expired).toBe(false); // legacy: no plan
    await setEnd(t, a, "demo", addDays(tzToday(), -1));
    const cur = await asA.query(api.tenants.current, {});
    expect(cur?.expired).toBe(true);
    await expect(asA.query(api.clients.list, {})).rejects.toThrow(/subscription expired/);
    await asAdmin.mutation(api.subscriptions.set, { tenantId: a, plan: "paid", months: 1, amount: 1000 });
    expect((await asA.query(api.tenants.current, {}))?.expired).toBe(false);
    await expect(asA.query(api.clients.list, {})).resolves.toBeDefined();
  });

  it("business managers get a reminder from 7 days before the end, not earlier", async () => {
    const { t, asA, a } = await setup();
    const today = tzToday();
    await setEnd(t, a, "paid", addDays(today, 10));
    expect((await asA.query(api.notifications.feed, { today })).items.some((i) => i.code === "sub_expiring")).toBe(false);
    await setEnd(t, a, "paid", addDays(today, 7));
    const feed = await asA.query(api.notifications.feed, { today });
    const n = feed.items.find((i) => i.code === "sub_expiring");
    expect(n?.params.days).toBe(7);
    await setEnd(t, a, "demo", addDays(today, 1));
    const d = (await asA.query(api.notifications.feed, { today })).items.find((i) => i.code === "demo_expiring");
    expect(d?.level).toBe("danger");
  });
});

describe("announcements", () => {
  it("a message to everyone reaches every business, one aimed at a business reaches only it", async () => {
    const { asAdmin, asA, asB, a } = await setup();
    const today = tzToday();
    await asAdmin.mutation(api.announcements.create, { kind: "message", title: "Matengenezo", body: "Mfumo utazimwa saa 6 usiku." });
    await asAdmin.mutation(api.announcements.create, { kind: "message", title: "Kwa A tu", body: "Habari A", tenantId: a });
    const titles = async (c: ReturnType<TestConvex<typeof schema>["withIdentity"]>) => (await c.query(api.notifications.feed, { today })).items.filter((i) => i.code === "announcement").map((i) => i.params.title).sort();
    expect(await titles(asA)).toEqual(["Kwa A tu", "Matengenezo"]);
    expect(await titles(asB)).toEqual(["Matengenezo"]);
    const list = await asAdmin.query(api.announcements.list, {});
    expect(list.find((x) => x.title === "Matengenezo")?.reach).toBe(2);
    expect(list.find((x) => x.title === "Kwa A tu")?.reach).toBe(1);
  });

  it("banners show for their dates and can be switched off; only https links are accepted", async () => {
    const { asAdmin, asA } = await setup();
    const id = await asAdmin.mutation(api.announcements.create, { kind: "banner", title: "Punguzo", body: "Lipia miezi 6 upate 1 bure", imageUrl: "https://example.com/a.png", linkUrl: "https://example.com", theme: "green" });
    await asAdmin.mutation(api.announcements.create, { kind: "banner", title: "Imeisha", body: "", startsAt: "2020-01-01", endsAt: "2020-01-31" });
    expect((await asA.query(api.announcements.banners, {})).map((b) => b.title)).toEqual(["Punguzo"]);
    await asAdmin.mutation(api.announcements.setActive, { id, isActive: false });
    expect(await asA.query(api.announcements.banners, {})).toEqual([]);
    await expect(asAdmin.mutation(api.announcements.create, { kind: "banner", title: "X", body: "", linkUrl: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await expect(asA.mutation(api.announcements.create, { kind: "message", title: "X", body: "Y" })).rejects.toThrow();
  });
});

describe("when a business was paid", () => {
  it("a payment day in the past starts the plan on that day; the Super Admin list shows the last payment, the period and the total paid", async () => {
    const { asAdmin, a } = await setup();
    const paidOn = addDays(tzToday(), -10);
    const r = await asAdmin.mutation(api.subscriptions.set, { tenantId: a, plan: "paid", months: 2, amount: 80000, paidOn });
    expect(r).toMatchObject({ startsAt: paidOn, paidOn, endsAt: addDays(addMonths(paidOn, 2), -1) });
    const row = (await asAdmin.query(api.tenants.list, {})).find((x) => x._id === a)!;
    expect(row.lastPayment).toMatchObject({ paidOn, amount: 80000, months: 2, startsAt: paidOn, endsAt: r.endsAt });
    expect(row).toMatchObject({ totalPaid: 80000, paymentsCount: 1 });
    expect(row.subscription).toMatchObject({ plan: "paid", expired: false });
    // a second payment while it still runs extends from the end; the list shows the newest payment and the sum
    await asAdmin.mutation(api.subscriptions.set, { tenantId: a, plan: "paid", months: 1, amount: 40000 });
    const again = (await asAdmin.query(api.tenants.list, {})).find((x) => x._id === a)!;
    expect(again.lastPayment).toMatchObject({ paidOn: tzToday(), amount: 40000 });
    expect(again).toMatchObject({ totalPaid: 120000, paymentsCount: 2 });
  });

  it("a business created as paid on an earlier day starts then; a business with no payment has none", async () => {
    const { asAdmin } = await setup();
    const paidOn = addDays(tzToday(), -20);
    const created = await asAdmin.mutation(api.tenants.create, { name: "Old Payer", code: "OP1", plan: "paid", months: 3, amount: 150000, paidOn });
    const demo = await asAdmin.mutation(api.tenants.create, { name: "Just Demo", code: "JD1" });
    const list = await asAdmin.query(api.tenants.list, {});
    expect(list.find((x) => x._id === created.tenantId)?.lastPayment).toMatchObject({ paidOn, endsAt: addDays(addMonths(paidOn, 3), -1) });
    expect(list.find((x) => x._id === demo.tenantId)?.lastPayment).toBeNull();
  });

  it("refuses a payment day in the future, an unreadable one, and one that would make the plan already over", async () => {
    const { asAdmin, a } = await setup();
    const set = (paidOn: string, months = 1) => asAdmin.mutation(api.subscriptions.set, { tenantId: a, plan: "paid", months, amount: 1000, paidOn });
    await expect(set(addDays(tzToday(), 1))).rejects.toThrow(/baadaye/);
    await expect(set("2026-13-45")).rejects.toThrow(/si sahihi/);
    await expect(set(addDays(tzToday(), -90), 1)).rejects.toThrow(/umeisha tayari/);
    expect((await asAdmin.query(api.subscriptions.history, { tenantId: a })).payments).toHaveLength(0); // nothing was recorded
  });
});
