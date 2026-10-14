import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireActiveUser, requireSuperAdminUser } from "./access";
import { addDays, tzToday } from "./plans";

/**
 * DASHBOARD ROLL-UPS
 * ------------------
 * The dashboard used to read every invoice, purchase and product of the business each time it opened (and again
 * every time anyone made a sale). With many businesses and years of history that is what made it slow.
 *
 * Now the dashboard reads a handful of small pre-computed rows instead:
 *  - statsTotals: receivable / payable (kept exact by the sales + purchasing mutations through `bumpStats`),
 *    stock figures and top products (refreshed in the background, at most every few minutes, by `rebuild`).
 *  - statsDaily : sales / purchases / cash collected per day (kept exact by `bumpStats`).
 * A full recalculation (`rebuild`, mode "full") also runs once for each business that has no roll-ups yet, and every
 * night for businesses that were used recently, so any drift is repaired automatically.
 */

export type StatScope = { tenantId?: Id<"tenants">; branchId?: Id<"branches"> };

const DAILY_SHARDS = 4; // parallel rows per (business, department, day) for live sales counters
const WINDOW_DAYS = 120; // daily rows kept
const STALE_MS = 2 * 60_000; // stock figures / top products are refreshed when older than this
const QUEUE_GUARD_MS = 90_000; // do not queue the same business twice within this time
const PAGE = 1000;
const TOP_KEPT = 10;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sameBranch = (a: unknown, b: unknown) => (a ?? undefined) === (b ?? undefined);
// "none" = records without a department (Convex object keys must not be empty)
const bkey = (branchId: unknown) => (branchId ? String(branchId) : "none");
const unkey = (bk: string) => (bk === "none" ? undefined : (bk as Id<"branches">));

/* ───────────────────────── incremental updates (called by sales / purchasing mutations) ───────────────────────── */

export async function bumpStats(
  ctx: MutationCtx,
  scope: StatScope,
  d: { receivable?: number; payable?: number; date?: string; sales?: number; purchases?: number; collected?: number; invoices?: number },
): Promise<void> {
  const tenantId = scope.tenantId;
  if (!tenantId) return;
  const rows = await ctx.db.query("statsTotals").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
  // Business not initialised yet: the first full rebuild reads the real records, so there is nothing to keep in step.
  if (!rows.length) return;

  if (d.receivable || d.payable) {
    const row = rows.find((r) => sameBranch(r.branchId, scope.branchId));
    if (row) {
      await ctx.db.patch("statsTotals", row._id, { receivable: round2(row.receivable + (d.receivable ?? 0)), payable: round2(row.payable + (d.payable ?? 0)) });
    } else {
      await ctx.db.insert("statsTotals", {
        tenantId, branchId: scope.branchId, receivable: round2(d.receivable ?? 0), payable: round2(d.payable ?? 0),
        productCount: 0, lowStock: 0, outOfStock: 0, inventoryValue: 0, billsDue: 0, topD7: [], topD30: [], topD90: [], refreshedAt: 0,
      });
    }
  }

  if (d.date && (d.sales || d.purchases || d.collected || d.invoices)) {
    // Spread the day's counters over DAILY_SHARDS rows: cashiers selling at the same moment update different rows instead of
    // fighting over one. The dashboard simply adds the rows up; the nightly rebuild merges them again.
    const shard = Math.floor(Math.random() * DAILY_SHARDS);
    const days = await ctx.db.query("statsDaily").withIndex("by_tenant_date_shard", (q) => q.eq("tenantId", tenantId).eq("date", d.date).eq("shard", shard)).collect();
    const day = days.find((r) => sameBranch(r.branchId, scope.branchId));
    if (day) {
      await ctx.db.patch("statsDaily", day._id, {
        sales: round2(day.sales + (d.sales ?? 0)), purchases: round2(day.purchases + (d.purchases ?? 0)),
        collected: round2(day.collected + (d.collected ?? 0)), invoices: day.invoices + (d.invoices ?? 0),
      });
    } else {
      await ctx.db.insert("statsDaily", {
        tenantId, branchId: scope.branchId, date: d.date, shard,
        sales: round2(d.sales ?? 0), purchases: round2(d.purchases ?? 0), collected: round2(d.collected ?? 0), invoices: d.invoices ?? 0,
      });
    }
  }
}

