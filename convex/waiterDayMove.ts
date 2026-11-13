import { mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { logAudit, normalizeRole, requirePermission, resolveWriteScope } from "./access";
import { assertDate, assertPeriodOpen } from "./ledger";
import { bumpStats } from "./stats";
import { surfaceError } from "./surfaceError";

const eatDay = (iso: string) => new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 10); // East Africa Time business day
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const isWaiter = (role?: string) => ["waiter", "waitress"].includes(normalizeRole(role));
const isSuper = (role?: string) => ["super_admin", "superadmin"].includes(String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"));
const live = (o: Doc<"waiterOrders">) => !o.cancelledAt && (o.status === "pending" || o.status === "accepted" || o.status === "printed");

/** Same clock time, another EAT day (a bill made at 01:10 stays 01:10, but on the chosen day). */
const withDay = (iso: string, day: string) => new Date(Date.parse(`${day}${new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(10)}`) - 3 * 3600000).toISOString();

/**
 * NIGHT SALES (bar / restaurant still open after 00:00): move Selling Point bills to the business day they really belong to,
 * TOGETHER WITH THE MONEY the cashier already received for them.
 *
 * What moves, in one transaction (all or nothing):
 *  - the bills themselves (sales report, dashboard "Today Sales", generate report) and the stock history of those bills;
 *  - every cashier receipt (waiterCollections) that paid them: its day, so CASH / MOBILE / BANK are counted on the sales day
 *    (Sales report "received", dashboard "Cash received", Daily report);
 *  - the ledger journal of those receipts (entryDate) and the daily dashboard counters.
 * Unlike "Edit bill", the payment is NOT given back, so the cash never disappears.
 *
 * Safety: a receipt that also paid bills you did not choose is refused (choose all bills of that receipt); closed accounting periods are
 * refused; a day whose report was already closed (closedAt) is refused; the day can never be in the future.
 * Choosing the day a bill is already on is allowed: it repairs a receipt that was dated on another day.
 */
export const moveToDay = mutation({
  args: { orderIds: v.array(v.id("waiterOrders")), day: v.string() },
  handler: async (ctx, args) => {
    try {
      const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
      if (isWaiter(user.role) || isSuper(user.role)) throw new ConvexError("Cashier au meneja pekee ndiye anaweza kuhamisha siku ya mauzo.");
      const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
      if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
      const tenantId = scope.tenantId;
      const branchId = scope.branchId;

      const day = assertDate(args.day, "Siku ya mauzo");
      const today = eatDay(new Date().toISOString());
      if (day > today) throw new ConvexError("Siku ya mauzo haiwezi kuwa ya baadaye.");
      const ids = [...new Set(args.orderIds.map(String))] as Id<"waiterOrders">[];
      if (!ids.length) throw new ConvexError("Chagua angalau bili moja.");
      if (ids.length > 200) throw new ConvexError("Chagua bili zisizozidi 200 kwa mara moja.");

      const orders: Doc<"waiterOrders">[] = [];
      for (const id of ids) {
        const o = await ctx.db.get("waiterOrders", id);
        if (!o || o.tenantId !== tenantId || (branchId && o.branchId !== branchId)) throw new ConvexError("Bili haipo kwenye biashara au tawi lako.");
        if (!live(o)) throw new ConvexError("Bili iliyofutwa au ambayo haijatumwa haiwezi kuhamishwa.");
        if (o.assignedInvoiceId) throw new ConvexError("Bili hii imeelekezwa kwa mteja kama deni; haiwezi kuhamishwa.");
        if (o.closedAt) throw new ConvexError("Siku ya bili hii ilishafungwa kwenye ripoti (Unda Ripoti ya Siku); haiwezi kuhamishwa.");
        orders.push(o);
      }
      const idSet = new Set(ids.map(String));

      // Receipts that paid these bills (found like the refund code does: one day earlier covers old night receipts dated by the UTC day).
      const oldestOrderDay = orders.map((o) => eatDay(o.createdAt)).sort()[0];
      const rows = await ctx.db.query("waiterCollections").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).gte("date", dayBefore(oldestOrderDay))).collect();
      const receipts = rows.filter((c) => c.orderIds.some((id) => idSet.has(String(id))));
      for (const c of receipts) {
        if (!c.orderIds.every((id) => idSet.has(String(id)))) {
          throw new ConvexError(`Risiti ya ${c.staffName} (${c.date}) pia inalipa bili ambazo hukuzichagua. Chagua bili zote za risiti hiyo ili fedha zihamie pamoja.`);
        }
      }

      // 1) Validate everything first (closed periods), so nothing is half-moved.
      for (const o of orders) {
        const old = eatDay(o.createdAt);
        if (old !== day) { await assertPeriodOpen(ctx, { tenantId, branchId: o.branchId }, old); await assertPeriodOpen(ctx, { tenantId, branchId: o.branchId }, day); }
      }
      const journals: Array<{ entry: Doc<"journalEntries">; collection: Doc<"waiterCollections"> }> = [];
      for (const c of receipts) {
        if (c.date === day) continue;
        await assertPeriodOpen(ctx, { tenantId, branchId: c.branchId }, c.date);
        await assertPeriodOpen(ctx, { tenantId, branchId: c.branchId }, day);
        for (const e of await ctx.db.query("journalEntries").withIndex("by_tenant_ref", (q) => q.eq("tenantId", tenantId).eq("reference", `WSALE-${c._id}`)).collect()) {
          if (e.status === "posted" && e.entryDate !== day) journals.push({ entry: e, collection: c });
        }
      }

      // 2) Move.
      const now = new Date().toISOString();
      let movedOrders = 0;
      for (const o of orders) {
        if (eatDay(o.createdAt) === day) continue;
        await ctx.db.patch("waiterOrders", o._id, { createdAt: withDay(o.createdAt, day), updatedAt: now });
        for (const m of await ctx.db.query("stockMovements").withIndex("by_reference", (q) => q.eq("referenceType", "waiterOrder").eq("referenceId", String(o._id))).collect()) {
          await ctx.db.patch("stockMovements", m._id, { movementDate: day });
        }
        movedOrders++;
      }
      let movedReceipts = 0, movedMoney = 0;
      for (const c of receipts) {
        if (c.date === day) continue;
        const was = c.date;
        await ctx.db.patch("waiterCollections", c._id, { date: day });
        const settled = c.settledCount ?? c.orderIds.length;
        await bumpStats(ctx, { tenantId, branchId: c.branchId }, { date: was, sales: -c.total, collected: -c.total, invoices: -settled });
        await bumpStats(ctx, { tenantId, branchId: c.branchId }, { date: day, sales: c.total, collected: c.total, invoices: settled });
        movedReceipts++; movedMoney += c.total;
      }
      for (const j of journals) await ctx.db.patch("journalEntries", j.entry._id, { entryDate: day });

      await logAudit(ctx, user, {
        action: "move_bills_day", module: "sales", referenceType: "waiterOrder",
        details: `bili ${movedOrders}; risiti ${movedReceipts}; fedha ${Math.round(movedMoney * 100) / 100}; siku mpya ${day}`,
      });
      return { day, orders: movedOrders, receipts: movedReceipts, money: Math.round(movedMoney * 100) / 100 };
    } catch (e) { throw surfaceError(e); }
  },
});
