import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { businessRows, isManagerRole, isSuperAdmin, requireActiveUser, roleHasPermission, scopedRows } from "./access";
import { announcementApplies } from "./announcements";
import { planStatus, tzToday } from "./plans";
import { effectiveModules } from "./permissions";
import { addDaysIso, businessNow, dayRate, dueOn, leaveDates, monthBounds, scheduledDays, toMinutes } from "./attendanceMath";
import type { DaySchedule } from "./attendanceMath";
import { loadClosedDays, loadRule } from "./schedules";

/**
 * Alerts are computed from live data (stock, bills, leave, payroll, support), so they are always current.
 * Only what each user has already read is stored. The client turns `code` + `params` into text in the system language.
 */
export const feed = query({
  args: { today: v.string() },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx);
    const manager = await isManagerRole(ctx, user);
    type Item = { key: string; code: string; level: "danger" | "warning" | "info"; params: Record<string, string | number>; link: string; at: string };
    const items: Item[] = [];
    // Alerts carry business data, so each kind is shown only to users who hold the matching permission (not just the module).
    const canStock = await roleHasPermission(ctx, user, "stock.view");
    const canBills = await roleHasPermission(ctx, user, "accounts.view");

    for (const p of (canStock ? await scopedRows(ctx, user, "products") : [])) {
      if (!p.isActive) continue;
      if (p.currentQty <= 0) items.push({ key: `out:${p._id}`, code: "out_of_stock", level: "danger", params: { name: p.name }, link: "/stock/reports/out-of-stock", at: a.today });
      else if (p.reorderLevel != null && p.currentQty <= p.reorderLevel) items.push({ key: `low:${p._id}:${p.currentQty}`, code: "low_stock", level: "warning", params: { name: p.name, qty: p.currentQty, level: p.reorderLevel }, link: "/stock/reports/reorder", at: a.today });
    }
    const soon = new Date(Date.parse(a.today) + 3 * 86400000).toISOString().slice(0, 10);
    for (const b of (canBills ? await scopedRows(ctx, user, "bills") : [])) {
      if (b.status === "paid" || b.status === "void") continue;
      const due = Math.round((b.amount - b.paidAmount) * 100) / 100;
      if (b.dueDate < a.today) items.push({ key: `billover:${b._id}`, code: "bill_overdue", level: "danger", params: { vendor: b.vendor, bill: b.billNumber, amount: due, due: b.dueDate }, link: "/accounts/expenses", at: b.dueDate });
      else if (b.dueDate <= soon) items.push({ key: `billsoon:${b._id}`, code: "bill_due_soon", level: "warning", params: { vendor: b.vendor, bill: b.billNumber, amount: due, due: b.dueDate }, link: "/accounts/expenses", at: b.dueDate });
    }
    if (manager) {
      for (const p of (await scopedRows(ctx, user, "payrollPeriods")).filter((p) => p.status === "draft"))
        items.push({ key: `payroll:${p._id}`, code: "payroll_draft", level: "info", params: { name: p.name }, link: "/payroll/process", at: p.endDate });
      // Staff attendance: late today, not signed in yet, and confirmed absences of the last 3 days (a whole day's pay is deducted).
      const staff = (await scopedRows(ctx, user, "employees")).filter((e) => e.isActive);
      if (staff.length > 0) {
        const nowB = businessNow();
        const from = addDaysIso(nowB.date, -3);
        const rule = await loadRule(ctx, user.tenantId);
        const closed = await loadClosedDays(ctx, user.tenantId);
        const month = monthBounds(nowB.date);
        const schedules = new Map<string, DaySchedule[]>();
        for (const row of await scopedRows(ctx, user, "workSchedules")) schedules.set(String(row.employeeId), [...(schedules.get(String(row.employeeId)) ?? []), { weekday: row.weekday, isOff: row.isOff, startTime: row.startTime, endTime: row.endTime }]);
        const approved = (await scopedRows(ctx, user, "leaveRequests")).filter((l) => l.status === "approved" && l.endDate >= from && l.startDate <= nowB.date);
        for (const e of staff) {
          const schedule = schedules.get(String(e._id)) ?? [];
          if (schedule.length === 0) continue;
          const rows = await ctx.db.query("attendance").withIndex("by_employee_date", (q) => q.eq("employeeId", e._id).gte("date", from).lte("date", nowB.date)).collect();
          const onLeave = leaveDates(approved.filter((l) => l.employeeId === e._id), from, nowB.date);
          const dayPay = rule.absentEnabled && e.salaryType === "monthly" ? dayRate(e.basicSalary, scheduledDays(schedule, month.start, month.end, closed)) : 0;
          for (let d = from; d <= nowB.date; d = addDaysIso(d, 1)) {
            const due = dueOn(schedule, d, closed);
            if (!due || due === "off" || onLeave.has(d)) continue;
            const rec = rows.find((r) => r.date === d);
            if (rec?.signInTime) {
              if ((rec.lateMinutes ?? 0) > 0 && !rec.lateWaived) items.push({ key: `late:${rec._id}`, code: "staff_late", level: "warning", params: { name: e.name, minutes: rec.lateMinutes ?? 0, amount: rec.lateDeduction ?? 0, start: due.startTime, time: rec.signInTime, date: d }, link: "/payroll/reports/attendance", at: d });
            } else if (d < nowB.date) {
              items.push({ key: `absent:${e._id}:${d}`, code: "staff_absent", level: "danger", params: { name: e.name, date: d, amount: dayPay }, link: "/payroll/reports/attendance", at: d });
            } else if (nowB.minutes > toMinutes(due.startTime)) {
              items.push({ key: `notin:${e._id}:${d}`, code: "staff_not_in", level: "warning", params: { name: e.name, start: due.startTime, amount: dayPay }, link: "/payroll/sign-in", at: d });
            }
          }
        }
      }
      for (const t of (await scopedRows(ctx, user, "supportTickets")).filter((t) => t.status === "open"))
        items.push({ key: `ticket:${t._id}`, code: "ticket_open", level: "info", params: { subject: t.subject, name: t.createdByName }, link: "/help", at: t.createdAt.slice(0, 10) });
    }
    // Leave / permission requests: managers get every one of their business, HR reviewers the ones sent to HR (never their own).
    // The requester is told when his request has been decided.
    const tenantForLeave = user.tenantId ? await ctx.db.get("tenants", user.tenantId as Id<"tenants">) : null;
    const leaveModules = isSuperAdmin(user) ? null : effectiveModules(tenantForLeave?.modules, user.menuAccess);
    const leaveLink = !leaveModules || leaveModules.includes("leave") ? "/leave" : "/hr";
    const reviewsHr = manager || (await roleHasPermission(ctx, user, "leave.review"));
    if (reviewsHr && user.tenantId) {
      const emps = new Map((await scopedRows(ctx, user, "employees")).map((e) => [String(e._id), e.name]));
      for (const l of await businessRows(ctx, user, "leaveRequests")) {
        if (l.status !== "pending" || l.createdBy === user._id || (!manager && l.target === "manager")) continue;
        items.push({ key: `leave:${l._id}`, code: l.lateRequest ? "leave_pending_late" : "leave_pending", level: l.lateRequest ? "warning" : "info", params: { name: emps.get(String(l.employeeId)) ?? "-", from: l.startDate, to: l.endDate }, link: leaveLink, at: l.startDate });
      }
    }
    if (user.employeeId) {
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      for (const l of await ctx.db.query("leaveRequests").withIndex("by_employee", (q) => q.eq("employeeId", user.employeeId as Id<"employees">)).collect()) {
        if ((l.status !== "approved" && l.status !== "rejected") || !l.decidedAt || l.decidedAt < since) continue;
        items.push({ key: `leavedec:${l._id}:${l.decidedAt}`, code: l.status === "approved" ? "leave_approved" : "leave_rejected", level: l.status === "approved" ? "info" : "warning", params: { from: l.startDate, to: l.endDate, note: l.decisionNote ?? "" }, link: leaveModules && !leaveModules.includes("leave") ? "/notifications" : "/leave", at: l.decidedAt.slice(0, 10) });
      }
    }

    // A waiter / waitress is told when the cashier has received (printed) one of his orders.
    const roleName = String(user.role ?? "").toLowerCase();
    if (roleName === "waiter" || roleName === "waitress") {
      const since = new Date(Date.now() - 3 * 86400000).toISOString();
      for (const o of await ctx.db.query("waiterOrders").withIndex("by_waiter", (q) => q.eq("waiterId", user._id)).order("desc").take(50)) {
        if (o.tenantId !== user.tenantId || o.status !== "accepted" || !o.handledAt || o.handledAt < since) continue;
        items.push({ key: `wo:${o._id}`, code: "waiter_order_received", level: "info", params: { customer: o.customerName, table: o.tableNumber ?? "-", orderId: String(o._id) }, link: "/selling-point", at: o.handledAt.slice(0, 10) });
      }
    }
    for (const t of await ctx.db.query("supportTickets").withIndex("by_user", (q) => q.eq("createdBy", user._id)).collect())
      if (t.reply) items.push({ key: `reply:${t._id}:${t.repliedAt}`, code: "ticket_replied", level: "info", params: { subject: t.subject }, link: "/help", at: (t.repliedAt ?? t.createdAt).slice(0, 10) });

    // Subscription reminder: business managers are told every day, from 7 days before the end (demo or paid).
    if (manager && user.tenantId && !isSuperAdmin(user)) {
      const tenant = await ctx.db.get("tenants", user.tenantId as Id<"tenants">);
      const st = planStatus(tenant, tzToday());
      if (tenant && st.expiringSoon)
        items.push({ key: `sub:${st.endsAt}:${st.daysLeft}`, code: st.plan === "demo" ? "demo_expiring" : "sub_expiring", level: (st.daysLeft ?? 0) <= 2 ? "danger" : "warning", params: { days: st.daysLeft ?? 0, date: st.endsAt ?? "" }, link: "/help", at: a.today });
    }
    // Messages sent by the Super Admin to all businesses (or to this one).
    if (!isSuperAdmin(user)) {
      const today = tzToday();
      for (const m of await ctx.db.query("announcements").withIndex("by_active", (q) => q.eq("isActive", true)).collect()) {
        if (m.kind !== "message" || !announcementApplies(m, user.tenantId, today)) continue;
        items.push({ key: `ann:${m._id}`, code: "announcement", level: m.theme === "red" ? "danger" : m.theme === "orange" ? "warning" : "info", params: { title: m.title, body: m.body }, link: "/notifications", at: m.createdAt.slice(0, 10) });
      }
    }

    // Only alerts the user can actually OPEN: an alert pointing to a module this business did not pay for, or that the
    // user's menu hides, would lead to a "module not available" screen (and could never be cleared).
    const tenantDoc = user.tenantId ? await ctx.db.get("tenants", user.tenantId as Id<"tenants">) : null;
    const allowed = isSuperAdmin(user) ? null : effectiveModules(tenantDoc?.modules, user.menuAccess);
    const openable = (link: string) => !allowed || ["notifications", "help", "dashboard"].includes(link.split("/")[1] ?? "") || allowed.includes(link.split("/")[1] ?? "");
    for (let k = items.length - 1; k >= 0; k--) if (!openable(items[k].link)) items.splice(k, 1);

    const reads = new Set((await ctx.db.query("notificationReads").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()).map((r) => r.key));
    const rank = { danger: 0, warning: 1, info: 2 } as const;
    const out = items.map((i) => ({ ...i, read: reads.has(i.key) })).sort((x, y) => Number(x.read) - Number(y.read) || rank[x.level] - rank[y.level] || y.at.localeCompare(x.at));
    return { items: out.slice(0, 200), unread: out.filter((i) => !i.read).length };
  },
});

export const markRead = mutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx);
    const have = new Set((await ctx.db.query("notificationReads").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()).map((r) => r.key));
    for (const key of a.keys.slice(0, 300)) if (key.length > 0 && key.length <= 200 && !have.has(key)) await ctx.db.insert("notificationReads", { userId: user._id, key, readAt: new Date().toISOString() });
    return true;
  },
});
