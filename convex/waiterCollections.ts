import { mutation, query, type MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { logAudit, normalizeRole, requirePermission, resolveWriteScope } from "./access";
import { normaliseSplits, splitValidator } from "./paymentMethods";
import { bumpStats } from "./stats";
import { assertPeriodOpen, getSystemAccount, methodAccount, postSystemJournal } from "./ledger";
import { surfaceError } from "./surfaceError";
import { deductStockOnce } from "./waiterOrders";
import { waiterOrdersAllowedFor } from "./waiterSettings";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isWaiter = (role?: string) => ["waiter", "waitress"].includes(normalizeRole(role));
const eatDay = (iso: string) => new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 10); // East Africa Time business day
/** Orders whose money the cashier can still receive: sent / received / printed, not cancelled, not yet settled. */
const collectable = (o: Doc<"waiterOrders">) => !o.settledAt && (o.status === "pending" || o.status === "accepted" || o.status === "printed");
/** What the waiter still owes for an order (a partly paid order owes less than its total). */
const remainingOf = (o: Doc<"waiterOrders">) => Math.max(0, r2(o.total - (o.paidAmount ?? 0)));

async function cashierScope(ctx: Parameters<typeof requirePermission>[0]) {
  const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
  if (isWaiter(user.role) || ["super_admin", "superadmin"].includes(String(user.role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"))) throw new ConvexError("Cashier pekee ndiye anayepokea fedha za wahudumu.");
  const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
  if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
  return { user, tenantId: scope.tenantId, branchId: scope.branchId };
}
const inScope = (branchId: Id<"branches"> | undefined, o: Doc<"waiterOrders">) => !branchId || o.branchId === branchId;

/** Cost of the goods of one order = what its stock movements took out of the shelf (minus what a cancel put back), at the cost recorded then. */
async function orderCost(ctx: MutationCtx, orderId: Id<"waiterOrders">): Promise<number> {
  const moves = await ctx.db.query("stockMovements").withIndex("by_reference", (q) => q.eq("referenceType", "waiterOrder").eq("referenceId", String(orderId))).collect();
  return r2(moves.reduce((n, m) => n + (m.qtyOut - m.qtyIn) * (m.unitCost ?? 0), 0));
}

/**
 * Books a cashier's receipt of waiter money in the ledger, so Profit & Loss, Cash flow, Period reports, Trial balance and the Balance sheet
 * agree with the Dashboard and with Stock (the stock of these orders already left the shelf when the waiter sent / printed them):
 *   Dr  money account of each payment method      Cr  Sales revenue (4000)
 *   Dr  Cost of goods sold (5000)                 Cr  Inventory (1200)
 * Orders of different departments are booked in their own department; the payment methods are shared out in proportion.
 * Safe to call twice: the journal is found again by its reference and is never duplicated.
 */
async function postCollectionJournal(
  ctx: MutationCtx,
  a: { collectionId: Id<"waiterCollections">; userId: Id<"users">; date: string; staffName: string; orders: Doc<"waiterOrders">[]; splits: Array<{ method: string; methodId?: Id<"paymentMethods">; amount: number }>; alloc?: Map<string, number> },
) {
  // Partial payment: only the part of each order that was really paid at this receipt is booked (revenue and cost of goods in the same proportion).
  const amt = (o: Doc<"waiterOrders">) => a.alloc?.get(String(o._id)) ?? o.total;
  const total = r2(a.orders.reduce((n, o) => n + amt(o), 0));
  if (total <= 0 || !a.orders.length) return;
  const tenantId = a.orders[0].tenantId;
  const groups = new Map<string, { branchId?: Id<"branches">; orders: Doc<"waiterOrders">[]; total: number }>();
  for (const o of a.orders) {
    const k = String(o.branchId ?? "");
    const g = groups.get(k) ?? { branchId: o.branchId, orders: [], total: 0 };
    g.orders.push(o); g.total = r2(g.total + amt(o)); groups.set(k, g);
  }
  const remaining = a.splits.map((s) => s.amount);
  const list = [...groups.values()];
  for (const g of list) await assertPeriodOpen(ctx, { tenantId, branchId: g.branchId }, a.date); // refuse before writing anything, so a receipt is never booked half-way
  for (let gi = 0; gi < list.length; gi++) {
    const g = list[gi];
    const last = gi === list.length - 1;
    const amts = last ? [...remaining] : a.splits.map((s) => r2((s.amount * g.total) / total));
    if (!last) { // make this department's money add up to exactly its sales, then carry the rest forward
      const diff = r2(g.total - amts.reduce((n, x) => n + x, 0));
      if (diff !== 0) { let big = 0; amts.forEach((x, i) => { if (x > amts[big]) big = i; }); amts[big] = r2(amts[big] + diff); }
    }
    amts.forEach((x, i) => { remaining[i] = r2(remaining[i] - x); });
    const scope = { tenantId, branchId: g.branchId };
    let cost = 0;
    for (const o of g.orders) cost += o.total > 0 ? (await orderCost(ctx, o._id)) * Math.min(1, amt(o) / o.total) : 0;
    cost = r2(cost);
    const revenue = await getSystemAccount(ctx, scope, "4000", "Sales revenue", "revenue");
    const cogs = await getSystemAccount(ctx, scope, "5000", "Cost of goods sold", "expense");
    const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
    const lines: Array<{ accountId: Id<"accounts">; debit: number; credit: number; description: string }> = [];
    for (let i = 0; i < a.splits.length; i++) {
      if (amts[i] <= 0) continue;
      lines.push({ accountId: await methodAccount(ctx, scope, { methodId: a.splits[i].methodId, method: a.splits[i].method }), debit: amts[i], credit: 0, description: `Money received from ${a.staffName} - ${a.splits[i].method}` });
    }
    lines.push({ accountId: revenue, debit: 0, credit: g.total, description: "Selling Point sales revenue" });
    lines.push({ accountId: cogs, debit: cost, credit: 0, description: "Cost of goods sold" });
    lines.push({ accountId: inventory, debit: 0, credit: cost, description: "Inventory relieved" });
    await postSystemJournal(ctx, { scope, userId: a.userId, date: a.date, reference: `WSALE-${a.collectionId}`, description: `Selling Point receipt from ${a.staffName} (${g.orders.length} order${g.orders.length === 1 ? "" : "s"})`, sourceType: "waiter_sale", sourceId: String(a.collectionId), lines });
  }
}

/** Waiters who still owe money to the cashier: their unsettled orders and the total. Read-only. */
export const owing = query({
  args: {},
  handler: async (ctx) => {
    const { tenantId, branchId } = await cashierScope(ctx).catch((e) => { throw surfaceError(e); });
    const rows = (await ctx.db.query("waiterOrders").withIndex("by_scope_status", (q) => q.eq("tenantId", tenantId)).collect()).filter((o) => inScope(branchId, o) && collectable(o));
    const byWaiter = new Map<string, { staffId: Id<"users">; staffName: string; total: number; orders: Array<{ _id: Id<"waiterOrders">; createdAt: string; tableNumber?: string; total: number; orderTotal: number; paid: number; lines: string }> }>();
    for (const o of rows) {
      const k = String(o.waiterId);
      const cur = byWaiter.get(k) ?? { staffId: o.waiterId, staffName: o.waiterName, total: 0, orders: [] };
      const left = remainingOf(o); // `total` of a row = what is STILL owed (full total when nothing was paid yet)
      if (left <= 0) continue;
      cur.total = r2(cur.total + left);
      cur.orders.push({ _id: o._id, createdAt: o.createdAt, tableNumber: o.tableNumber, total: left, orderTotal: o.total, paid: r2(o.paidAmount ?? 0), lines: o.lines.map((l) => `${l.productName}×${l.qty}`).join(", ") });
      byWaiter.set(k, cur);
    }
    const list = [...byWaiter.values()].map((w) => ({ ...w, orders: w.orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) })).sort((a, b) => a.staffName.localeCompare(b.staffName));
    return list;
  },
});

/**
 * Receive money of the chosen orders from one waiter. The amount may be LESS than what is due (the waiter hands over only what he has in hand):
 * the money is shared over the orders oldest first, fully paid orders are marked settled, and the rest stays owed by the waiter (debt).
 * The amount can never be zero or more than what is due. Orders are never deleted.
 */
export const collect = mutation({
  args: { staffId: v.id("users"), orderIds: v.array(v.id("waiterOrders")), splits: v.array(splitValidator) },
  handler: async (ctx, args) => {
    try {
      const { user, tenantId, branchId } = await cashierScope(ctx);
      const ids = [...new Set(args.orderIds.map(String))] as Id<"waiterOrders">[];
      if (!ids.length) throw new ConvexError("Chagua angalau oda moja.");
      const orders: Doc<"waiterOrders">[] = [];
      for (const id of ids) {
        const o = await ctx.db.get("waiterOrders", id);
        if (!o || o.tenantId !== tenantId || !inScope(branchId, o)) throw new ConvexError("Oda haipo kwenye biashara au tawi lako.");
        if (o.waiterId !== args.staffId) throw new ConvexError("Oda zote lazima ziwe za mhudumu mmoja.");
        if (!collectable(o)) throw new ConvexError("Oda moja tayari imelipwa au haiwezi kulipwa.");
        orders.push(o);
      }
      orders.sort((x, y) => x.createdAt.localeCompare(y.createdAt)); // oldest order is paid first
      const due = r2(orders.reduce((s, o) => s + remainingOf(o), 0));
      const { splits, total: paid } = await normaliseSplits(ctx, user, args.splits);
      if (paid <= 0.005) throw new ConvexError("Weka kiasi kilichopokelewa (zaidi ya sifuri).");
      if (paid - due > 0.005) throw new ConvexError(`Kiasi kilichopokelewa (${paid}) kimezidi deni la oda (${due}).`);
      const alloc = new Map<string, number>();
      let left = paid;
      for (const o of orders) {
        const give = r2(Math.min(left, remainingOf(o)));
        if (give > 0.005) { alloc.set(String(o._id), give); left = r2(left - give); }
      }
      const touched = orders.filter((o) => alloc.has(String(o._id)));
      const fullyPaid = touched.filter((o) => remainingOf(o) - (alloc.get(String(o._id)) ?? 0) <= 0.005);
      const shortfall = r2(due - paid);
      const staff = await ctx.db.get("users", args.staffId);
      const staffName = staff?.name ?? staff?.username ?? orders[0].waiterName;
      const now = new Date().toISOString();
      const date = eatDay(now);
      const collectionId = await ctx.db.insert("waiterCollections", {
        tenantId, branchId, staffId: args.staffId, staffName,
        cashierId: user._id, cashierName: user.name ?? user.username ?? "cashier", date, total: paid, splits, orderIds: touched.map((o) => o._id), createdAt: now,
        allocations: touched.map((o) => ({ orderId: o._id, amount: alloc.get(String(o._id))! })), settledCount: fullyPaid.length, shortfall,
      });
      const fullIds = new Set(fullyPaid.map((o) => String(o._id)));
      for (const o of touched) {
        const paidNow = r2((o.paidAmount ?? 0) + alloc.get(String(o._id))!);
        await ctx.db.patch("waiterOrders", o._id, fullIds.has(String(o._id)) ? { paidAmount: paidNow, settledAt: now, collectionId, updatedAt: now } : { paidAmount: paidNow, updatedAt: now });
      }
      await postCollectionJournal(ctx, { collectionId, userId: user._id, date, staffName, orders: touched, splits, alloc });
      // Dashboard: the cash is counted once, on the day the cashier receives it (see stats.rebuild "waiter" phase). Orders count as sales when fully paid.
      await bumpStats(ctx, { tenantId, branchId }, { date, sales: paid, collected: paid, invoices: fullyPaid.length });
      await logAudit(ctx, user, { action: "collect_waiter_money", module: "sales", referenceId: String(collectionId), referenceType: "waiterCollection", details: `${staffName}; oda ${touched.length}; zilizopokelewa ${paid}${shortfall > 0 ? `; deni lililobaki ${shortfall}` : ""}` });
      return { collectionId, total: paid, orders: touched.length, due, debt: shortfall };
    } catch (e) { throw surfaceError(e); }
  },
});

/**
 * COUNTER SALE: the cashier sells to his own walk-in customer and receives the money in the same step.
 * One safe mutation: creates the order, takes the stock out ONCE, records the payment and books the sale (ledger + dashboard) exactly like
 * a receipt of waiter money. The order is born settled, so it never shows up as money owed by anybody.
 * `clientKey` (one per cart) makes a double tap / retry return the SAME sale instead of a second one.
 */
export const counterSale = mutation({
  args: {
    clientKey: v.string(),
    customerName: v.optional(v.string()),
    tableNumber: v.optional(v.string()),
    lines: v.array(v.object({ productId: v.id("products"), qty: v.number() })),
    splits: v.array(splitValidator),
  },
  handler: async (ctx, args) => {
    try {
      const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
      if (isWaiter(user.role) || [ "super_admin", "superadmin" ].includes(normalizeRole(user.role))) throw new ConvexError("Mauzo ya counter ni ya cashier pekee.");
      const scope = await resolveWriteScope(ctx, user);
      if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
      const tenantId = scope.tenantId;
      const key = args.clientKey.trim();
      if (key.length < 8 || key.length > 80) throw new ConvexError("Ombi si sahihi. Fungua ukurasa upya.");
      const existing = await ctx.db.query("waiterOrders").withIndex("by_client_key", (q) => q.eq("waiterId", user._id).eq("clientKey", key)).first();
      if (existing) return { orderId: existing._id, collectionId: existing.collectionId ?? null, total: existing.total, duplicate: true };
      const settings = await ctx.db.query("tenantSettings").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).first();
      if (!waiterOrdersAllowedFor(user.role, settings)) throw new ConvexError("Selling Point imezimwa kwa biashara hii.");
      if (args.lines.length === 0) throw new ConvexError("Ongeza angalau bidhaa moja.");

      const merged = new Map<string, number>(); // the same product tapped many times = one line
      for (const l of args.lines) {
        if (!Number.isFinite(l.qty) || l.qty <= 0) throw new ConvexError("Kiasi cha bidhaa lazima kiwe zaidi ya sifuri.");
        merged.set(String(l.productId), (merged.get(String(l.productId)) ?? 0) + l.qty);
      }
      const lines = [];
      for (const [pid, qty] of merged) {
        const product = await ctx.db.get("products", pid as Id<"products">);
        if (!product || product.isActive === false) throw new ConvexError("Bidhaa haipo au haifanyi kazi.");
        if (product.tenantId !== tenantId || (scope.branchId && product.branchId && product.branchId !== scope.branchId)) throw new ConvexError("Huna ruhusa ya kutumia bidhaa hiyo kwenye tawi hili.");
        if (!Number.isFinite(product.sellingPrice) || product.sellingPrice < 0) throw new ConvexError("Bei ya bidhaa si sahihi.");
        lines.push({ productId: product._id, productName: product.name, qty, unitPrice: product.sellingPrice, lineTotal: r2(qty * product.sellingPrice) });
      }
      const total = r2(lines.reduce((n, l) => n + l.lineTotal, 0));
      const { splits, total: paid } = await normaliseSplits(ctx, user, args.splits);
      if (Math.abs(paid - total) > 0.005) throw new ConvexError(`Kiasi kilichopokelewa (${paid}) lazima kilingane na jumla ya mauzo (${total}).`);

      const now = new Date().toISOString();
      const date = eatDay(now);
      const staffName = user.name ?? user.username ?? "cashier";
      const orderId = await ctx.db.insert("waiterOrders", {
        tenantId, branchId: scope.branchId,
        customerName: args.customerName?.trim() || "Mteja wa counter",
        tableNumber: args.tableNumber?.trim() || undefined,
        waiterId: user._id, waiterName: staffName,
        status: "accepted", stockDeducted: false, clientKey: key, lines, total,
        createdAt: now, updatedAt: now, sentAt: now,
      });
      const order = (await ctx.db.get("waiterOrders", orderId))!;
      await deductStockOnce(ctx, order, user, { tenantId, branchId: scope.branchId }); // throws -> everything rolls back: no sale, no stock change, no money
      const collectionId = await ctx.db.insert("waiterCollections", {
        tenantId, branchId: scope.branchId, staffId: user._id, staffName,
        cashierId: user._id, cashierName: staffName, date, total, splits, orderIds: [orderId], createdAt: now,
      });
      await ctx.db.patch("waiterOrders", orderId, { settledAt: now, collectionId, updatedAt: now });
      const settled = (await ctx.db.get("waiterOrders", orderId))!;
      await postCollectionJournal(ctx, { collectionId, userId: user._id, date, staffName, orders: [settled], splits });
      await bumpStats(ctx, { tenantId, branchId: scope.branchId }, { date, sales: total, collected: total, invoices: 1 });
      await logAudit(ctx, user, { action: "counter_sale", module: "sales", referenceId: String(collectionId), referenceType: "waiterCollection", details: `counter; jumla ${total}; stock imepunguzwa mara moja` });
      return { orderId, collectionId, total, duplicate: false };
    } catch (e) { throw surfaceError(e); }
  },
});

/** Today's receipts (or a chosen day) for the cashier. Read-only. */
export const receipts = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const { tenantId, branchId } = await cashierScope(ctx).catch((e) => { throw surfaceError(e); });
    const rows = (await ctx.db.query("waiterCollections").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).eq("date", args.date)).collect()).filter((c) => !branchId || c.branchId === branchId);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => ({ _id: c._id, staffName: c.staffName, cashierName: c.cashierName, total: c.total, debt: c.shortfall ?? 0, orders: c.orderIds.length, createdAt: c.createdAt, methods: c.splits.map((s) => `${s.method} ${s.amount}`).join(" + "), splits: c.splits.map((s) => ({ method: s.method, amount: s.amount })) }));
  },
});

