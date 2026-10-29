import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveUser, isOwnDataOnly, isManagerRole, roleHasPermission, getCompanySettings, filterScoped } from "./access";
import type { UserLike } from "./access";
import { daysBetween } from "./plans";

/**
 * The main dashboard reads only small pre-computed roll-ups (see stats.ts) plus the 5 latest documents,
 * so it opens fast however many invoices, products or businesses exist.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = <K extends string>(rows: Array<Partial<Record<K, number>>>, k: K) => round2(rows.reduce((s: number, r) => s + (r[k] ?? 0), 0));

async function scopedStats(ctx: QueryCtx, user: UserLike) {
  const tenantId = user.tenantId;
  if (!tenantId) return [];
  const rows = await ctx.db.query("statsTotals").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
  return user.branchId ? rows.filter((r) => r.branchId === user.branchId) : rows;
}

/**
 * The business dashboard shows purchases, supplier debt, stock value and totals of everybody, so it is for managers and for people who hold a
 * report permission (e.g. the Accountant). Everyone else (waiter, waitress, cashier ...) gets the personal dashboard with their own sales only.
 */
export async function canSeeBusinessDashboard(ctx: QueryCtx, user: UserLike) {
  if (isOwnDataOnly(user)) return false;
  if (await isManagerRole(ctx, user)) return true;
  for (const p of ["accounts.reports.view", "sales.reports.view", "purchasing.reports.view", "stock.reports.view"]) if (await roleHasPermission(ctx, user, p)) return true;
  return false;
}
async function forbidPersonalOnly(ctx: QueryCtx, user: UserLike) {
  if (!(await canSeeBusinessDashboard(ctx, user))) throw new ConvexError("Forbidden: personal dashboard only");
}

export const getMetrics = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const user = await requireActiveUser(ctx, "dashboard");
    await forbidPersonalOnly(ctx, user);
    const empty = { ready: false, todaySales: 0, todayCash: 0, todayPurchaseTotal: 0, totalOutstandingCustomer: 0, totalOutstandingSupplier: 0, lowStockItems: 0, outOfStockItems: 0, inventoryValue: 0, waiterOwing: 0, waiterOwingOrders: 0, recentInvoices: [] as Doc<"invoices">[], recentPurchases: [] as Doc<"purchases">[], totalProducts: 0 };
    const tenantId = user.tenantId;
    if (!tenantId) return empty;

    const totals = await scopedStats(ctx, user);
    const days = (await ctx.db.query("statsDaily").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).eq("date", args.date)).collect())
      .filter((d) => !user.branchId || d.branchId === user.branchId);

    const recentInvoices = user.branchId
      ? await ctx.db.query("invoices").withIndex("by_scope", (q) => q.eq("tenantId", tenantId).eq("branchId", user.branchId)).order("desc").take(25)
      : await ctx.db.query("invoices").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId)).order("desc").take(25);
    const recentPurchases = user.branchId
      ? await ctx.db.query("purchases").withIndex("by_scope", (q) => q.eq("tenantId", tenantId).eq("branchId", user.branchId)).order("desc").take(25)
      : await ctx.db.query("purchases").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId)).order("desc").take(25);

    // Selling Point orders sent/printed but not yet paid to the cashier: not sales yet, shown separately so nothing looks missing.
    const open = (await ctx.db.query("waiterOrders").withIndex("by_scope_status", (q) => q.eq("tenantId", tenantId)).collect())
      .filter((o) => (!user.branchId || o.branchId === user.branchId) && !o.settledAt && (o.status === "pending" || o.status === "accepted" || o.status === "printed"));
    const posted = <T extends { status?: string }>(rows: T[]) => rows.filter((r) => r.status === undefined || r.status === "posted").slice(0, 5);
    return {
      ready: totals.length > 0,
      todaySales: sum(days, "sales"),
      todayCash: sum(days, "collected"),
      todayPurchaseTotal: sum(days, "purchases"),
      totalOutstandingCustomer: sum(totals, "receivable"),
      totalOutstandingSupplier: sum(totals, "payable"),
      lowStockItems: sum(totals, "lowStock"),
      outOfStockItems: sum(totals, "outOfStock"),
      inventoryValue: sum(totals, "inventoryValue"),
      recentInvoices: posted(recentInvoices),
      recentPurchases: posted(recentPurchases),
      totalProducts: sum(totals, "productCount"),
      waiterOwing: round2(open.reduce((s, o) => s + Math.max(0, o.total - (o.paidAmount ?? 0)), 0)),
      waiterOwingOrders: open.length,
    };
  },
});

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return await getCompanySettings(ctx, user);
  },
});