/* ───────────────────────── background refresh ───────────────────────── */

type Day = { bk: string; date: string; sales: number; purchases: number; collected: number; invoices: number };
type Acc = {
  recv: Record<string, number>;
  pay: Record<string, number>;
  daily: Record<string, Day>;
  stock: Record<string, { n: number; low: number; out: number; value: number }>;
  bills: Record<string, number>;
  top: Record<string, { d7: { name: string; total: number }[]; d30: { name: string; total: number }[]; d90: { name: string; total: number }[] }>;
};
const emptyAcc = (): Acc => ({ recv: {}, pay: {}, daily: {}, stock: {}, bills: {}, top: {} });

/** Decides whether this business needs a (re)calculation and queues it. Cheap when everything is fresh. */
export async function ensureFresh(ctx: MutationCtx, tenantId: Id<"tenants">): Promise<"queued" | "fresh" | "refreshing" | "building"> {
  const now = Date.now();
  const job = await ctx.db.query("statsJobs").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).first();
  if (job && now - job.queuedAt < QUEUE_GUARD_MS) return "queued";
  const rows = await ctx.db.query("statsTotals").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
  const initialised = rows.length > 0;
  if (initialised && rows.every((r) => now - r.refreshedAt <= STALE_MS)) return "fresh";
  if (job) await ctx.db.patch("statsJobs", job._id, { queuedAt: now }); else await ctx.db.insert("statsJobs", { tenantId, queuedAt: now });
  await ctx.scheduler.runAfter(0, internal.stats.rebuild, { tenantId, mode: initialised ? "stock" : "full", phase: initialised ? "products" : "invoices", cursor: null, acc: emptyAcc() });
  return initialised ? "refreshing" : "building";
}

/** Called by the dashboard when it opens (and every couple of minutes while it stays open). */
export const touch = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "dashboard");
    if (!user.tenantId) return null;
    return await ensureFresh(ctx, user.tenantId);
  },
});

/** Super Admin: force a full recalculation of one business (use if a number ever looks wrong). */
export const rebuildBusiness = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, a) => {
    await requireSuperAdminUser(ctx);
    const job = await ctx.db.query("statsJobs").withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId)).first();
    if (job) await ctx.db.patch("statsJobs", job._id, { queuedAt: Date.now() }); else await ctx.db.insert("statsJobs", { tenantId: a.tenantId, queuedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.stats.rebuild, { tenantId: a.tenantId, mode: "full", phase: "invoices", cursor: null, acc: emptyAcc() });
    return true;
  },
});

/** Same as `rebuildBusiness`, but callable from other server code (used after Maintenance > Clear Data File). */
export const requestRebuild = internalMutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, a) => {
    const job = await ctx.db.query("statsJobs").withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId)).first();
    if (job) await ctx.db.patch("statsJobs", job._id, { queuedAt: Date.now() }); else await ctx.db.insert("statsJobs", { tenantId: a.tenantId, queuedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.stats.rebuild, { tenantId: a.tenantId, mode: "full", phase: "invoices", cursor: null, acc: emptyAcc() });
    return true;
  },
});

/** Nightly: re-check the exact totals of every business that was used in the last 3 days. */
export const reconcileAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tenants = await ctx.db.query("tenants").withIndex("by_active", (q) => q.eq("isActive", true)).collect();
    const since = Date.now() - 3 * 86_400_000;
    let n = 0;
    for (const t of tenants) {
      const rows = await ctx.db.query("statsTotals").withIndex("by_tenant", (q) => q.eq("tenantId", t._id)).collect();
      if (!rows.some((r) => r.refreshedAt >= since)) continue; // idle business: nothing to repair
      await ctx.scheduler.runAfter(n++ * 4000, internal.stats.rebuild, { tenantId: t._id, mode: "full", phase: "invoices", cursor: null, acc: emptyAcc() });
    }
    return n;
  },
});

