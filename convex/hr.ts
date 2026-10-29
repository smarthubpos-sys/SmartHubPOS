import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { businessRows, canAccessRecord, filterScoped, isSuperAdmin, logAudit, requireManager, scopedRows, requirePermission } from "./access";

const TYPES = ["annual", "sick", "maternity", "paternity", "unpaid", "other"];
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

export const updateEmployee = mutation({
  args: {
    id: v.id("employees"), name: v.string(), basicSalary: v.number(), salaryType: v.string(), startDate: v.string(),
    phone: v.optional(v.string()), email: v.optional(v.string()), address: v.optional(v.string()), position: v.optional(v.string()), department: v.optional(v.string()),
    taxId: v.optional(v.string()), bankAccount: v.optional(v.string()), notes: v.optional(v.string()), isActive: v.boolean(),
  },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "hr");
    const { id, ...data } = a;
    const e = await ctx.db.get("employees", id);
    if (!e || !canAccessRecord(user, e)) throw new ConvexError("Mfanyakazi hapatikani.");
    if (!data.name.trim() || !Number.isFinite(data.basicSalary) || data.basicSalary < 0) throw new ConvexError("Jina na mshahara halali vinahitajika.");
    if (!["monthly", "daily", "hourly"].includes(data.salaryType)) throw new ConvexError("Aina ya mshahara si sahihi.");
    await ctx.db.patch("employees", id, { ...data, name: data.name.trim() });
    await logAudit(ctx, user, { action: "modify_employee", module: "hr", referenceId: String(id), details: data.name });
    return id;
  },
});

export const listLeave = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "payroll.view", "hr");
    const emps = new Map((await scopedRows(ctx, user, "employees")).map((e) => [String(e._id), e]));
    return (await scopedRows(ctx, user, "leaveRequests"))
      .map((l) => ({ ...l, employeeName: emps.get(String(l.employeeId))?.name ?? "-", employeeCode: emps.get(String(l.employeeId))?.employeeCode ?? "" }))
      .sort((x, y) => y.startDate.localeCompare(x.startDate));
  },
});

export const requestLeave = mutation({
  args: { employeeId: v.id("employees"), leaveType: v.string(), startDate: v.string(), endDate: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "hr");
    const e = await ctx.db.get("employees", a.employeeId);
    if (!e || !canAccessRecord(user, e)) throw new ConvexError("Mfanyakazi hapatikani.");
    if (!TYPES.includes(a.leaveType)) throw new ConvexError("Aina ya likizo si sahihi.");
    if (a.endDate < a.startDate) throw new ConvexError("Tarehe ya mwisho lazima iwe baada ya ya mwanzo.");
    const overlap = (await ctx.db.query("leaveRequests").withIndex("by_employee", (q) => q.eq("employeeId", a.employeeId)).collect())
      .some((l) => ["pending", "approved"].includes(l.status) && l.startDate <= a.endDate && l.endDate >= a.startDate);
    if (overlap) throw new ConvexError("Mfanyakazi ana likizo nyingine kwenye tarehe hizi.");
    const id = await ctx.db.insert("leaveRequests", { tenantId: e.tenantId, branchId: e.branchId, employeeId: a.employeeId, leaveType: a.leaveType, startDate: a.startDate, endDate: a.endDate, days: days(a.startDate, a.endDate), reason: a.reason, status: "pending", createdBy: user._id, requestedAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: "request_leave", module: "hr", referenceId: String(id), details: `${e.name} ${a.startDate}..${a.endDate}` });
    return id;
  },
});

