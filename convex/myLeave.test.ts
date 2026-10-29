import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./tes.setup";
import { isLateRequest, stageOf } from "./leaveMath";

/** Monday 2026-10-26, 08:00 business time (05:00 UTC). */
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const DAYS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, isOff: weekday === 0, startTime: weekday === 0 ? undefined : "08:00", endTime: weekday === 0 ? undefined : "17:00" }));

async function setup(tenantModules?: string[]) {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-10-26T04:00:00Z");
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tenant = await ctx.db.insert("tenants", { name: "Duka", code: "D", isActive: true, createdByToken: "t", createdAt: new Date().toISOString(), modules: tenantModules });
    const asha = await ctx.db.insert("employees", { tenantId: tenant, employeeCode: "E1", name: "Asha", startDate: "2026-01-01", basicSalary: 300000, salaryType: "monthly", isActive: true });
    const mgr = await ctx.db.insert("users", { name: "Mgr", username: "mgr", role: "manager", tenantId: tenant, isActive: true });
    const waiter = await ctx.db.insert("users", { name: "Asha W", username: "asha", role: "waiter", tenantId: tenant, isActive: true, employeeId: asha });
    const stranger = await ctx.db.insert("users", { name: "Nobody", username: "nobody", role: "cashier", tenantId: tenant, isActive: true });
    const hr = await ctx.db.insert("users", { name: "HR Officer", username: "hr1", role: "viewer", tenantId: tenant, isActive: true, extraPermissions: ["leave.review"] });
    const other = await ctx.db.insert("tenants", { name: "Nyingine", code: "N", isActive: true, createdByToken: "t2", createdAt: new Date().toISOString() });
    const outsider = await ctx.db.insert("users", { name: "Out", username: "out", role: "manager", tenantId: other, isActive: true });
    return { tenant, asha, mgr, waiter, stranger, hr, outsider };
  });
  const as = (id: Id<"users">) => t.withIdentity({ subject: id, tokenIdentifier: `x|${id}` });
  return { t, ids, mgr: as(ids.mgr), waiter: as(ids.waiter), stranger: as(ids.stranger), hr: as(ids.hr), outsider: as(ids.outsider) };
}
afterEach(() => { vi.useRealTimers(); });

const request = { leaveType: "annual", startDate: "2026-10-30", endDate: "2026-10-31", reason: "Safari ya familia" };

describe("leave rules", () => {
  it("flags a request as late only when the leave has already started", () => {
    const now = { date: "2026-10-26", minutes: 9 * 60 };
    expect(isLateRequest("2026-10-25", now)).toBe(true);
    expect(isLateRequest("2026-10-26", now, 8 * 60)).toBe(true); // shift already began
    expect(isLateRequest("2026-10-26", now, 10 * 60)).toBe(false);
    expect(isLateRequest("2026-10-26", now)).toBe(false); // no timetable
    expect(isLateRequest("2026-10-27", now, 8 * 60)).toBe(false);
  });
  it("follows sent -> received -> viewed -> decision", () => {
    expect(stageOf({ status: "pending" })).toBe("sent");
    expect(stageOf({ status: "pending", receivedAt: "x" })).toBe("received");
    expect(stageOf({ status: "pending", receivedAt: "x", viewedAt: "y" })).toBe("viewed");
    expect(stageOf({ status: "approved", receivedAt: "x" })).toBe("approved");
  });
});

