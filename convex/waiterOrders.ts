import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { surfaceError } from "./surfaceError";
import type { Doc, Id } from "./_generated/dataModel";
import { getCompanySettings, logAudit, normalizeRole, requirePermission, resolveWriteScope, roleHasPermission } from "./access";
import { waiterOrdersAllowedFor } from "./waiterSettings";


// Normalised like everywhere else (case / spaces / hyphens): a role label such as "Waitress " must still be limited to its OWN orders.
const isWaiter = (role?: string) => ["waiter", "waitress"].includes(normalizeRole(role));
/** Super Admin administers businesses; he is NOT a cashier. Orders sent by waiters must never land in his queue, and he cannot receive them. */
const isSuper = (role?: string) => ["super_admin", "superadmin"].includes(String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"));

/**
 * Deducts the stock of an order EXACTLY ONCE. The guard is the order's own `stockDeducted` flag, read and written inside the same
 * mutation (Convex mutations are serialised per document), so a double tap, a retry or two devices can never deduct twice.
 * Send and Print both come through here; the cashier's receive/print (markHandled) never does.
 */
async function deductStockOnce(
  ctx: MutationCtx,
  order: Doc<"waiterOrders">,
  user: Doc<"users">,
  scope: { tenantId?: Id<"tenants">; branchId?: Id<"branches"> },
): Promise<boolean> {
  const fresh = await ctx.db.get("waiterOrders", order._id);
  if (!fresh || fresh.stockDeducted === true) return false; // already deducted: nothing to do
  const company = await getCompanySettings(ctx, user);
  const allowNegativeStock = !!company?.allowNegativeStock;
  const need = new Map<string, number>();
  for (const line of fresh.lines) need.set(String(line.productId), (need.get(String(line.productId)) ?? 0) + line.qty);
  // 1) check everything first, so a shortage on the last line leaves the earlier lines untouched
  for (const [pid, qty] of need) {
    const product = await ctx.db.get("products", pid as Id<"products">);
    if (
  !product ||
  product.tenantId !== scope.tenantId ||
  (scope.branchId &&
    product.branchId &&
    product.branchId !== scope.branchId)
) {
  throw new Error("Bidhaa haipo kwenye biashara au tawi hili.");
}
    if (!allowNegativeStock && product.currentQty + 1e-8 < qty) throw new Error(`Stock haitoshi kwa ${product.name}. Iliyopo: ${product.currentQty}, inayohitajika: ${qty}`);
  }
  const now = new Date().toISOString();
  for (const [pid, qty] of need) {
    const product = (await ctx.db.get("products", pid as Id<"products">))!;
    const balance = product.currentQty - qty;
    await ctx.db.patch("products", product._id, { currentQty: balance });
    await ctx.db.insert("stockMovements", {
      ...scope,
      movementDate: now.slice(0, 10),
      productId: product._id,
      movementType: "waiter_order",
      referenceId: String(fresh._id),
      referenceType: "waiterOrder",
      qtyIn: 0,
      qtyOut: qty,
      runningBalance: balance,
      unitCost: product.weightedAvgCost ?? product.lastPurchaseCost ?? 0,
      createdBy: user._id,
    });
  }
  await ctx.db.patch("waiterOrders", fresh._id, { stockDeducted: true, stockDeductedAt: now, updatedAt: now });
  return true;
}

/**
 * Who sees which orders. A waiter is tied to his own department. A cashier / manager who works in one department sees that
 * department's orders; one who has not picked a department (or works across all) sees the orders of every department of the
 * business. Business isolation is never relaxed. Before this, a cashier on another department than the waiter saw nothing
 * while the Super Admin (on the waiter's department) received every order.
 */
type ScopeLike = { tenantId?: Id<"tenants">; branchId?: Id<"branches"> };
async function viewScope(ctx: Parameters<typeof resolveWriteScope>[0], user: Parameters<typeof resolveWriteScope>[1]): Promise<ScopeLike> {
  return isWaiter(user.role) ? await resolveWriteScope(ctx, user) : await resolveWriteScope(ctx, user, { tenantWide: true });
}
const orderInScope = (user: { role?: string }, scope: ScopeLike, o: { tenantId?: Id<"tenants">; branchId?: Id<"branches"> }) =>
  o.tenantId === scope.tenantId && (isWaiter(user.role) || !scope.branchId || o.branchId === scope.branchId);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "waiterOrders.view", "waiterOrders");
    // No department chosen: say so in plain words (an empty queue would look like 'orders never arrive').
    const scope = await resolveWriteScope(ctx, user).catch((e) => { throw surfaceError(e); });
    const scope = await viewScope(ctx, user).catch((e) => { throw surfaceError(e); });
    if (!scope.tenantId) return [];
    const tenantId = scope.tenantId;
    const settings = await ctx.db.query("tenantSettings")
      .withIndex("by_tenant", q => q.eq("tenantId", tenantId))
      .first();
    if (!waiterOrdersAllowedFor(user.role, settings)) return [];
    const rows = await ctx.db.query("waiterOrders")
      .withIndex("by_scope_status", q => q.eq("tenantId", scope.tenantId))
      .collect();
    const inScope = rows.filter(r => orderInScope(user, scope, r) && (isWaiter(user.role) ? r.branchId === scope.branchId : true));
    const isWaiterRole = isWaiter(user.role);
    // A waiter sees only his own orders (placed, sent or received). Everyone else (cashier / manager) sees only orders that were SENT.
    // Cashier queue is strictly pending work. Accepted/printed orders remain in the database for history.
    const visible = inScope.filter(r => (isWaiterRole || isSuper(user.role)) ? r.waiterId === user._id : r.status === "pending"); // Super Admin sees only orders he made himself, never the cashier queue
    return visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  },
});