/**
 * One-time repair for receipts taken BEFORE waiter sales were booked in the ledger: books the missing journals (revenue, cash, cost of goods, inventory).
 * Already-booked receipts are skipped, so it is safe to press more than once. Closed financial periods are left alone and counted in `skipped`.
 */
export const bookMissingJournals = mutation({
  args: {},
  handler: async (ctx) => {
    try {
      const user = await requirePermission(ctx, "accounts.manage", "accounts");
      const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
      if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
      const tenantId = scope.tenantId;
      const rows = await ctx.db.query("waiterCollections").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId)).take(300);
      let booked = 0, skipped = 0;
      for (const c of rows) {
        if (scope.branchId && c.branchId !== scope.branchId) continue;
        const done = (await ctx.db.query("journalEntries").withIndex("by_tenant_ref", (q) => q.eq("tenantId", tenantId).eq("reference", `WSALE-${c._id}`)).first());
        if (done) continue;
        const orders: Doc<"waiterOrders">[] = [];
        for (const id of c.orderIds) { const o = await ctx.db.get("waiterOrders", id); if (o) orders.push(o); }
        const alloc = c.allocations ? new Map(c.allocations.map((x) => [String(x.orderId), x.amount] as const)) : undefined;
        try {
          await postCollectionJournal(ctx, { collectionId: c._id, userId: user._id, date: c.date, staffName: c.staffName, orders, splits: c.splits, alloc });
          booked++;
        } catch { skipped++; }
      }
      await logAudit(ctx, user, { action: "book_waiter_journals", module: "accounts", details: `${booked} receipt(s) booked, ${skipped} skipped` });
      return { booked, skipped };
    } catch (e) { throw surfaceError(e); }
  },
});