describe("requesting leave", () => {
  it("lets a linked staff member send a request that travels sent -> received -> viewed -> approved", async () => {
    const { waiter, mgr } = await setup();
    const sent = await waiter.mutation(api.myLeave.submit, { target: "manager", ...request });
    expect(sent.late).toBe(false);
    expect((await waiter.query(api.myLeave.myRequests))[0].stage).toBe("sent");
    const inbox = await mgr.query(api.myLeave.inbox);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].employeeName).toBe("Asha");
    await mgr.mutation(api.myLeave.markReceived, {});
    expect((await waiter.query(api.myLeave.myRequests))[0].stage).toBe("received");
    await mgr.mutation(api.myLeave.markViewed, { id: sent.id });
    expect((await waiter.query(api.myLeave.myRequests))[0].stage).toBe("viewed");
    await mgr.mutation(api.myLeave.decide, { id: sent.id, approve: true, note: "Safari njema" });
    const done = (await waiter.query(api.myLeave.myRequests))[0];
    expect([done.stage, done.decisionNote, done.decidedByName]).toEqual(["approved", "Safari njema", "Mgr"]);
    expect(done.receivedAt && done.viewedAt && done.decidedAt).toBeTruthy();
  });

  it("marks a request sent after the leave started as late, and needs a reason", async () => {
    const { waiter, mgr } = await setup();
    await expect(waiter.mutation(api.myLeave.submit, { target: "hr", ...request, reason: " " })).rejects.toThrow(/sababu/);
    const r = await waiter.mutation(api.myLeave.submit, { target: "manager", leaveType: "sick", startDate: "2026-10-25", endDate: "2026-10-26", reason: "Niliumwa jana" });
    expect(r.late).toBe(true);
    expect((await mgr.query(api.myLeave.inbox))[0].lateRequest).toBe(true);
    await expect(waiter.mutation(api.myLeave.submit, { target: "manager", leaveType: "sick", startDate: "2026-08-01", endDate: "2026-08-02", reason: "Zamani" })).rejects.toThrow(/siku 30/);
  });

  it("refuses an account that is not linked to an employee, and blocks overlapping requests", async () => {
    const { waiter, stranger } = await setup();
    await expect(stranger.mutation(api.myLeave.submit, { target: "manager", ...request })).rejects.toThrow();
    expect((await stranger.query(api.myLeave.status)).linked).toBe(false);
    await waiter.mutation(api.myLeave.submit, { target: "manager", ...request });
    await expect(waiter.mutation(api.myLeave.submit, { target: "hr", ...request })).rejects.toThrow(/likizo nyingine/);
  });

  it("lets the requester cancel only while it is waiting", async () => {
    const { waiter, mgr } = await setup();
    const a = await waiter.mutation(api.myLeave.submit, { target: "manager", ...request });
    await waiter.mutation(api.myLeave.cancelMine, { id: a.id });
    expect((await waiter.query(api.myLeave.myRequests))[0].stage).toBe("cancelled");
    const b = await waiter.mutation(api.myLeave.submit, { target: "manager", ...request });
    await mgr.mutation(api.myLeave.decide, { id: b.id, approve: true });
    await expect(waiter.mutation(api.myLeave.cancelMine, { id: b.id })).rejects.toThrow(/foleni/);
  });
});

describe("who receives and decides", () => {
  it("routes a request to the manager or to HR, never to the other one's reviewer", async () => {
    const { waiter, mgr, hr, ids } = await setup();
    const toMgr = await waiter.mutation(api.myLeave.submit, { target: "manager", ...request });
    // a second employee request to HR, on other dates
    const toHr = await waiter.mutation(api.myLeave.submit, { target: "hr", leaveType: "annual", startDate: "2026-11-10", endDate: "2026-11-11", reason: "Harusi" });
    expect((await mgr.query(api.myLeave.inbox)).map((r) => r._id).sort()).toEqual([toMgr.id, toHr.id].sort());
    expect((await hr.query(api.myLeave.inbox)).map((r) => r._id)).toEqual([toHr.id]);
    await expect(hr.mutation(api.myLeave.decide, { id: toMgr.id, approve: true })).rejects.toThrow(/halipatikani/);
    await hr.mutation(api.myLeave.decide, { id: toHr.id, approve: true });
    expect((await mgr.query(api.myLeave.inbox)).find((r) => r._id === toHr.id)?.status).toBe("approved");
    expect(ids.hr).toBeTruthy();
  });

  it("needs a reason to reject, and nobody decides their own request or another business's", async () => {
    const { waiter, mgr, outsider, stranger } = await setup();
    const r = await waiter.mutation(api.myLeave.submit, { target: "manager", ...request });
    await expect(mgr.mutation(api.myLeave.decide, { id: r.id, approve: false })).rejects.toThrow(/sababu ya kukataa/);
    await expect(outsider.mutation(api.myLeave.decide, { id: r.id, approve: true })).rejects.toThrow();
    await expect(stranger.query(api.myLeave.inbox)).rejects.toThrow();
    await mgr.mutation(api.myLeave.decide, { id: r.id, approve: false, note: "Wiki hiyo kuna stock-take" });
    expect((await waiter.query(api.myLeave.myRequests))[0]).toMatchObject({ stage: "rejected", decisionNote: "Wiki hiyo kuna stock-take" });
  });

  it("does not let a manager approve a request that he sent himself", async () => {
    const { t, ids, mgr } = await setup();
    const employee = await t.run((ctx) => ctx.db.insert("employees", { tenantId: ids.tenant, employeeCode: "E9", name: "Mgr Emp", startDate: "2026-01-01", basicSalary: 1, salaryType: "monthly", isActive: true }));
    await t.run((ctx) => ctx.db.patch("users", ids.mgr, { employeeId: employee }));
    const r = await mgr.mutation(api.myLeave.submit, { target: "manager", ...request });
    await expect(mgr.mutation(api.myLeave.decide, { id: r.id, approve: true })).rejects.toThrow(/mwenyewe/);
    await expect(mgr.mutation(api.hr.decideLeave, { id: r.id, approve: true })).rejects.toThrow(/mwenyewe/);
  });
});

