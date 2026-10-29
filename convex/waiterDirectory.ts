import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requirePermission, resolveWriteScope } from "./access";

const round = (n: number) => Math.round(n * 100) / 100;
const isWaiterRole = (role?: string) => ["waiter", "waitress"].includes(String(role ?? "").toLowerCase());

/** Cashier / manager only: a waiter's own data stays behind the waiter's personal views. */
async function reviewer(ctx: Parameters<typeof requirePermission>[0]) {
  const user = await requirePermission(ctx, "sales.view", "sales");
  if (isWaiterRole(user.role)) throw new ConvexError("Huna ruhusa ya kuona orodha ya wahudumu.");
  const scope = await resolveWriteScope(ctx, user);
  if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
  return { user, tenantId: scope.tenantId, branchId: scope.branchId };
}

/** Waiters of the caller's business and department only (never another business or branch). */
export const list = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { tenantId, branchId } = await reviewer(ctx);
    const rows = await ctx.db.query("users").withIndex("by_scope", (q) => q.eq("tenantId", tenantId).eq("branchId", branchId)).collect();
    const needle = (args.search ?? "").trim().toLowerCase();
    return rows
      .filter((u) => isWaiterRole(u.role) && u.isActive !== false)
      .filter((u) => !needle || `${u.name ?? ""} ${u.username ?? ""}`.toLowerCase().includes(needle))
      .map((u) => ({ _id: u._id, name: u.name ?? u.username ?? "", username: u.username ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** One waiter's sales, payments, debts and orders for a date range (inclusive, YYYY-MM-DD). Read-only: changes nothing. */
export const summary = query({
  args: { waiterId: v.id("users"), from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const { tenantId, branchId } = await reviewer(ctx);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to) || args.from > args.to) throw new ConvexError("Tarehe si sahihi.");
    const waiter = await ctx.db.get("users", args.waiterId);
    if (!waiter || waiter.tenantId !== tenantId || waiter.branchId !== branchId || !isWaiterRole(waiter.role)) throw new ConvexError("Mhudumu hayupo kwenye biashara au tawi lako.");

    const invoices = await ctx.db.query("invoices")
      .withIndex("by_tenant_user_date", (q) => q.eq("tenantId", tenantId).eq("createdBy", waiter._id).gte("invoiceDate", args.from).lte("invoiceDate", args.to))
      .collect();
    const mine = invoices.filter((i) => i.branchId === branchId);
    const posted = mine.filter((i) => i.status === "posted");
    const sum = (f: (i: (typeof posted)[number]) => number) => round(posted.reduce((n, i) => n + f(i), 0));

    const byMethod: Record<string, number> = {};
    for (const inv of posted) {
      const pays = await ctx.db.query("customerPayments").withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id)).collect();
      for (const p of pays) if (!p.voided) byMethod[p.paymentMethod] = round((byMethod[p.paymentMethod] ?? 0) + p.amount);
    }

    const orders = await ctx.db.query("waiterOrders").withIndex("by_scope_status", (q) => q.eq("tenantId", tenantId).eq("branchId", branchId)).collect();
    const orderCounts: Record<string, number> = {};
    for (const o of orders) {
      if (o.waiterId !== waiter._id) continue;
      const day = new Date(Date.parse(o.createdAt) + 3 * 3600000).toISOString().slice(0, 10); // order time is UTC; business day is East Africa Time
      if (day < args.from || day > args.to) continue;
      orderCounts[o.status] = (orderCounts[o.status] ?? 0) + 1;
    }

    return {
      waiter: { _id: waiter._id as Id<"users">, name: waiter.name ?? waiter.username ?? "" },
      period: { from: args.from, to: args.to },
      invoices: posted.length,
      cancelledInvoices: mine.length - posted.length,
      netSales: sum((i) => i.total),            // invoice totals already reflect discounts and returns
      discounts: sum((i) => i.discount),
      paid: sum((i) => i.amountPaid),
      creditSales: sum((i) => (i.outstanding > 0 ? i.total : 0)),
      customerOutstanding: sum((i) => i.outstanding), // money customers owe the business for this waiter's sales
      paymentsByMethod: byMethod,
      orders: orderCounts,
    };
  },
});

async function waiterInScope(ctx: Parameters<typeof requirePermission>[0], waiterId: Id<"users">) {
  const { tenantId, branchId } = await reviewer(ctx);
  const waiter = await ctx.db.get("users", waiterId);
  if (!waiter || waiter.tenantId !== tenantId || waiter.branchId !== branchId || !isWaiterRole(waiter.role)) throw new ConvexError("Mhudumu hayupo kwenye biashara au tawi lako.");
  return { tenantId, branchId, waiter };
}

