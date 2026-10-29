import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { businessRows, isManagerRole, isSuperAdmin, logAudit, requireActiveUser, roleHasPermission } from "./access";
import type { UserLike } from "./access";
import { addDaysIso, businessNow, dueOn, monthBounds, toMinutes } from "./attendanceMath";
import { dayCount, isLateRequest, stageOf } from "./leaveMath";
import { effectiveModules } from "./permissions";
import { loadClosedDays, loadSchedule } from "./schedules";

const TYPES = ["annual", "sick", "maternity", "paternity", "unpaid", "other"];
const MAX_DAYS = 90;
const MAX_BACKDATE_DAYS = 30;
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

type Leave = Doc<"leaveRequests">;

/** The HR employee record tied to this login (set in HR > Employees). */
async function myEmployee(ctx: QueryCtx, user: Doc<"users">) {
  if (!user.employeeId) return null;
  const e = await ctx.db.get("employees", user.employeeId);
  if (!e || !user.tenantId || e.tenantId !== user.tenantId) return null;
  return e;
}

/**
 * May this person receive and decide the request? Managers see everything of their business.
 * HR reviewers (permission leave.review) see what was sent to HR (and older HR-entered requests), never one sent only to the manager.
 */
async function handles(ctx: QueryCtx, user: UserLike, row: Leave): Promise<boolean> {
  if (isSuperAdmin(user)) return user.tenantId ? row.tenantId === user.tenantId : true;
  if (!user.tenantId || row.tenantId !== user.tenantId) return false;
  if (await isManagerRole(ctx, user)) return true;
  return row.target !== "manager" && (await roleHasPermission(ctx, user, "leave.review"));
}

async function canReviewAny(ctx: QueryCtx, user: UserLike) {
  return isSuperAdmin(user) || (await isManagerRole(ctx, user)) || (await roleHasPermission(ctx, user, "leave.review"));
}

async function shape(ctx: QueryCtx, rows: Leave[], clashes?: Leave[]) {
  const names = new Map<string, string>();
  const nameOf = async (id: Id<"users"> | undefined) => {
    if (!id) return undefined;
    const key = String(id);
    if (!names.has(key)) { const u = await ctx.db.get("users", id); names.set(key, u?.name ?? u?.username ?? "-"); }
    return names.get(key);
  };
  const emps = new Map<string, Doc<"employees"> | null>();
  const out = [];
  for (const l of rows) {
    const key = String(l.employeeId);
    if (!emps.has(key)) emps.set(key, await ctx.db.get("employees", l.employeeId));
    const e = emps.get(key);
    out.push({
      _id: l._id, employeeId: l.employeeId, employeeName: e?.name ?? "-", employeeCode: e?.employeeCode ?? "", position: e?.position, department: e?.department,
      leaveType: l.leaveType, startDate: l.startDate, endDate: l.endDate, days: l.days, reason: l.reason, status: l.status, stage: stageOf(l), target: l.target ?? null,
      lateRequest: l.lateRequest === true, requestedAt: l.requestedAt ?? new Date(l._creationTime).toISOString(), receivedAt: l.receivedAt, viewedAt: l.viewedAt,
      viewedByName: await nameOf(l.viewedBy), decidedAt: l.decidedAt, decidedByName: await nameOf(l.decidedBy), decisionNote: l.decisionNote,
      createdBy: l.createdBy,
      // Other people already away on any of these days (approved leave), so the approver sees the effect on the team.
      clashes: clashes ? clashes.filter((c) => c._id !== l._id && c.employeeId !== l.employeeId && c.startDate <= l.endDate && c.endDate >= l.startDate).length : 0,
    });
  }
  return out;
}

/* ───────────── Who am I, and what may I do here ───────────── */

export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "leave");
    const e = await myEmployee(ctx, user);
    return {
      linked: !!e,
      employee: e ? { _id: e._id, name: e.name, code: e.employeeCode, position: e.position, department: e.department } : null,
      canRequest: await roleHasPermission(ctx, user, "leave.request"),
      canReview: await canReviewAny(ctx, user),
      isManager: isSuperAdmin(user) || (await isManagerRole(ctx, user)),
    };
  },
});

/* ───────────── My timetable, sign-in of today and sales of the day ───────────── */