/**
 * STEP 1 - "Weka Order". Creating an order does not reduce stock.
 * Send and Print (below) never touch stock.
 */
export const place = mutation({
  args: {
    customerName: v.string(),
    tableNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    lines: v.array(v.object({
      productId: v.id("products"),
      qty: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    try {
    const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new Error("Chagua biashara kwanza.");
    const tenantId = scope.tenantId;
    const settings = await ctx.db.query("tenantSettings")
      .withIndex("by_tenant", q => q.eq("tenantId", tenantId))
      .first();
    if (!waiterOrdersAllowedFor(user.role, settings)) {
      throw new Error("Waiter Orders imezimwa kwa biashara hii.");
    }
    const customerName = args.customerName.trim();
    if (!customerName) throw new Error("Weka jina la mteja.");
    if (args.lines.length === 0) throw new Error("Ongeza angalau bidhaa moja.");

    const company = await getCompanySettings(ctx, user);
    const allowNegativeStock = !!company?.allowNegativeStock;
    const requested = new Map<string, number>(); // the same product on several lines is checked together
    for (const line of args.lines) {
      requested.set(String(line.productId), (requested.get(String(line.productId)) ?? 0) + (Number.isFinite(line.qty) ? line.qty : 0));
    }

    const lines = [];
    for (const line of args.lines) {
      if (!Number.isFinite(line.qty) || line.qty <= 0) {
        throw new Error("Kiasi cha bidhaa lazima kiwe zaidi ya sifuri.");
      }
      const product = await ctx.db.get("products", line.productId);
      if (!product || product.isActive === false) {
        throw new Error("Bidhaa haipo au haifanyi kazi.");
      }
      if (product.tenantId !== scope.tenantId ||
          (scope.branchId && product.branchId && product.branchId !== scope.branchId)) {
        throw new Error("Huna ruhusa ya kutumia bidhaa hiyo kwenye tawi hili.");
      }
      if (!allowNegativeStock && product.currentQty + 1e-8 < (requested.get(String(line.productId)) ?? line.qty)) {
        throw new Error(`Stock haitoshi kwa ${product.name}. Iliyopo: ${product.currentQty}, unayoweka: ${requested.get(String(line.productId))}`);
      }
      const unitPrice = product.sellingPrice;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error("Bei ya bidhaa si sahihi.");
      }
      lines.push({
        productId: product._id,
        productName: product.name,
        qty: line.qty,
        unitPrice,
        lineTotal: line.qty * unitPrice,
      });
    }

    const now = new Date().toISOString();
    const orderId = await ctx.db.insert("waiterOrders", {
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      customerName,
      tableNumber: args.tableNumber?.trim() || undefined,
      waiterId: user._id,
      waiterName: user.name || user.username || "Waiter",
      status: "placed",
      stockDeducted: false,
      lines,
      total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
      notes: args.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    return orderId;
    } catch (e) { throw surfaceError(e); }
  },
});

async function ownOrder(ctx: Parameters<typeof resolveWriteScope>[0], orderId: Id<"waiterOrders">) {
  const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
  const scope = await resolveWriteScope(ctx, user);
  const order = await ctx.db.get("waiterOrders", orderId);
  if (!order || order.tenantId !== scope.tenantId || order.branchId !== scope.branchId) {
    throw new Error("Oda haipo kwenye biashara au tawi lako.");
  }
  if (isWaiter(user.role) && order.waiterId !== user._id) {
    throw new Error("Hii si oda yako.");
  }
  return { user, order };
}

/** STEP 2a - "Send order": hands a placed order to the cashier's Waiter Orders screen. Never changes stock. */
export const sendToCashier = mutation({
  args: { orderId: v.id("waiterOrders") },
  handler: async (ctx, args) => {
    try {
    const { user, order } = await ownOrder(ctx, args.orderId);
    if (order.status === "placed") {
      const now = new Date().toISOString();
      await deductStockOnce(ctx, order, user, { tenantId: order.tenantId, branchId: order.branchId });
      await ctx.db.patch("waiterOrders", order._id, { status: "pending", sentAt: now, updatedAt: now });
    } else if (order.status !== "pending" && order.status !== "accepted") {
      throw new Error("Oda hii haiwezi kutumwa.");
    }
    return order._id;
    } catch (e) { throw surfaceError(e); }
  },
});

/** STEP 2b - "Print order": only records that it was printed. Never changes stock. */
export const markPrinted = mutation({
  args: { orderId: v.id("waiterOrders") },
  handler: async (ctx, args) => {
    try {
    const { user, order } = await ownOrder(ctx, args.orderId);
    if (!isWaiter(user.role)) throw new Error("Chapisha oda kutoka kwenye foleni ya cashier.");
    if (order.status === "printed") return order._id;
    if (order.status !== "placed") throw new Error("Oda hii tayari imetumwa au haiwezi kuchapishwa hapa.");
    const now = new Date().toISOString();
    await deductStockOnce(ctx, order, user, { tenantId: order.tenantId, branchId: order.branchId });
    await ctx.db.patch("waiterOrders", order._id, { status: "printed", printedAt: now, updatedAt: now });
    return order._id;
    } catch (e) { throw surfaceError(e); }
  },
});

export const markHandled = mutation({
  args: { orderId: v.id("waiterOrders") },
  handler: async (ctx, args) => {
    try {
    const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
    if (isWaiter(user.role) || isSuper(user.role)) throw new Error("Cashier pekee ndiye anayeweza kupokea oda iliyotumwa.");
    const scope = await viewScope(ctx, user);
    const order = await ctx.db.get("waiterOrders", args.orderId);
    if (!order || !orderInScope(user, scope, order)) {
      throw new Error("Oda haipo kwenye biashara au tawi lako.");
    }
    if (order.status === "accepted") return order._id; // printing again is harmless
    if (order.status !== "pending") {
      throw new Error("Oda hii bado haijatumwa na mhudumu.");
    }
    const now = new Date().toISOString();
    await ctx.db.patch("waiterOrders", order._id, {
      status: "accepted",
      printedAt: now,
      handledBy: user._id,
      handledAt: now,
      updatedAt: now,
    });
    await logAudit(ctx, user, { action: "accept_waiter_order", module: "sales", referenceId: String(order._id), referenceType: "waiterOrder", details: `${order.customerName}; mhudumu ${order.waiterName}; total ${order.total}` });
    return order._id;
    } catch (e) { throw surfaceError(e); }
  },
});

/**
 * "Futa oda": only users / roles given the "sales.void" permission (Role Management).
 * New waiter orders never deduct stock; the guarded stock reversal is retained only for legacy records explicitly marked stockDeducted.
 * The order is kept with status "cancelled" (never deleted) and leaves the cashier queue.
 */
export const cancel = mutation({
  args: { orderId: v.id("waiterOrders") },
  handler: async (ctx, args) => {
    try {
    const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
    if (!(await roleHasPermission(ctx, user, "sales.void"))) throw new Error("Huna ruhusa ya kufuta oda.");
    const scope = await viewScope(ctx, user);
    const order = await ctx.db.get("waiterOrders", args.orderId);
    if (!order || !orderInScope(user, scope, order)) {
      throw new Error("Oda haipo kwenye biashara au tawi lako.");
    }
    if (order.status === "cancelled") return order._id;
    if (order.settledAt) throw new Error("Oda hii tayari imelipwa kwa cashier; haiwezi kufutwa (mauzo na fedha vimeshahesabiwa).");
    const now = new Date().toISOString();
    if (order.stockDeducted) {
      for (const line of order.lines) {
        const product = await ctx.db.get("products", line.productId);
        if (!product) continue;
        const balance = product.currentQty + line.qty;
        await ctx.db.patch("products", line.productId, { currentQty: balance });
        await ctx.db.insert("stockMovements", {
          ...scope,
          movementDate: now.slice(0, 10),
          productId: line.productId,
          movementType: "waiter_order_cancel",
          referenceId: String(order._id),
          referenceType: "waiterOrder",
          qtyIn: line.qty,
          qtyOut: 0,
          runningBalance: balance,
          unitCost: product.weightedAvgCost ?? product.lastPurchaseCost ?? 0,
          createdBy: user._id,
        });
      }
    }
    await ctx.db.patch("waiterOrders", order._id, { status: "cancelled", stockDeducted: false, cancelledAt: now, cancelledBy: user._id, updatedAt: now });
    await logAudit(ctx, user, { action: "cancel_waiter_order", module: "sales", referenceId: String(order._id), referenceType: "waiterOrder", details: `${order.customerName}; total ${order.total}` });
    return order._id;
    } catch (e) { throw surfaceError(e); }
  },
});

/**
 * Selling Point: ONE safe step that creates the order, deducts stock once and marks it Sent (-> cashier queue) or Printed.
 * `clientKey` is generated once per cart on the screen. If the same key arrives again (double tap, retry, two tabs) the existing
 * order is returned and nothing is created or deducted a second time. Customer name and table number are optional.
 */
export const submit = mutation({
  args: {
    clientKey: v.string(),
    mode: v.union(v.literal("send"), v.literal("print")),
    customerName: v.optional(v.string()),
    tableNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    lines: v.array(v.object({ productId: v.id("products"), qty: v.number() })),
  },
  handler: async (ctx, args) => {
    try {
    const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new Error("Chagua biashara kwanza.");
    const tenantId = scope.tenantId;
    const key = args.clientKey.trim();
    if (key.length < 8 || key.length > 80) throw new Error("Ombi si sahihi. Fungua ukurasa upya.");
    const existing = await ctx.db.query("waiterOrders").withIndex("by_client_key", q => q.eq("waiterId", user._id).eq("clientKey", key)).first();
    if (existing) return { orderId: existing._id, status: existing.status, duplicate: true };
    const settings = await ctx.db.query("tenantSettings").withIndex("by_tenant", q => q.eq("tenantId", tenantId)).first();
    if (!waiterOrdersAllowedFor(user.role, settings)) throw new Error("Selling Point imezimwa kwa biashara hii.");
    if (args.lines.length === 0) throw new Error("Ongeza angalau bidhaa moja.");

    const merged = new Map<string, number>(); // the same product tapped many times = one line
    for (const l of args.lines) {
      if (!Number.isFinite(l.qty) || l.qty <= 0) throw new Error("Kiasi cha bidhaa lazima kiwe zaidi ya sifuri.");
      merged.set(String(l.productId), (merged.get(String(l.productId)) ?? 0) + l.qty);
    }
    const lines = [];
    for (const [pid, qty] of merged) {
      const product = await ctx.db.get("products", pid as Id<"products">);
      if (!product || product.isActive === false) throw new Error("Bidhaa haipo au haifanyi kazi.");
      if (product.tenantId !== scope.tenantId || (scope.branchId && product.branchId && product.branchId !== scope.branchId)) throw new Error("Huna ruhusa ya kutumia bidhaa hiyo kwenye tawi hili.");
      if (!Number.isFinite(product.sellingPrice) || product.sellingPrice < 0) throw new Error("Bei ya bidhaa si sahihi.");
      lines.push({ productId: product._id, productName: product.name, qty, unitPrice: product.sellingPrice, lineTotal: qty * product.sellingPrice });
    }
    const now = new Date().toISOString();
    const orderId = await ctx.db.insert("waiterOrders", {
      tenantId: scope.tenantId, branchId: scope.branchId,
      customerName: args.customerName?.trim() || "Mteja",
      tableNumber: args.tableNumber?.trim() || undefined,
      waiterId: user._id, waiterName: user.name || user.username || "Waiter",
      status: "placed", stockDeducted: false, clientKey: key, lines,
      total: lines.reduce((s, l) => s + l.lineTotal, 0),
      notes: args.notes?.trim() || undefined, createdAt: now, updatedAt: now,
    });
    const order = (await ctx.db.get("waiterOrders", orderId))!;
    await deductStockOnce(ctx, order, user, { tenantId: scope.tenantId, branchId: scope.branchId }); // throws -> whole mutation rolls back, no order, no stock change
    const status = args.mode === "send" ? "pending" : "printed";
    await ctx.db.patch("waiterOrders", orderId, args.mode === "send" ? { status, sentAt: now, updatedAt: now } : { status, printedAt: now, updatedAt: now });
    await logAudit(ctx, user, { action: args.mode === "send" ? "send_selling_point_order" : "print_selling_point_order", module: "sales", referenceId: String(orderId), referenceType: "waiterOrder", details: `meza ${order.tableNumber ?? "-"}; total ${order.total}; stock imepunguzwa mara moja` });
    return { orderId, status, duplicate: false };
    } catch (e) { throw surfaceError(e); }
  },
});

/** Orders for the Bills screen: a waiter sees his own, cashier/manager see the whole department. Optional table filter. Read-only. */
export const listForBills = query({
  args: { table: v.optional(v.string()), includePrinted: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requirePermission(ctx, "waiterOrders.view", "waiterOrders");
    const scope = await resolveWriteScope(ctx, user).catch((e) => { throw surfaceError(e); });
    const scope = await viewScope(ctx, user).catch((e) => { throw surfaceError(e); });
    if (!scope.tenantId) return [];
    const rows = await ctx.db.query("waiterOrders").withIndex("by_scope_status", q => q.eq("tenantId", scope.tenantId)).collect();
    const needle = (args.table ?? "").trim().toLowerCase();
    return rows
      .filter(r => r.status !== "cancelled" && r.status !== "placed" && (args.includePrinted || !r.billPrintedAt) && (!isWaiter(user.role) || r.waiterId === user._id))
      .filter(r => orderInScope(user, scope, r) && (!isWaiter(user.role) || r.branchId === scope.branchId) && r.status !== "cancelled" && r.status !== "placed" && (args.includePrinted || !r.billPrintedAt) && (!isWaiter(user.role) || r.waiterId === user._id))
      .filter(r => !needle || (r.tableNumber ?? "").toLowerCase().includes(needle) || r.customerName.toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300);
  },
});

/** Combined bill of several orders, recomputed on the server from the stored lines (never from numbers sent by the screen). Read-only. */
export const billSummary = query({
  args: { orderIds: v.array(v.id("waiterOrders")) },
  handler: async (ctx, args) => {
    const user = await requirePermission(ctx, "waiterOrders.view", "waiterOrders");
    const scope = await viewScope(ctx, user);
    const merged = new Map<string, { productName: string; unitPrice: number; qty: number; lineTotal: number }>();
    const tables = new Set<string>();
    let total = 0;
    for (const id of [...new Set(args.orderIds.map(String))] as Id<"waiterOrders">[]) {
      const o = await ctx.db.get("waiterOrders", id);
      if (!o || !orderInScope(user, scope, o) || o.status === "cancelled") throw new Error("Oda haipo kwenye biashara au tawi lako.");
      if (isWaiter(user.role) && o.waiterId !== user._id) throw new Error("Hii si oda yako.");
      if (o.tableNumber) tables.add(o.tableNumber);
      for (const l of o.lines) {
        const k = `${l.productId}|${l.unitPrice}`;
        const cur = merged.get(k) ?? { productName: l.productName, unitPrice: l.unitPrice, qty: 0, lineTotal: 0 };
        cur.qty += l.qty; cur.lineTotal += l.lineTotal; merged.set(k, cur); total += l.lineTotal;
      }
    }
    return { total: Math.round(total * 100) / 100, tables: [...tables], lines: [...merged.values()] };
  },
});

/** Called by the Bills screen ONLY after QZ Tray accepted the print job. Records the print; never changes stock, payments or sales. */
export const markBillPrinted = mutation({
  args: { orderIds: v.array(v.id("waiterOrders")) },
  handler: async (ctx, args) => {
    try {
      const user = await requirePermission(ctx, "waiterOrders.view", "waiterOrders");
      const scope = await resolveWriteScope(ctx, user);
      const now = new Date().toISOString();
      for (const id of [...new Set(args.orderIds.map(String))] as Id<"waiterOrders">[]) {
        const o = await ctx.db.get("waiterOrders", id);
        if (!o || o.tenantId !== scope.tenantId || o.branchId !== scope.branchId || o.status === "cancelled") throw new Error("Oda haipo kwenye biashara au tawi lako.");
      const scope = await viewScope(ctx, user);
      const now = new Date().toISOString();
      for (const id of [...new Set(args.orderIds.map(String))] as Id<"waiterOrders">[]) {
        const o = await ctx.db.get("waiterOrders", id);
        if (!o || !orderInScope(user, scope, o) || o.status === "cancelled") throw new Error("Oda haipo kwenye biashara au tawi lako.");
        if (isWaiter(user.role) && o.waiterId !== user._id) throw new Error("Hii si oda yako.");
        if (!o.billPrintedAt) await ctx.db.patch("waiterOrders", o._id, { billPrintedAt: now, updatedAt: now });
      }
      return true;
    } catch (e) { throw surfaceError(e); }
  },
});