/** Invoices created by one waiter in a date range; search by invoice number or customer. Read-only. */
export const invoices = query({
  args: { waiterId: v.id("users"), from: v.string(), to: v.string(), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { tenantId, branchId, waiter } = await waiterInScope(ctx, args.waiterId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to) || args.from > args.to) throw new ConvexError("Tarehe si sahihi.");
    const rows = (await ctx.db.query("invoices")
      .withIndex("by_tenant_user_date", (q) => q.eq("tenantId", tenantId).eq("createdBy", waiter._id).gte("invoiceDate", args.from).lte("invoiceDate", args.to))
      .order("desc").take(300)).filter((i) => i.branchId === branchId);
    const names = new Map<string, string>();
    const out = [];
    for (const i of rows) {
      const key = String(i.clientId);
      if (!names.has(key)) names.set(key, (await ctx.db.get("clients", i.clientId))?.name ?? "");
      out.push({ _id: i._id, invoiceNo: i.invoiceNo, date: i.invoiceDate, clientName: names.get(key) ?? "", total: i.total, amountPaid: i.amountPaid, outstanding: i.outstanding, paymentStatus: i.paymentStatus, status: i.status });
    }
    const needle = (args.search ?? "").trim().toLowerCase();
    return needle ? out.filter((i) => `${i.invoiceNo} ${i.clientName}`.toLowerCase().includes(needle)) : out;
  },
});

/** Payment history of one invoice made by a waiter of the caller's business/branch. Read-only: viewing never changes a balance. */
export const invoicePayments = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const { tenantId, branchId } = await reviewer(ctx);
    const inv = await ctx.db.get("invoices", args.invoiceId);
    if (!inv || inv.tenantId !== tenantId || inv.branchId !== branchId) throw new ConvexError("Invoice haipo kwenye biashara au tawi lako.");
    const creator = await ctx.db.get("users", inv.createdBy);
    if (!creator || !isWaiterRole(creator.role)) throw new ConvexError("Invoice hii si ya mhudumu.");
    const pays = await ctx.db.query("customerPayments").withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id)).collect();
    return pays.filter((p) => !p.voided).map((p) => ({ _id: p._id, date: p.paymentDate, method: p.paymentMethod, amount: p.amount, receiptNo: p.receiptNo ?? "" })).sort((a, b) => a.date.localeCompare(b.date));
  },
});

/**
 * Cashier: find a staff member by the unique staff code set in User Settings, and read that person's sales for the period:
 * invoices (with balances), payments by method, sent bills/orders and the outstanding total. Read-only; same business AND department only.
 * Settlement itself goes through the existing `sales.recordPayment` (cashier/manager only, split payments, journal, stats).
 */
export const byStaffCode = query({
  args: { code: v.string(), from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const { tenantId, branchId } = await reviewer(ctx);
    const code = args.code.trim().toUpperCase();
    if (!code) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to) || args.from > args.to) throw new ConvexError("Tarehe si sahihi.");
    const people = await ctx.db.query("users").withIndex("by_scope", (q) => q.eq("tenantId", tenantId).eq("branchId", branchId)).collect();
    const staff = people.find((u) => u.isActive !== false && (u.staffCode ?? "").toUpperCase() === code);
    if (!staff) return null;

    const rows = (await ctx.db.query("invoices")
      .withIndex("by_tenant_user_date", (q) => q.eq("tenantId", tenantId).eq("createdBy", staff._id).gte("invoiceDate", args.from).lte("invoiceDate", args.to))
      .order("desc").take(500)).filter((i) => i.branchId === branchId);
    const posted = rows.filter((i) => i.status === "posted");
    const names = new Map<string, string>();
    const invoiceRows = [];
    const byMethod: Record<string, number> = {};
    for (const i of posted) {
      const key = String(i.clientId);
      if (!names.has(key)) names.set(key, (await ctx.db.get("clients", i.clientId))?.name ?? "");
      invoiceRows.push({ _id: i._id, invoiceNo: i.invoiceNo, date: i.invoiceDate, clientName: names.get(key) ?? "", total: i.total, amountPaid: i.amountPaid, outstanding: i.outstanding, paymentStatus: i.paymentStatus });
      const pays = await ctx.db.query("customerPayments").withIndex("by_invoice", (q) => q.eq("invoiceId", i._id)).collect();
      for (const p of pays) if (!p.voided) byMethod[p.paymentMethod] = round((byMethod[p.paymentMethod] ?? 0) + p.amount);
    }
    const orders = (await ctx.db.query("waiterOrders").withIndex("by_scope_status", (q) => q.eq("tenantId", tenantId).eq("branchId", branchId)).collect()).filter((o) => {
      if (o.waiterId !== staff._id || o.status === "cancelled" || o.status === "placed") return false;
      const day = new Date(Date.parse(o.createdAt) + 3 * 3600000).toISOString().slice(0, 10); // business day = East Africa Time
      return day >= args.from && day <= args.to;
    });
    const sum = (f: (i: (typeof posted)[number]) => number) => round(posted.reduce((n, i) => n + f(i), 0));
    return {
      staff: { _id: staff._id as Id<"users">, name: staff.name ?? staff.username ?? "", username: staff.username ?? "", staffCode: staff.staffCode ?? "", role: staff.role ?? "" },
      period: { from: args.from, to: args.to },
      totals: { invoices: posted.length, sales: sum((i) => i.total), paid: sum((i) => i.amountPaid), outstanding: sum((i) => i.outstanding) },
      paymentsByMethod: byMethod,
      bills: { count: orders.length, total: round(orders.reduce((n, o) => n + o.total, 0)) },
      invoices: invoiceRows,
    };
  },
});