/**
 * Recalculates in small steps (each step is its own mutation, so even very large businesses stay inside Convex limits):
 *   invoices -> purchases -> products -> top -> finish
 * mode "stock" skips invoices/purchases and only refreshes stock figures + top products.
 */
export const rebuild = internalMutation({
  args: { tenantId: v.id("tenants"), mode: v.string(), phase: v.string(), cursor: v.union(v.string(), v.null()), acc: v.any() },
  handler: async (ctx, a): Promise<unknown> => {
    const acc = a.acc as Acc;
    const tenantId = a.tenantId;
    const today = tzToday();
    const windowStart = addDays(today, -WINDOW_DAYS);
    const go = (phase: string, cursor: string | null): Promise<unknown> => ctx.scheduler.runAfter(0, internal.stats.rebuild, { tenantId, mode: a.mode, phase, cursor, acc });

    if (a.phase === "invoices") {
      const page = await ctx.db.query("invoices").withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "posted")).paginate({ numItems: PAGE, cursor: a.cursor });
      for (const i of page.page) {
        const bk = bkey(i.branchId);
        acc.recv[bk] = round2((acc.recv[bk] ?? 0) + i.outstanding);
        if (i.invoiceDate >= windowStart) {
          const k = `${bk}|${i.invoiceDate}`;
          const d = (acc.daily[k] ??= { bk, date: i.invoiceDate, sales: 0, purchases: 0, collected: 0, invoices: 0 });
          d.sales = round2(d.sales + i.total); d.collected = round2(d.collected + i.amountPaid); d.invoices += 1;
        }
      }
      return await (page.isDone ? go("purchases", null) : go("invoices", page.continueCursor));
    }

    if (a.phase === "purchases") {
      const page = await ctx.db.query("purchases").withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "posted")).paginate({ numItems: PAGE, cursor: a.cursor });
      for (const p of page.page) {
        const bk = bkey(p.branchId);
        acc.pay[bk] = round2((acc.pay[bk] ?? 0) + p.outstanding);
        if (p.purchaseDate >= windowStart) {
          const k = `${bk}|${p.purchaseDate}`;
          const d = (acc.daily[k] ??= { bk, date: p.purchaseDate, sales: 0, purchases: 0, collected: 0, invoices: 0 });
          d.purchases = round2(d.purchases + p.total);
        }
      }
      return await (page.isDone ? go("products", null) : go("purchases", page.continueCursor));
    }

    if (a.phase === "products") {
      const page = await ctx.db.query("products").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).paginate({ numItems: PAGE, cursor: a.cursor });
      for (const p of page.page) {
        const s = (acc.stock[bkey(p.branchId)] ??= { n: 0, low: 0, out: 0, value: 0 });
        s.value = round2(s.value + (p.weightedAvgCost ?? p.lastPurchaseCost ?? 0) * p.currentQty);
        if (!p.isActive) continue;
        s.n += 1;
        if (p.currentQty <= 0) s.out += 1;
        else if (p.reorderLevel != null && p.currentQty <= p.reorderLevel) s.low += 1;
      }
      if (!page.isDone) return await go("products", page.continueCursor);
      // running costs that are still unpaid (small table)
      for (const b of await ctx.db.query("bills").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect()) {
        if (b.status === "unpaid" || b.status === "partial") acc.bills[bkey(b.branchId)] = round2((acc.bills[bkey(b.branchId)] ?? 0) + b.amount - b.paidAmount);
      }
      return await go("top", null);
    }

    if (a.phase === "top") {
      // Newest 300 posted invoices of the last 90 days (same sample the old dashboard used).
      const since90 = addDays(today, -89), since30 = addDays(today, -29), since7 = addDays(today, -6);
      const recent = (await ctx.db.query("invoices").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).gte("invoiceDate", since90)).order("desc").take(450))
        .filter((i) => i.status === "posted").slice(0, 300);
      const rev: Record<string, { d7: Map<string, number>; d30: Map<string, number>; d90: Map<string, number> }> = {};
      for (const inv of recent) {
        const r = (rev[bkey(inv.branchId)] ??= { d7: new Map(), d30: new Map(), d90: new Map() });
        for (const l of await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id)).collect()) {
          const id = String(l.productId);
          r.d90.set(id, (r.d90.get(id) ?? 0) + l.lineTotal);
          if (inv.invoiceDate >= since30) r.d30.set(id, (r.d30.get(id) ?? 0) + l.lineTotal);
          if (inv.invoiceDate >= since7) r.d7.set(id, (r.d7.get(id) ?? 0) + l.lineTotal);
        }
      }
      const names = new Map<string, string>();
      const nameOf = async (id: string) => {
        if (!names.has(id)) names.set(id, (await ctx.db.get("products", id as Id<"products">))?.name ?? "-");
        return names.get(id)!;
      };
      const best = async (m: Map<string, number>) => {
        const out: { name: string; total: number }[] = [];
        for (const [id, total] of [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, TOP_KEPT)) out.push({ name: await nameOf(id), total: round2(total) });
        return out;
      };
      for (const [bk, r] of Object.entries(rev)) acc.top[bk] = { d7: await best(r.d7), d30: await best(r.d30), d90: await best(r.d90) };
      return await go("finish", null);
    }

    // finish: write the roll-ups
    const now = Date.now();
    const existing = await ctx.db.query("statsTotals").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
    const full = a.mode === "full";
    const keys = new Set<string>([...Object.keys(acc.stock), ...Object.keys(acc.top), ...Object.keys(acc.bills), "none"]);
    if (full) for (const k of [...Object.keys(acc.recv), ...Object.keys(acc.pay)]) keys.add(k);
    for (const r of existing) keys.add(bkey(r.branchId));
    for (const bk of keys) {
      const branchId = unkey(bk);
      const row = existing.find((r) => bkey(r.branchId) === bk);
      const s = acc.stock[bk] ?? { n: 0, low: 0, out: 0, value: 0 };
      const t = acc.top[bk] ?? { d7: [], d30: [], d90: [] };
      const fields = { productCount: s.n, lowStock: s.low, outOfStock: s.out, inventoryValue: round2(s.value), billsDue: round2(acc.bills[bk] ?? 0), topD7: t.d7, topD30: t.d30, topD90: t.d90, refreshedAt: now };
      if (full) {
        const money = { receivable: round2(acc.recv[bk] ?? 0), payable: round2(acc.pay[bk] ?? 0) };
        if (row) await ctx.db.patch("statsTotals", row._id, { ...money, ...fields }); else await ctx.db.insert("statsTotals", { tenantId, branchId, ...money, ...fields });
      } else if (row) {
        await ctx.db.patch("statsTotals", row._id, fields); // receivable / payable are exact already: leave them alone
      } else {
        await ctx.db.insert("statsTotals", { tenantId, branchId, receivable: 0, payable: 0, ...fields });
      }
    }
    if (full) {
      for (const d of await ctx.db.query("statsDaily").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId)).take(4000)) await ctx.db.delete("statsDaily", d._id);
      for (const d of Object.values(acc.daily)) {
        await ctx.db.insert("statsDaily", { tenantId, branchId: unkey(d.bk), date: d.date, sales: d.sales, purchases: d.purchases, collected: d.collected, invoices: d.invoices });
      }
    }
    const job = await ctx.db.query("statsJobs").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).first();
    if (job) await ctx.db.delete("statsJobs", job._id);
    return null;
  },
});
