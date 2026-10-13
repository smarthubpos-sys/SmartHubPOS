import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { logAudit, requireSuperAdminUser } from "./access";
import { applyPlan, planStatus, tzToday } from "./plans";

/** Super Admin: mark a business as demo (3 days) or record a payment (amount + months). */
export const set = mutation({
  args: { tenantId: v.id("tenants"), plan: v.union(v.literal("demo"), v.literal("paid")), months: v.optional(v.number()), amount: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireSuperAdminUser(ctx);
    const result = await applyPlan(ctx, a.tenantId, { plan: a.plan, months: a.months, amount: a.amount, note: a.note }, user._id);
    await logAudit(ctx, user, { action: "set_subscription", module: "super-admin", referenceId: String(a.tenantId), details: `${a.plan} ${a.months ?? ""} ${a.amount ?? ""} -> ${result.endsAt}` });
    return result;
  },
});


/** Super Admin overview: aggregate subscription and recorded-payment figures across businesses. */
export const dashboardSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdminUser(ctx);
    const today = tzToday();
    const tenants = await ctx.db.query("tenants").collect();
    const payments = await ctx.db.query("subscriptionPayments").collect();
    const statuses = tenants.map((tenant) => ({ tenant, status: planStatus(tenant, today) }));
    const monthPrefix = today.slice(0, 7);
    const expiring = statuses
      .filter(({ status }) => status.expiringSoon)
      .sort((a, b) => (a.status.daysLeft ?? 999) - (b.status.daysLeft ?? 999))
      .slice(0, 10)
      .map(({ tenant, status }) => ({ id: tenant._id, name: tenant.name, code: tenant.code, plan: status.plan, endsAt: status.endsAt, daysLeft: status.daysLeft }));
    // Problems the Super Admin should look at: ended subscriptions, ones ending soon, suspended businesses,
    // and businesses whose users hit failed actions in the audit log during the last 24 hours.
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const recent = await ctx.db.query("auditLogs").withIndex("by_timestamp", (q) => q.gte("timestamp", since)).order("desc").take(1000);
    const failures = new Map<string, number>();
    for (const log of recent) if (log.result === "failure" && log.tenantId) failures.set(String(log.tenantId), (failures.get(String(log.tenantId)) ?? 0) + 1);
    type Alert = { key: string; level: "danger" | "warning" | "info"; code: "expired" | "expiring" | "failures" | "suspended"; tenantId: string; name: string; a?: string | number; b?: string | number };
    const alerts: Alert[] = [];
    for (const { tenant, status } of statuses) {
      const id = String(tenant._id);
      if (status.expired) alerts.push({ key: `exp:${id}`, level: "danger", code: "expired", tenantId: id, name: tenant.name, a: status.endsAt });
      else if (status.expiringSoon) alerts.push({ key: `soon:${id}`, level: (status.daysLeft ?? 0) <= 2 ? "danger" : "warning", code: "expiring", tenantId: id, name: tenant.name, a: status.daysLeft, b: status.endsAt });
      if (tenant.isActive === false) alerts.push({ key: `susp:${id}`, level: "info", code: "suspended", tenantId: id, name: tenant.name });
      const failed = failures.get(id) ?? 0;
      if (failed > 0) alerts.push({ key: `fail:${id}`, level: failed >= 10 ? "danger" : "warning", code: "failures", tenantId: id, name: tenant.name, a: failed });
    }
    const rank = { danger: 0, warning: 1, info: 2 } as const;
    alerts.sort((x, y) => rank[x.level] - rank[y.level]);
    const paidByTenant: Record<string, number> = {};
    for (const payment of payments) paidByTenant[String(payment.tenantId)] = (paidByTenant[String(payment.tenantId)] ?? 0) + payment.amount;
    return {
      alerts: alerts.slice(0, 50),
      paidByTenant,
      totalBusinesses: tenants.length,
      activeBusinesses: tenants.filter((tenant) => tenant.isActive !== false).length,
      demoBusinesses: statuses.filter(({ status }) => status.plan === "demo" && !status.expired).length,
      paidBusinesses: statuses.filter(({ status }) => status.plan === "paid").length,
      expiredBusinesses: statuses.filter(({ status }) => status.expired).length,
      expiringBusinesses: statuses.filter(({ status }) => status.expiringSoon).length,
      totalRevenue: payments.reduce((sum, payment) => sum + payment.amount, 0),
      monthRevenue: payments.filter((payment) => payment.createdAt.slice(0, 7) === monthPrefix).reduce((sum, payment) => sum + payment.amount, 0),
      expiring,
    };
  },
});

/** Super Admin: payment history of one business, newest first. */
export const history = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, a) => {
    await requireSuperAdminUser(ctx);
    const tenant = await ctx.db.get(a.tenantId);
    const rows = await ctx.db.query("subscriptionPayments").withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId)).collect();
    return { status: planStatus(tenant, tzToday()), payments: rows.sort((x, y) => y.createdAt.localeCompare(x.createdAt)) };
  },
});
