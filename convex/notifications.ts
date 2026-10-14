import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { isManagerRole, isSuperAdmin, requireActiveUser, scopedRows } from "./access";
import { announcementApplies } from "./announcements";
import { planStatus, tzToday } from "./plans";

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

    for (const p of (await scopedRows(ctx, user, "products"))) {
      if (!p.isActive) continue;
      if (p.currentQty <= 0) items.push({ key: `out:${p._id}`, code: "out_of_stock", level: "danger", params: { name: p.name }, link: "/stock/reports/out-of-stock", at: a.today });
      else if (p.reorderLevel != null && p.currentQty <= p.reorderLevel) items.push({ key: `low:${p._id}:${p.currentQty}`, code: "low_stock", level: "warning", params: { name: p.name, qty: p.currentQty, level: p.reorderLevel }, link: "/stock/reports/reorder", at: a.today });
    }
    const soon = new Date(Date.parse(a.today) + 3 * 86400000).toISOString().slice(0, 10);
    for (const b of (await scopedRows(ctx, user, "bills"))) {
      if (b.status === "paid" || b.status === "void") continue;
      const due = Math.round((b.amount - b.paidAmount) * 100) / 100;
      if (b.dueDate < a.today) items.push({ key: `billover:${b._id}`, code: "bill_overdue", level: "danger", params: { vendor: b.vendor, bill: b.billNumber, amount: due, due: b.dueDate }, link: "/accounts/expenses", at: b.dueDate });
      else if (b.dueDate <= soon) items.push({ key: `billsoon:${b._id}`, code: "bill_due_soon", level: "warning", params: { vendor: b.vendor, bill: b.billNumber, amount: due, due: b.dueDate }, link: "/accounts/expenses", at: b.dueDate });
    }
    if (manager) {
      const emps = new Map((await scopedRows(ctx, user, "employees")).map((e) => [String(e._id), e.name]));
      for (const l of (await scopedRows(ctx, user, "leaveRequests")).filter((l) => l.status === "pending"))
        items.push({ key: `leave:${l._id}`, code: "leave_pending", level: "info", params: { name: emps.get(String(l.employeeId)) ?? "-", from: l.startDate, to: l.endDate }, link: "/hr", at: l.startDate });
      for (const p of (await scopedRows(ctx, user, "payrollPeriods")).filter((p) => p.status === "draft"))
        items.push({ key: `payroll:${p._id}`, code: "payroll_draft", level: "info", params: { name: p.name }, link: "/payroll/process", at: p.endDate });
      for (const t of (await scopedRows(ctx, user, "supportTickets")).filter((t) => t.status === "open"))
        items.push({ key: `ticket:${t._id}`, code: "ticket_open", level: "info", params: { subject: t.subject, name: t.createdByName }, link: "/help", at: t.createdAt.slice(0, 10) });
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
    for (const key of a.keys.slice(0, 300)) if (!have.has(key)) await ctx.db.insert("notificationReads", { userId: user._id, key, readAt: new Date().toISOString() });
    return true;
  },
});
