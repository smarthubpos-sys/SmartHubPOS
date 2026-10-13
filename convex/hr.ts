import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { canAccessRecord, filterScoped, logAudit, requireActiveUser, requireManager, scopedRows } from "./access";

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
    const e = await ctx.db.get(id);
    if (!e || !canAccessRecord(user, e)) throw new Error("Mfanyakazi hapatikani.");
    if (!data.name.trim() || !Number.isFinite(data.basicSalary) || data.basicSalary < 0) throw new Error("Jina na mshahara halali vinahitajika.");
    if (!["monthly", "daily", "hourly"].includes(data.salaryType)) throw new Error("Aina ya mshahara si sahihi.");
    await ctx.db.patch(id, { ...data, name: data.name.trim() });
    await logAudit(ctx, user, { action: "modify_employee", module: "hr", referenceId: String(id), details: data.name });
    return id;
  },
});

export const listLeave = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "hr");
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
    const e = await ctx.db.get(a.employeeId);
    if (!e || !canAccessRecord(user, e)) throw new Error("Mfanyakazi hapatikani.");
    if (!TYPES.includes(a.leaveType)) throw new Error("Aina ya likizo si sahihi.");
    if (a.endDate < a.startDate) throw new Error("Tarehe ya mwisho lazima iwe baada ya ya mwanzo.");
    const overlap = (await ctx.db.query("leaveRequests").withIndex("by_employee", (q) => q.eq("employeeId", a.employeeId)).collect())
      .some((l) => ["pending", "approved"].includes(l.status) && l.startDate <= a.endDate && l.endDate >= a.startDate);
    if (overlap) throw new Error("Mfanyakazi ana likizo nyingine kwenye tarehe hizi.");
    const id = await ctx.db.insert("leaveRequests", { tenantId: e.tenantId, branchId: e.branchId, employeeId: a.employeeId, leaveType: a.leaveType, startDate: a.startDate, endDate: a.endDate, days: days(a.startDate, a.endDate), reason: a.reason, status: "pending", createdBy: user._id });
    await logAudit(ctx, user, { action: "request_leave", module: "hr", referenceId: String(id), details: `${e.name} ${a.startDate}..${a.endDate}` });
    return id;
  },
});

export const decideLeave = mutation({
  args: { id: v.id("leaveRequests"), approve: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "hr");
    const l = await ctx.db.get(a.id);
    if (!l || !canAccessRecord(user, l)) throw new Error("Ombi la likizo halipatikani.");
    if (l.status !== "pending") throw new Error("Ombi hili limeshaamuliwa.");
    await ctx.db.patch(a.id, { status: a.approve ? "approved" : "rejected", decidedBy: user._id, decidedAt: new Date().toISOString(), decisionNote: a.note });
    await logAudit(ctx, user, { action: a.approve ? "approve_leave" : "reject_leave", module: "hr", referenceId: String(a.id) });
    return a.id;
  },
});

export const cancelLeave = mutation({
  args: { id: v.id("leaveRequests") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "hr");
    const l = await ctx.db.get(a.id);
    if (!l || !canAccessRecord(user, l)) throw new Error("Ombi la likizo halipatikani.");
    if (!["pending", "approved"].includes(l.status)) throw new Error("Ombi hili haliwezi kufutwa.");
    await ctx.db.patch(a.id, { status: "cancelled" });
    return a.id;
  },
});

export const overview = query({
  args: { date: v.string() },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "hr");
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