export const decideLeave = mutation({
  args: { id: v.id("leaveRequests"), approve: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "hr");
    const l = await ctx.db.get("leaveRequests", a.id);
    if (!l || !canAccessRecord(user, l)) throw new ConvexError("Ombi la likizo halipatikani.");
    if (l.status !== "pending") throw new ConvexError("Ombi hili limeshaamuliwa.");
    if (l.target && l.createdBy === user._id) throw new ConvexError("Huwezi kuamua ombi lako mwenyewe.");
    const note = a.note?.trim();
    if (!a.approve && (!note || note.length < 3)) throw new ConvexError("Andika sababu ya kukataa ombi.");
    const at = new Date().toISOString();
    await ctx.db.patch("leaveRequests", a.id, { status: a.approve ? "approved" : "rejected", decidedBy: user._id, decidedAt: at, decisionNote: note || undefined, ...(l.viewedAt ? {} : { viewedAt: at, viewedBy: user._id }), ...(l.receivedAt ? {} : { receivedAt: at, receivedBy: user._id }) });
    await logAudit(ctx, user, { action: a.approve ? "approve_leave" : "reject_leave", module: "hr", referenceId: String(a.id) });
    return a.id;
  },
});

export const cancelLeave = mutation({
  args: { id: v.id("leaveRequests") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "hr");
    const l = await ctx.db.get("leaveRequests", a.id);
    if (!l || !canAccessRecord(user, l)) throw new ConvexError("Ombi la likizo halipatikani.");
    if (!["pending", "approved"].includes(l.status)) throw new ConvexError("Ombi hili haliwezi kufutwa.");
    await ctx.db.patch("leaveRequests", a.id, { status: "cancelled" });
    return a.id;
  },
});

export const overview = query({
  args: { date: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "payroll.view", "hr");
    const employees = (await scopedRows(ctx, user, "employees"));
    const active = employees.filter((e) => e.isActive);
    const att = filterScoped(user, await ctx.db.query("attendance").withIndex("by_date", (q) => q.eq("date", a.date)).collect());
    const leaves = (await scopedRows(ctx, user, "leaveRequests"));
    const departments: Record<string, number> = {};
    for (const e of active) departments[e.department?.trim() || "-"] = (departments[e.department?.trim() || "-"] ?? 0) + 1;
    return {
      total: employees.length, active: active.length,
      present: att.filter((r) => r.signInTime).length,
      onLeave: leaves.filter((l) => l.status === "approved" && l.startDate <= a.date && l.endDate >= a.date).length,
      pendingLeave: leaves.filter((l) => l.status === "pending").length,
      departments: Object.entries(departments).map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count),
    };
  },
});

/**
 * Which login belongs to which employee (users.employeeId). A person who has a login and an employee record can then use the
 * Leave module: own timetable, sign-in of the day, and requests that reach the manager / HR.
 */
export const userLinks = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "payroll.view");
    const users = (await businessRows(ctx, user, "users")).filter((u) => u.tokenIdentifier === undefined && (u.username !== undefined || u.email !== undefined) && !isSuperAdmin(u));
    return users.map((u) => ({ _id: u._id, name: u.name ?? u.username ?? "-", username: u.username ?? "", role: u.role ?? "viewer", isActive: u.isActive !== false, employeeId: u.employeeId ?? null }));
  },
});

export const linkUser = mutation({
  args: { employeeId: v.id("employees"), userId: v.optional(v.id("users")) },
  handler: async (ctx, a) => {
    const actor = await requireManager(ctx);
    const e = await ctx.db.get("employees", a.employeeId);
    if (!e || !canAccessRecord(actor, e)) throw new ConvexError("Mfanyakazi hapatikani.");
    const linked = (await businessRows(ctx, actor, "users")).filter((u) => u.employeeId === a.employeeId);
    if (a.userId) {
      const target = await ctx.db.get("users", a.userId);
      if (!target || target.tokenIdentifier !== undefined || target.tenantId !== e.tenantId || isSuperAdmin(target)) throw new ConvexError("Mtumiaji hapatikani.");
      if (target.employeeId && target.employeeId !== a.employeeId) throw new ConvexError("Mtumiaji huyu tayari ameunganishwa na mfanyakazi mwingine.");
    }
    for (const u of linked) if (u._id !== a.userId) await ctx.db.patch("users", u._id, { employeeId: undefined });
    if (a.userId) await ctx.db.patch("users", a.userId, { employeeId: a.employeeId });
    await logAudit(ctx, actor, { action: a.userId ? "link_user_employee" : "unlink_user_employee", module: "hr", referenceId: String(a.employeeId), details: e.name });
    return true;
  },
});
