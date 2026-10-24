import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { surfaceError } from "./surfaceError";
import type { Id } from "./_generated/dataModel";
import { getCompanySettings, logAudit, requirePermission, resolveWriteScope, roleHasPermission } from "./access";
import { waiterOrdersAllowedFor } from "./waiterSettings";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "sales.view", "sales");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) return [];
    const tenantId = scope.tenantId;
    const settings = await ctx.db.query("tenantSettings")
      .withIndex("by_tenant", q => q.eq("tenantId", tenantId))
      .first();
    if (!waiterOrdersAllowedFor(user.role, settings)) return [];
    const rows = await ctx.db.query("waiterOrders")
      .withIndex("by_scope_status", q =>
        q.eq("tenantId", scope.tenantId).eq("branchId", scope.branchId)
      ).collect();
    const role = String(user.role ?? "").toLowerCase();
    const isWaiterRole = role === "waiter" || role === "waitress";
    // A waiter sees only his own orders (placed, sent or received). Everyone else (cashier / manager) sees only orders that were SENT.
    const visible = rows.filter(r => isWaiterRole ? r.waiterId === user._id : r.status !== "placed" && r.status !== "cancelled");
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
    const user = await requirePermission(ctx, "sales.manage", "sales");
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
  const user = await requirePermission(ctx, "sales.manage", "sales");
  const scope = await resolveWriteScope(ctx, user);
  const order = await ctx.db.get("waiterOrders", orderId);
  if (!order || order.tenantId !== scope.tenantId || order.branchId !== scope.branchId) {
    throw new Error("Oda haipo kwenye biashara au tawi lako.");
  }
  const role = String(user.role ?? "").toLowerCase();
  if ((role === "waiter" || role === "waitress") && order.waiterId !== user._id) {
    throw new Error("Hii si oda yako.");
  }
  return { user, order };
}

/** STEP 2a - "Send order": hands a placed order to the cashier's Waiter Orders screen. Never changes stock. */
export const sendToCashier = mutation({
  args: { orderId: v.id("waiterOrders") },
  handler: async (ctx, args) => {
    try {
    const { order } = await ownOrder(ctx, args.orderId);
    if (order.status === "placed") {
      const now = new Date().toISOString();
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
    const { order } = await ownOrder(ctx, args.orderId);
    await ctx.db.patch("waiterOrders", order._id, { printedAt: new Date().toISOString() });
    return order._id;
    } catch (e) { throw surfaceError(e); }
  },
});

export const markHandled = mutation({
  args: { orderId: v.id("waiterOrders") },
  handler: async (ctx, args) => {
    try {
    const user = await requirePermission(ctx, "sales.manage", "sales");
    const scope = await resolveWriteScope(ctx, user);
    const order = await ctx.db.get("waiterOrders", args.orderId);
    if (!order || order.tenantId !== scope.tenantId ||
        order.branchId !== scope.branchId) {
      throw new Error("Oda haipo kwenye biashara au tawi lako.");
    }
    if (order.status === "accepted") return order._id; // printing again is harmless
    if (order.status !== "pending") {
      throw new Error("Oda hii bado haijatumwa na mhudumu.");
    }
    await ctx.db.patch("waiterOrders", order._id, {
      status: "accepted",
      handledBy: user._id,
      handledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return order._id;
    } catch (e) { throw surfaceError(e); }
  },
});

/**
 * "Futa oda": only users / roles given the "sales.void" permission (Role Management). Stock reduced by "Weka Order" goes back,
 * once. The order is kept with status "cancelled" (never deleted) and leaves the cashier queue.
 */
export const cancel = mutation({
  args: { orderId: v.id("waiterOrders") },
  handler: async (ctx, args) => {
    try {
    const user = await requirePermission(ctx, "sales.manage", "sales");
    if (!(await roleHasPermission(ctx, user, "sales.void"))) throw new Error("Huna ruhusa ya kufuta oda.");
    const scope = await resolveWriteScope(ctx, user);
    const order = await ctx.db.get("waiterOrders", args.orderId);
    if (!order || order.tenantId !== scope.tenantId || order.branchId !== scope.branchId) {
      throw new Error("Oda haipo kwenye biashara au tawi lako.");
    }
    if (order.status === "cancelled") return order._id;
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
