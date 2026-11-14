import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { normalizeRole, requirePermission } from "./access";
import { waiterOwes } from "./waiterMath";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EAT_MS = 3 * 3600000; // East Africa Time business day
const eatDay = (iso: string) => new Date(Date.parse(iso) + EAT_MS).toISOString().slice(0, 10);
const startIso = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - EAT_MS).toISOString();
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const CAP = 5000;

/**
 * CLOSED WAITER DEBTS for the Sales > Staff Sales Report card.
 * These are the unpaid bills of days whose day report was closed (they no longer show on the cashier's screen).
 * The bills are picked by the day they were SOLD (from..to, East Africa Time). Read-only; money is received with waiterCollections.collect.
 */
export const closedReport = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "sales.view", "sales");
    if (!isDate(a.from) || !isDate(a.to) || a.to < a.from) throw new ConvexError("Tarehe za ripoti si sahihi.");
    const empty = { waiters: [] as Array<{ staffId: Id<"users">; staffName: string; total: number; orders: Array<{ _id: Id<"waiterOrders">; saleDay: string; closedDay: string; tableNumber?: string; orderTotal: number; paid: number; total: number; lines: string }> }>, total: 0, orderCount: 0, canCollect: false, truncated: false };
    if (!user.tenantId) return empty;
    const tenantId = user.tenantId;
    const rows = await ctx.db.query("waiterOrders").withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId).gte("createdAt", startIso(a.from)).lt("createdAt", startIso(addDay(a.to, 1)))).take(CAP + 1);
    const truncated = rows.length > CAP;
    const byWaiter = new Map<string, (typeof empty)["waiters"][number]>();
    for (const o of rows.slice(0, CAP).filter((r) => r.tenantId === tenantId && (!user.branchId || r.branchId === user.branchId))) { // like the cashier screen: the whole business, or only the user's own department
      if (!o.closedAt || o.settledAt || o.cancelledAt || !(o.status === "pending" || o.status === "accepted" || o.status === "printed")) continue;
      const left = r2(waiterOwes(o)); // what the waiter still owes for this bill
      if (left <= 0) continue;
      const k = String(o.waiterId);
      const cur = byWaiter.get(k) ?? { staffId: o.waiterId, staffName: o.waiterName, total: 0, orders: [] };
      cur.total = r2(cur.total + left);
      cur.orders.push({ _id: o._id, saleDay: eatDay(o.createdAt), closedDay: eatDay(o.closedAt), tableNumber: o.tableNumber, orderTotal: o.total, paid: r2(o.paidAmount ?? 0), total: left, lines: o.lines.map((l) => `${l.productName}×${l.qty}`).join(", ") });
      byWaiter.set(k, cur);
    }
    const waiters = [...byWaiter.values()].map((w) => ({ ...w, orders: w.orders.sort((x, y) => x.saleDay.localeCompare(y.saleDay) || String(x._id).localeCompare(String(y._id))) })).sort((x, y) => x.staffName.localeCompare(y.staffName));
    // Only the cashier receives money (the same rule as the cashier screen); everybody else with Sales access can read and print.
    const role = normalizeRole(user.role);
    const canCollect = !["waiter", "waitress", "super_admin", "superadmin"].includes(role) && await requirePermission(ctx, "waiterOrders.manage", "waiterOrders").then(() => true, () => false);
    return { waiters, total: r2(waiters.reduce((n, w) => n + w.total, 0)), orderCount: waiters.reduce((n, w) => n + w.orders.length, 0), canCollect, truncated };
  },
});
