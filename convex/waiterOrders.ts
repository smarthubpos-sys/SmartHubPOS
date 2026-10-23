import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission, resolveWriteScope } from "./access";
import { resolveWaiterSettings, waiterOrdersAllowedFor } from "./waiterSettings";

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
    if (!waiterOrdersAllowedFor(user.role, settings) ||
        resolveWaiterSettings(settings).waiterOrderMode !== "cashier") return [];
    const rows = await ctx.db.query("waiterOrders")
      .withIndex("by_scope_status", q =>
        q.eq("tenantId", scope.tenantId).eq("branchId", scope.branchId)
      ).collect();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  },
});

export const send = mutation({
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
    if (resolveWaiterSettings(settings).waiterOrderMode !== "cashier") {
      throw new Error("Mode hii ni ya kuchapisha oda, si kutuma kwa cashier.");
    }
    const customerName = args.customerName.trim();
    if (!customerName) throw new Error("Weka jina la mteja.");
    if (args.lines.length === 0) throw new Error("Ongeza angalau bidhaa moja.");

    const lines = [];
    for (const line of args.lines) {
      if (!Number.isFinite(line.qty) || line.qty <= 0) {
        throw new Error("Kiasi cha bidhaa lazima kiwe zaidi ya sifuri.");
      }
      const product = await ctx.db.get(line.productId);
      if (!product || product.isActive === false) {
        throw new Error("Bidhaa haipo au haifanyi kazi.");
      }
      if (product.tenantId !== scope.tenantId ||
          (scope.branchId && product.branchId && product.branchId !== scope.branchId)) {
        throw new Error("Huna ruhusa ya kutumia bidhaa hiyo kwenye tawi hili.");
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
    return await ctx.db.insert("waiterOrders", {
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      customerName,
      tableNumber: args.tableNumber?.trim() || undefined,
      waiterId: user._id,
      waiterName: user.name || user.username || "Waiter",
      status: "pending",
      lines,
      total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
      notes: args.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markHandled = mutation({
  args: { orderId: v.id("waiterOrders") },
  handler: async (ctx, args) => {
    const user = await requirePermission(ctx, "sales.manage", "sales");
    const scope = await resolveWriteScope(ctx, user);
    const order = await ctx.db.get(args.orderId);
    if (!order || order.tenantId !== scope.tenantId ||
        order.branchId !== scope.branchId) {
      throw new Error("Oda haipo kwenye biashara au tawi lako.");
    }
    if (order.status !== "pending") {
      throw new Error("Oda hii tayari imepokelewa.");
    }
    await ctx.db.patch(order._id, {
      status: "accepted",
      handledBy: user._id,
      handledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return order._id;
  },
});