export const myWork = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "leave");
    const now = businessNow();
    const e = await myEmployee(ctx, user);

    // Sales of the day exist only for people who sell (and whose business has the Sales module).
    const tenant = user.tenantId ? await ctx.db.get("tenants", user.tenantId) : null;
    const allowed = isSuperAdmin(user) ? null : effectiveModules(tenant?.modules, user.menuAccess);
    let sales: { total: number; collected: number; count: number } | null = null;
    if (user.tenantId && (!allowed || allowed.includes("sales")) && (await roleHasPermission(ctx, user, "sales.view"))) {
      const tenantId = user.tenantId;
      const invoices = (await ctx.db.query("invoices").withIndex("by_tenant_user_date", (q) => q.eq("tenantId", tenantId).eq("createdBy", user._id).eq("invoiceDate", now.date)).take(1000)).filter((i) => i.status === "posted");
      let total = invoices.reduce((n, i) => n + i.total, 0), collected = invoices.reduce((n, i) => n + i.amountPaid, 0), count = invoices.length;
      if (!allowed || allowed.includes("waiterOrders")) {
        const today = (id: string) => new Date(Date.parse(id) + 3 * 3600000).toISOString().slice(0, 10) === now.date;
        const orders = (await ctx.db.query("waiterOrders").withIndex("by_waiter", (q) => q.eq("waiterId", user._id)).order("desc").take(300)).filter((o) => o.tenantId === tenantId && !o.cancelledAt && today(o.createdAt));
        total += orders.reduce((n, o) => n + o.total, 0); collected += orders.reduce((n, o) => n + (o.paidAmount ?? 0), 0); count += orders.length;
      }
      if (count > 0) sales = { total: Math.round(total * 100) / 100, collected: Math.round(collected * 100) / 100, count };
    }

    if (!e) return { linked: false as const, date: now.date, time: now.time, sales };

    const schedule = await loadSchedule(ctx, e._id);
    const closed = await loadClosedDays(ctx, e.tenantId);
    const due = dueOn(schedule, now.date, closed);
    const rec = await ctx.db.query("attendance").withIndex("by_employee_date", (q) => q.eq("employeeId", e._id).eq("date", now.date)).first();
    const month = monthBounds(now.date);
    const monthRows = await ctx.db.query("attendance").withIndex("by_employee_date", (q) => q.eq("employeeId", e._id).gte("date", month.start).lte("date", month.end)).collect();
    const until = addDaysIso(now.date, 30);
    return {
      linked: true as const, date: now.date, time: now.time, sales,
      hasTimetable: schedule.length > 0,
      week: [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
        const d = schedule.find((x) => x.weekday === weekday);
        return { weekday, isOff: !d || d.isOff, startTime: d?.startTime, endTime: d?.endTime };
      }),
      today: {
        isOff: due === "off", closed: closed.has(now.date), startTime: due && due !== "off" ? due.startTime : undefined, endTime: due && due !== "off" ? due.endTime : undefined,
        signInTime: rec?.signInTime, signOutTime: rec?.signOutTime, lateMinutes: rec?.lateMinutes ?? 0, lateDeduction: rec?.lateWaived ? 0 : rec?.lateDeduction ?? 0,
        notInYet: !rec?.signInTime && !!due && due !== "off" && now.minutes > toMinutes(due.startTime),
      },
      month: {
        daysWorked: monthRows.filter((r) => r.signInTime).length,
        lateCount: monthRows.filter((r) => (r.lateMinutes ?? 0) > 0).length,
        lateMinutes: monthRows.reduce((n, r) => n + (r.lateMinutes ?? 0), 0),
        lateDeduction: monthRows.reduce((n, r) => n + (r.lateWaived ? 0 : r.lateDeduction ?? 0), 0),
      },
      closedDays: [...closed].filter((d) => d >= now.date && d <= until).sort(),
    };
  },
});

/* ───────────── My requests ───────────── */

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "leave");
    const e = await myEmployee(ctx, user);
    if (!e) return [];
    const rows = await ctx.db.query("leaveRequests").withIndex("by_employee", (q) => q.eq("employeeId", e._id)).collect();
    return await shape(ctx, rows.sort((x, y) => y._creationTime - x._creationTime).slice(0, 100));
  },
});

export const submit = mutation({
  args: { target: v.union(v.literal("manager"), v.literal("hr")), leaveType: v.string(), startDate: v.string(), endDate: v.string(), reason: v.string() },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "leave");
    if (!(await roleHasPermission(ctx, user, "leave.request"))) throw new ConvexError('Forbidden: permission "leave.request" required');
    const e = await myEmployee(ctx, user);
    if (!e) throw new ConvexError("Akaunti yako haijaunganishwa na mfanyakazi wa HR. Muombe HR au Manager akuunganishe.");
    if (!e.isActive) throw new ConvexError("Mfanyakazi huyu hafanyi kazi tena.");
    if (!TYPES.includes(a.leaveType)) throw new ConvexError("Aina ya likizo si sahihi.");
    if (!validDate(a.startDate) || !validDate(a.endDate)) throw new ConvexError("Tarehe si sahihi.");
    if (a.endDate < a.startDate) throw new ConvexError("Tarehe ya mwisho lazima iwe baada ya ya mwanzo.");
    const reason = a.reason.trim();
    if (reason.length < 3 || reason.length > 1000) throw new ConvexError("Andika sababu ya ombi lako (angalau herufi 3).");
    const now = businessNow();
    if (a.startDate < addDaysIso(now.date, -MAX_BACKDATE_DAYS)) throw new ConvexError("Huwezi kuomba ruhusa ya tarehe zaidi ya siku 30 zilizopita. Wasiliana na HR.");
    const days = dayCount(a.startDate, a.endDate);
    if (days > MAX_DAYS) throw new ConvexError("Ombi moja lisizidi siku 90.");
    const overlap = (await ctx.db.query("leaveRequests").withIndex("by_employee", (q) => q.eq("employeeId", e._id)).collect())
      .some((l) => ["pending", "approved"].includes(l.status) && l.startDate <= a.endDate && l.endDate >= a.startDate);
    if (overlap) throw new ConvexError("Mfanyakazi ana likizo nyingine kwenye tarehe hizi.");
    const due = a.startDate === now.date ? dueOn(await loadSchedule(ctx, e._id), now.date, await loadClosedDays(ctx, e.tenantId)) : undefined;
    const late = isLateRequest(a.startDate, now, due && due !== "off" ? toMinutes(due.startTime) : undefined);
    const id = await ctx.db.insert("leaveRequests", {
      tenantId: e.tenantId, branchId: e.branchId, employeeId: e._id, leaveType: a.leaveType, startDate: a.startDate, endDate: a.endDate, days, reason,
      status: "pending", createdBy: user._id, target: a.target, requestedAt: new Date().toISOString(), lateRequest: late,
    });
    await logAudit(ctx, user, { action: "request_leave", module: "leave", referenceId: String(id), details: `${e.name} ${a.startDate}..${a.endDate} -> ${a.target}${late ? " (late)" : ""}` });
    return { id, late };
  },
});