/** Data for the dashboard graphs: daily trend, top products, stock health and receivables vs payables. */
export const getCharts = query({
  args: { from: v.string(), today: v.string() },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "dashboard");
    await forbidPersonalOnly(ctx, user);
    const tenantId = user.tenantId;
    const noData = { ready: false, daily: [] as Array<{ date: string; sales: number; purchases: number; collected: number; invoices: number }>, topProducts: [] as Array<{ name: string; total: number }>, stockHealth: { ok: 0, low: 0, out: 0 }, receivable: 0, payable: 0, billsDue: 0, totals: { sales: 0, purchases: 0, invoices: 0 } };
    if (!tenantId) return noData;

    const totals = await scopedStats(ctx, user);
    const rows = (await ctx.db.query("statsDaily").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).gte("date", a.from).lte("date", a.today)).collect())
      .filter((d) => !user.branchId || d.branchId === user.branchId);

    const daily = new Map<string, { date: string; sales: number; purchases: number; collected: number; invoices: number }>();
    const span = Math.min(Math.max(daysBetween(a.from, a.today), 0), 366);
    for (let i = 0; i <= span; i++) {
      const d = new Date(Date.parse(a.from) + i * 86400000).toISOString().slice(0, 10);
      daily.set(d, { date: d, sales: 0, purchases: 0, collected: 0, invoices: 0 });
    }
    for (const r of rows) {
      const d = daily.get(r.date) ?? { date: r.date, sales: 0, purchases: 0, collected: 0, invoices: 0 };
      d.sales = round2(d.sales + r.sales); d.purchases = round2(d.purchases + r.purchases); d.collected = round2(d.collected + r.collected); d.invoices += r.invoices;
      daily.set(r.date, d);
    }

    const range = span + 1 <= 7 ? "topD7" : span + 1 <= 30 ? "topD30" : "topD90";
    const merged = new Map<string, number>();
    for (const t of totals) for (const p of t[range]) merged.set(p.name, (merged.get(p.name) ?? 0) + p.total);
    const topProducts = [...merged.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([name, total]) => ({ name, total: round2(total) }));

    const n = sum(totals, "productCount"), out = sum(totals, "outOfStock"), low = sum(totals, "lowStock");
    const list = [...daily.values()].sort((x, y) => x.date.localeCompare(y.date));
    return {
      ready: totals.length > 0,
      daily: list,
      topProducts,
      stockHealth: { ok: Math.max(n - out - low, 0), low, out },
      receivable: sum(totals, "receivable"),
      payable: sum(totals, "payable"),
      billsDue: sum(totals, "billsDue"),
      totals: { sales: sum(list, "sales"), purchases: sum(list, "purchases"), invoices: list.reduce((s, d) => s + d.invoices, 0) },
    };
  },
});

/**
 * Personal dashboard for staff (waiters / cashiers): only the user's OWN sales and bills.
 * Reads that user's invoices of the period through the by_tenant_user_date index, so it stays small and fast.
 */
export const getMyDashboard = query({
  args: { from: v.string(), today: v.string() },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "dashboard");
    if (["waiter", "waitress"].includes(String(user.role ?? "").toLowerCase())) throw new ConvexError("Forbidden: Selling Point staff have no Dashboard access");
    const tenantId = user.tenantId;
    const empty = { today: { sales: 0, collected: 0, outstanding: 0, invoices: 0 }, range: { sales: 0, collected: 0, outstanding: 0, invoices: 0 }, openBills: 0, daily: [] as Array<{ date: string; sales: number; collected: number }>, recent: [] as Array<{ _id: Id<"invoices">; invoiceNo: string; invoiceDate: string; total: number; outstanding: number; paymentStatus: Doc<"invoices">["paymentStatus"]; clientName: string }> };
    if (!tenantId) return empty;

    const mine = filterScoped(user, await ctx.db.query("invoices")
      .withIndex("by_tenant_user_date", (q) => q.eq("tenantId", tenantId).eq("createdBy", user._id).gte("invoiceDate", a.from).lte("invoiceDate", a.today))
      .order("desc").take(1500)).filter((i) => i.status === "posted");

    const daily = new Map<string, { date: string; sales: number; collected: number }>();
    const span = Math.min(Math.max(daysBetween(a.from, a.today), 0), 90);
    for (let i = 0; i <= span; i++) {
      const d = new Date(Date.parse(a.from) + i * 86400000).toISOString().slice(0, 10);
      daily.set(d, { date: d, sales: 0, collected: 0 });
    }
    const today = { sales: 0, collected: 0, outstanding: 0, invoices: 0 };
    const range = { sales: 0, collected: 0, outstanding: 0, invoices: 0 };
    let openBills = 0;
    for (const i of mine) {
      range.sales += i.total; range.collected += i.amountPaid; range.outstanding += i.outstanding; range.invoices += 1;
      if (i.outstanding > 0) openBills += 1;
      if (i.invoiceDate === a.today) { today.sales += i.total; today.collected += i.amountPaid; today.outstanding += i.outstanding; today.invoices += 1; }
      const d = daily.get(i.invoiceDate); if (d) { d.sales = round2(d.sales + i.total); d.collected = round2(d.collected + i.amountPaid); }
    }
    const clientName = new Map<string, string>();
    const recent = [];
    for (const i of [...mine].sort((x, y) => y.invoiceDate.localeCompare(x.invoiceDate) || y._creationTime - x._creationTime).slice(0, 8)) {
      const key = String(i.clientId);
      if (!clientName.has(key)) clientName.set(key, ((await ctx.db.get("clients", i.clientId)) as { name?: string } | null)?.name ?? "—");
      recent.push({ _id: i._id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, total: i.total, outstanding: i.outstanding, paymentStatus: i.paymentStatus, clientName: clientName.get(key)! });
    }
    const r2 = (o: typeof today) => ({ sales: round2(o.sales), collected: round2(o.collected), outstanding: round2(o.outstanding), invoices: o.invoices });
    return { today: r2(today), range: r2(range), openBills, daily: [...daily.values()].sort((x, y) => x.date.localeCompare(y.date)), recent };
  },
});