describe("module and menu", () => {
  it("is refused for a business that does not have the Leave module, and for a user whose menu hides it", async () => {
    const off = await setup(["dashboard", "sales", "help"]);
    await expect(off.waiter.query(api.myLeave.status)).rejects.toThrow(/module not available/);
    const on = await setup(["dashboard", "sales", "leave", "help"]);
    expect((await on.waiter.query(api.myLeave.status)).linked).toBe(true);
    await on.t.run((ctx) => ctx.db.patch("users", on.ids.waiter, { menuAccess: ["dashboard", "sales"] }));
    await expect(on.waiter.query(api.myLeave.status)).rejects.toThrow(/module not available/);
  });

  it("is on for every business that has no module list (full plan)", async () => {
    const { waiter } = await setup();
    expect((await waiter.query(api.myLeave.status)).canRequest).toBe(true);
  });
});

describe("my timetable and sales of the day", () => {
  it("shows the week, today's sign-in and lateness", async () => {
    const { t, ids, mgr, waiter } = await setup();
    await mgr.mutation(api.schedules.save, { employeeIds: [ids.asha], days: DAYS });
    at("2026-10-26T05:10:00Z"); // 08:10
    await mgr.mutation(api.attendance.recordManual, { employeeId: ids.asha, kind: "in", tzOffset: 0 });
    const w = await waiter.query(api.myLeave.myWork);
    if (!w.linked) throw new Error("expected a linked employee");
    expect(w.hasTimetable).toBe(true);
    expect(w.week).toHaveLength(7);
    expect(w.week.find((d) => d.weekday === 0)?.isOff).toBe(true);
    expect([w.today.startTime, w.today.signInTime, w.today.lateMinutes]).toEqual(["08:00", "08:10", 10]);
    expect(w.month).toMatchObject({ daysWorked: 1, lateCount: 1, lateMinutes: 10 });
    expect(w.sales).toBeNull();
    expect(t).toBeTruthy();
  });

  it("adds the sales of the day only for people who sell", async () => {
    const { t, ids, waiter, stranger } = await setup();
    await t.run(async (ctx) => {
      const client = await ctx.db.insert("clients", { tenantId: ids.tenant, code: "C1", name: "Mteja", openingBalance: 0, creditPolicy: "allow", isActive: true } as never);
      await ctx.db.insert("invoices", { tenantId: ids.tenant, invoiceNo: "INV-1", invoiceDate: "2026-10-26", clientId: client, subtotal: 5000, discount: 0, taxAmount: 0, total: 5000, amountPaid: 5000, outstanding: 0, paymentStatus: "paid", status: "posted", createdBy: ids.waiter } as never);
    });
    const w = await waiter.query(api.myLeave.myWork);
    expect(w.sales).toEqual({ total: 5000, collected: 5000, count: 1 });
    expect((await stranger.query(api.myLeave.myWork)).sales).toBeNull(); // cashier with no sales of his own today
  });
});

describe("linking a login to an employee", () => {
  it("links, refuses a second employee for the same login, and unlinks", async () => {
    const { t, ids, mgr } = await setup();
    const juma = await t.run((ctx) => ctx.db.insert("employees", { tenantId: ids.tenant, employeeCode: "E2", name: "Juma", startDate: "2026-01-01", basicSalary: 1, salaryType: "monthly", isActive: true }));
    await mgr.mutation(api.hr.linkUser, { employeeId: juma, userId: ids.stranger });
    expect((await mgr.query(api.hr.userLinks)).find((u) => u._id === ids.stranger)?.employeeId).toBe(juma);
    await expect(mgr.mutation(api.hr.linkUser, { employeeId: ids.asha, userId: ids.stranger })).rejects.toThrow(/mfanyakazi mwingine/);
    await mgr.mutation(api.hr.linkUser, { employeeId: juma });
    expect((await mgr.query(api.hr.userLinks)).find((u) => u._id === ids.stranger)?.employeeId).toBeNull();
  });
});

describe("alerts", () => {
  it("tells the manager about a new request and the requester about the decision", async () => {
    const { waiter, mgr } = await setup();
    const r = await waiter.mutation(api.myLeave.submit, { target: "manager", leaveType: "annual", startDate: "2026-10-25", endDate: "2026-10-26", reason: "Dharura" });
    const forMgr = await mgr.query(api.notifications.feed, { today: "2026-10-26" });
    expect(forMgr.items.find((i) => i.key === `leave:${r.id}`)).toMatchObject({ code: "leave_pending_late", link: "/leave" });
    await mgr.mutation(api.myLeave.decide, { id: r.id, approve: true });
    const forMe = await waiter.query(api.notifications.feed, { today: "2026-10-26" });
    expect(forMe.items.some((i) => i.code === "leave_approved")).toBe(true);
    expect((await mgr.query(api.notifications.feed, { today: "2026-10-26" })).items.some((i) => i.key === `leave:${r.id}`)).toBe(false);
  });
});