export const cancelMine = mutation({
  args: { id: v.id("leaveRequests") },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "leave");
    const e = await myEmployee(ctx, user);
    const l = await ctx.db.get("leaveRequests", a.id);
    if (!e || !l || l.employeeId !== e._id) throw new ConvexError("Ombi la likizo halipatikani.");
    if (l.status !== "pending") throw new ConvexError("Unaweza kufuta ombi lako lililo kwenye foleni tu.");
    await ctx.db.patch("leaveRequests", a.id, { status: "cancelled" });
    await logAudit(ctx, user, { action: "cancel_leave", module: "leave", referenceId: String(a.id) });
    return a.id;
  },
});

/* ───────────── Receiver side (manager / HR) ───────────── */

export const inbox = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "leave");
    if (!(await canReviewAny(ctx, user))) throw new ConvexError('Forbidden: permission "leave.review" required');
    const all = await businessRows(ctx, user, "leaveRequests");
    const mine: Leave[] = [];
    for (const l of all) if (l.createdBy !== user._id && (await handles(ctx, user, l))) mine.push(l);
    const approved = all.filter((l) => l.status === "approved");
    const pending = mine.filter((l) => l.status === "pending").sort((x, y) => (x.requestedAt ?? "").localeCompare(y.requestedAt ?? "") || x._creationTime - y._creationTime);
    const decided = mine.filter((l) => l.status !== "pending").sort((x, y) => (y.decidedAt ?? "").localeCompare(x.decidedAt ?? "") || y._creationTime - x._creationTime).slice(0, 60);
    return await shape(ctx, [...pending, ...decided], approved);
  },
});

/** Called by the receiver's screen when the inbox loads: every request still "sent" becomes "received". */
export const markReceived = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "leave");
    if (!(await canReviewAny(ctx, user))) return 0;
    let n = 0;
    for (const l of await businessRows(ctx, user, "leaveRequests")) {
      if (l.status !== "pending" || l.receivedAt || l.createdBy === user._id || !(await handles(ctx, user, l))) continue;
      await ctx.db.patch("leaveRequests", l._id, { receivedAt: new Date().toISOString(), receivedBy: user._id });
      n++;
    }
    return n;
  },
});

async function stampViewed(ctx: MutationCtx, user: Doc<"users">, l: Leave) {
  if (l.status !== "pending" || l.viewedAt) return;
  const at = new Date().toISOString();
  await ctx.db.patch("leaveRequests", l._id, { viewedAt: at, viewedBy: user._id, ...(l.receivedAt ? {} : { receivedAt: at, receivedBy: user._id }) });
}

export const markViewed = mutation({
  args: { id: v.id("leaveRequests") },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "leave");
    const l = await ctx.db.get("leaveRequests", a.id);
    if (!l || l.createdBy === user._id || !(await handles(ctx, user, l))) throw new ConvexError("Ombi la likizo halipatikani.");
    await stampViewed(ctx, user, l);
    return true;
  },
});

export const decide = mutation({
  args: { id: v.id("leaveRequests"), approve: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "leave");
    const l = await ctx.db.get("leaveRequests", a.id);
    if (!l || !(await handles(ctx, user, l))) throw new ConvexError("Ombi la likizo halipatikani.");
    if (l.createdBy === user._id) throw new ConvexError("Huwezi kuamua ombi lako mwenyewe.");
    if (l.status !== "pending") throw new ConvexError("Ombi hili limeshaamuliwa.");
    const note = a.note?.trim();
    if (!a.approve && (!note || note.length < 3)) throw new ConvexError("Andika sababu ya kukataa ombi.");
    await stampViewed(ctx, user, l);
    await ctx.db.patch("leaveRequests", a.id, { status: a.approve ? "approved" : "rejected", decidedBy: user._id, decidedAt: new Date().toISOString(), decisionNote: note || undefined });
    await logAudit(ctx, user, { action: a.approve ? "approve_leave" : "reject_leave", module: "leave", referenceId: String(a.id), details: note });
    return a.id;
  },
});
