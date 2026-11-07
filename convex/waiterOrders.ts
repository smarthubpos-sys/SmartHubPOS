import { mutation, query, type MutationCtx } from "./_generated/server";
import { orderHasPayment, reverseOrderPayments } from "./waiterRefund";
import { v, ConvexError } from "convex/values";
import { surfaceError } from "./surfaceError";
import { assertAutoProducible, autoProduceForSale } from "./autoProduce";
import type { Doc, Id } from "./_generated/dataModel";
import { getCompanySettings, isManagerRole, logAudit, normalizeRole, requirePermission, resolveWriteScope, roleHasPermission } from "./access";
import { resolveWaiterSettings, waiterOrdersAllowedFor } from "./waiterSettings";
import { assertDate, assertPeriodOpen } from "./ledger";

/** East Africa Time business day of a timestamp (a bill made at 01:00 EAT belongs to that EAT day, like in the reports). */
const eatDay = (iso: string) => new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 10);


// Normalised like everywhere else (case / spaces / hyphens): a role label such as "Waitress " must still be limited to its OWN orders.
const isWaiter = (role?: string) => ["waiter", "waitress"].includes(normalizeRole(role));
/** Super Admin administers businesses; he is NOT a cashier. Orders sent by waiters must never land in his queue, and he cannot receive them. */
const isSuper = (role?: string) => ["super_admin", "superadmin"].includes(String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"));

/**
 * Deducts the stock of an order EXACTLY ONCE. The guard is the order's own `stockDeducted` flag, read and written inside the same
 * mutation (Convex mutations are serialised per document), so a double tap, a retry or two devices can never deduct twice.
 * Send and Print both come through here; the cashier's receive/print (markHandled) never does.
 */
export async function deductStockOnce(
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
  // Recipe products ("Mbuzi Makange") are produced from their ingredients here when the stock lacks them.
  await autoProduceForSale(ctx, user, scope, need, allowNegativeStock, { id: String(fresh._id), label: "oda" });
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
  throw new ConvexError("Bidhaa haipo kwenye biashara au tawi hili.");
}
    if (!allowNegativeStock && product.currentQty + 1e-8 < qty) throw new ConvexError(`Stock haitoshi kwa ${product.name}. Iliyopo: ${product.currentQty}, inayohitajika: ${qty}`);
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
    if (product.trackExpiry || product.trackBatchNumbers) {
      const lots=(await ctx.db.query("stockLots").withIndex("by_product",q=>q.eq("productId",product._id)).collect())
        .filter(x=>x.tenantId===scope.tenantId&&x.branchId===scope.branchId&&x.quantityRemaining>0)
        .sort((a,b)=>(a.expiryDate??"9999-12-31").localeCompare(b.expiryDate??"9999-12-31")||a.receivedDate.localeCompare(b.receivedDate));
      const lotQty=lots.reduce((n,x)=>n+x.quantityRemaining,0);
      if(lotQty+1e-8<qty) throw new ConvexError(`Batch stock haitoshi kwa ${product.name}.`);
      let left=qty;
      for(const lot of lots){if(left<=1e-8)break;const used=Math.min(left,lot.quantityRemaining);await ctx.db.patch("stockLots",lot._id,{quantityRemaining:lot.quantityRemaining-used});await ctx.db.insert("stockLotAllocations",{...scope,waiterOrderId:fresh._id,productId:product._id,lotId:lot._id,quantity:used,returnedQuantity:0});left-=used;}
    }
    if(product.trackSerialNumbers && !Number.isInteger(qty)) throw new ConvexError(`Bidhaa ${product.name} inafuatilia serial number; oda lazima iwe na idadi kamili.`);
    if(product.trackSerialNumbers){
      const serials=(await ctx.db.query("stockSerials").withIndex("by_product",q=>q.eq("productId",product._id)).collect())
        .filter(x=>x.tenantId===scope.tenantId&&x.branchId===scope.branchId&&x.status==="in_stock")
        .sort((a,b)=>a.receivedDate.localeCompare(b.receivedDate)||a._creationTime-b._creationTime);
      if(serials.length<qty) throw new ConvexError(`Serial stock haitoshi kwa ${product.name}.`);
      for(const serial of serials.slice(0,qty)) await ctx.db.patch("stockSerials",serial._id,{status:"sold",soldDate:now.slice(0,10),reference:String(fresh._id)});
    }
  }
  await ctx.db.patch("waiterOrders", fresh._id, { stockDeducted: true, stockDeductedAt: now, updatedAt: now });
  return true;
}

async function restoreWaiterLotAllocations(ctx: MutationCtx, orderId: Id<"waiterOrders">) {
  const allocations=await ctx.db.query("stockLotAllocations").withIndex("by_waiter_order",q=>q.eq("waiterOrderId",orderId)).collect();
  for(const allocation of allocations){
    const back=Math.max(0,allocation.quantity-allocation.returnedQuantity);
    if(back>0){const lot=await ctx.db.get("stockLots",allocation.lotId);if(lot)await ctx.db.patch("stockLots",lot._id,{quantityRemaining:lot.quantityRemaining+back});await ctx.db.patch("stockLotAllocations",allocation._id,{returnedQuantity:allocation.quantity});}
  }
  const order=await ctx.db.get("waiterOrders",orderId);
  for(const productId of [...new Set((order?.lines??[]).map(x=>String(x.productId)))]) {
    const serials=await ctx.db.query("stockSerials").withIndex("by_product",q=>q.eq("productId",productId as Id<"products">)).collect();
    for(const serial of serials.filter(x=>x.reference===String(orderId)&&x.status==="sold")) await ctx.db.patch("stockSerials",serial._id,{status:"in_stock",soldDate:undefined,reference:serial.receivedReference});
  }
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


/** Allocate Selling Point numbers from the same tenant-wide sequence used by Sales > Invoicing. */
export async function allocateSellingPointInvoiceNo(ctx: MutationCtx, user: Doc<"users">, tenantId: Id<"tenants">) {
  const company = await getCompanySettings(ctx, user);
  const prefix = company?.invoicePrefix ?? "INV-";
  const seqRows = await ctx.db.query("salesSequences").withIndex("by_scope", q => q.eq("tenantId", tenantId)).collect();
  const sequence = seqRows.find(x => x.branchId === undefined);
  let nextNo = Math.max(sequence?.nextNumber ?? 1, ...seqRows.map(x => x.nextNumber));
  let invoiceNo = `${prefix}${String(nextNo).padStart(5, "0")}`;
  for (;;) {
    const invoiceClash = await ctx.db.query("invoices").withIndex("by_tenant_no", q => q.eq("tenantId", tenantId).eq("invoiceNo", invoiceNo)).first();
    const orderClash = await ctx.db.query("waiterOrders").withIndex("by_tenant_invoice_no", q => q.eq("tenantId", tenantId).eq("invoiceNo", invoiceNo)).first();
    if (!invoiceClash && !orderClash) break;
    nextNo++;
    invoiceNo = `${prefix}${String(nextNo).padStart(5, "0")}`;
  }
  if (sequence) await ctx.db.patch("salesSequences", sequence._id, { nextNumber: nextNo + 1 });
  else await ctx.db.insert("salesSequences", { tenantId, nextNumber: nextNo + 1 });
  return invoiceNo;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "waiterOrders.view", "waiterOrders");
    // No department chosen: say so in plain words (an empty queue would look like 'orders never arrive').
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
 * Why is my cashier queue empty? Read-only counts so the screen can say the real reason (switch off, "Print" mode, orders waiting in
 * ANOTHER department, or simply none sent yet) instead of showing a silent empty list. Never returns any order's content.
 */
export const queueHealth = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "waiterOrders.view", "waiterOrders");
    const scope = await viewScope(ctx, user).catch(() => ({} as ScopeLike));
    if (!scope.tenantId) return null;
    const tenantId = scope.tenantId;
    const settings = await ctx.db.query("tenantSettings").withIndex("by_tenant", q => q.eq("tenantId", tenantId)).first();
    const rows = await ctx.db.query("waiterOrders").withIndex("by_scope_status", q => q.eq("tenantId", tenantId)).collect();
    const pendingAll = rows.filter(r => r.status === "pending");
    const visible = pendingAll.filter(r => orderInScope(user, scope, r));
    const department = scope.branchId ? (await ctx.db.get("branches", scope.branchId))?.name ?? null : null;
    return {
      allowed: waiterOrdersAllowedFor(user.role, settings),
      mode: resolveWaiterSettings(settings).waiterOrderMode,
      pendingAll: pendingAll.length,
      visible: visible.length,
      otherDepartments: pendingAll.length - visible.length,
      department,
    };
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
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    const tenantId = scope.tenantId;
    const settings = await ctx.db.query("tenantSettings")
      .withIndex("by_tenant", q => q.eq("tenantId", tenantId))
      .first();
    if (!waiterOrdersAllowedFor(user.role, settings)) {
      throw new ConvexError("Waiter Orders imezimwa kwa biashara hii.");
    }
    const customerName = args.customerName.trim();
    if (!customerName) throw new ConvexError("Weka jina la mteja.");
    if (args.lines.length === 0) throw new ConvexError("Ongeza angalau bidhaa moja.");

    const company = await getCompanySettings(ctx, user);
    const allowNegativeStock = !!company?.allowNegativeStock;
    const requested = new Map<string, number>(); // the same product on several lines is checked together
    for (const line of args.lines) {
      requested.set(String(line.productId), (requested.get(String(line.productId)) ?? 0) + (Number.isFinite(line.qty) ? line.qty : 0));
    }

    const produceOnSale = await assertAutoProducible(ctx, scope, requested, allowNegativeStock); // recipe products: ingredients are checked instead of the product's own stock
    const lines = [];
    for (const line of args.lines) {
      if (!Number.isFinite(line.qty) || line.qty <= 0) {
        throw new ConvexError("Kiasi cha bidhaa lazima kiwe zaidi ya sifuri.");
      }
      const product = await ctx.db.get("products", line.productId);
      if (!product || product.isActive === false) {
        throw new ConvexError("Bidhaa haipo au haifanyi kazi.");
      }
      if (product.tenantId !== scope.tenantId ||
          (scope.branchId && product.branchId && product.branchId !== scope.branchId)) {
        throw new ConvexError("Huna ruhusa ya kutumia bidhaa hiyo kwenye tawi hili.");
      }
      if (!allowNegativeStock && !produceOnSale.has(String(line.productId)) && product.currentQty + 1e-8 < (requested.get(String(line.productId)) ?? line.qty)) {
        throw new ConvexError(`Stock haitoshi kwa ${product.name}. Iliyopo: ${product.currentQty}, unayoweka: ${requested.get(String(line.productId))}`);
      }
      const unitPrice = product.sellingPrice;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new ConvexError("Bei ya bidhaa si sahihi.");
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
    const invoiceNo = await allocateSellingPointInvoiceNo(ctx, user, scope.tenantId);
    const orderId = await ctx.db.insert("waiterOrders", {
      tenantId: scope.tenantId,
      invoiceNo,
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
    throw new ConvexError("Oda haipo kwenye biashara au tawi lako.");
  }
  if (isWaiter(user.role) && order.waiterId !== user._id) {
    throw new ConvexError("Hii si oda yako.");
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
      throw new ConvexError("Oda hii haiwezi kutumwa.");
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
    if (!isWaiter(user.role)) throw new ConvexError("Chapisha oda kutoka kwenye foleni ya cashier.");
    if (order.status === "printed") return order._id;
    if (order.status !== "placed") throw new ConvexError("Oda hii tayari imetumwa au haiwezi kuchapishwa hapa.");
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
    if (isWaiter(user.role) || isSuper(user.role)) throw new ConvexError("Cashier pekee ndiye anayeweza kupokea oda iliyotumwa.");
    const scope = await viewScope(ctx, user);
    const order = await ctx.db.get("waiterOrders", args.orderId);
    if (!order || !orderInScope(user, scope, order)) {
      throw new ConvexError("Oda haipo kwenye biashara au tawi lako.");
    }
    if (order.status === "accepted") return order._id; // printing again is harmless
    if (order.status !== "pending") {
      throw new ConvexError("Oda hii bado haijatumwa na mhudumu.");
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
    if (!(await roleHasPermission(ctx, user, "sales.void"))) throw new ConvexError("Huna ruhusa ya kufuta oda.");
    const scope = await viewScope(ctx, user);
    const order = await ctx.db.get("waiterOrders", args.orderId);
    if (!order || !orderInScope(user, scope, order)) {
      throw new ConvexError("Oda haipo kwenye biashara au tawi lako.");
    }
    if (order.status === "cancelled") return order._id;
    if (order.settledAt) throw new ConvexError("Oda hii tayari imelipwa kwa cashier; haiwezi kufutwa (mauzo na fedha vimeshahesabiwa).");
    if ((order.paidAmount ?? 0) > 0) throw new ConvexError("Oda hii imeshalipiwa kiasi kwa cashier; haiwezi kufutwa. Maliza deni lililobaki.");
    if (order.assignedInvoiceId) throw new ConvexError("Bili hii imeelekezwa kwa mteja kama deni; haiwezi kufutwa. Ghairi deni la mteja kwanza.");
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
    if (order.stockDeducted) await restoreWaiterLotAllocations(ctx, order._id);
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
    lines: v.array(v.object({ productId: v.id("products"), qty: v.number(), discount: v.optional(v.number()) })),
  },
  handler: async (ctx, args) => {
    try {
    const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    const tenantId = scope.tenantId;
    const key = args.clientKey.trim();
    if (key.length < 8 || key.length > 80) throw new ConvexError("Ombi si sahihi. Fungua ukurasa upya.");
    const existing = await ctx.db.query("waiterOrders").withIndex("by_client_key", q => q.eq("waiterId", user._id).eq("clientKey", key)).first();
    if (existing) return { orderId: existing._id, status: existing.status, duplicate: true };
    const settings = await ctx.db.query("tenantSettings").withIndex("by_tenant", q => q.eq("tenantId", tenantId)).first();
    if (!waiterOrdersAllowedFor(user.role, settings)) throw new ConvexError("Selling Point imezimwa kwa biashara hii.");
    if (args.lines.length === 0) throw new ConvexError("Ongeza angalau bidhaa moja.");

    const merged = new Map<string, { qty: number; discount: number }>(); // the same product tapped many times = one line
    for (const l of args.lines) {
      if (!Number.isFinite(l.qty) || l.qty <= 0) throw new ConvexError("Kiasi cha bidhaa lazima kiwe zaidi ya sifuri.");
      const d = l.discount ?? 0;
      if (!Number.isFinite(d) || d < 0) throw new ConvexError("Punguzo la bei si sahihi.");
      const prev = merged.get(String(l.productId));
      merged.set(String(l.productId), { qty: (prev?.qty ?? 0) + l.qty, discount: (prev?.discount ?? 0) + d });
    }
    const lines = [];
    for (const [pid, { qty, discount }] of merged) {
      const product = await ctx.db.get("products", pid as Id<"products">);
      if (!product || product.isActive === false) throw new ConvexError("Bidhaa haipo au haifanyi kazi.");
      if (product.tenantId !== scope.tenantId || (scope.branchId && product.branchId && product.branchId !== scope.branchId)) throw new ConvexError("Huna ruhusa ya kutumia bidhaa hiyo kwenye tawi hili.");
      if (!Number.isFinite(product.sellingPrice) || product.sellingPrice < 0) throw new ConvexError("Bei ya bidhaa si sahihi.");
      const gross = Math.round(qty * product.sellingPrice * 100) / 100;
      if (discount > gross + 1e-8) throw new ConvexError(`Punguzo la ${product.name} linazidi bei ya mstari.`);
      lines.push({ productId: product._id, productName: product.name, qty, unitPrice: product.sellingPrice, ...(discount > 0 ? { discount } : {}), lineTotal: Math.round((gross - discount) * 100) / 100 });
    }
    const now = new Date().toISOString();
    const invoiceNo = await allocateSellingPointInvoiceNo(ctx, user, scope.tenantId);
    const orderId = await ctx.db.insert("waiterOrders", {
      tenantId: scope.tenantId, branchId: scope.branchId, invoiceNo,
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

/**
 * Invoice Finder is an archive, not the cashier's live queue. Waiters see their own bills;
 * cashiers see bills sent to them; managers / admins / owners and the Super Admin see every waiter's bills of the business (search by number, customer or waiter name).
 * This does not add Super Admin to the cashier receive/settlement workflow.
 */
const billVisible = (user: { _id: Id<"users">; role?: string }, o: Doc<"waiterOrders">) =>
  o.waiterId === user._id || (isSuper(user.role) || (!isWaiter(user.role) && !!o.billSentAt));

/** Search archived Selling Point bills from the existing Invoice Finder. No default history listing. */
export const searchBillsForFinder = query({
  args: { search: v.string() },
  handler: async (ctx, args) => {
    const user = await requirePermission(ctx, "sales.view", "sales");
    const scope = await viewScope(ctx, user).catch((e) => { throw surfaceError(e); });
    if (!scope.tenantId) return [];
    const raw = args.search.trim().replace(/^#/, "");
    if (!raw || raw.length > 40) return [];
    const company = await getCompanySettings(ctx, user);
    const prefix = company?.invoicePrefix ?? "INV-";
    const wanted = new Set([raw, raw.toUpperCase()]);
    if (/^\d+$/.test(raw)) {
      const padded = raw.padStart(5, "0");
      wanted.add(padded);
      wanted.add(`${prefix}${padded}`);
    }
    const rows = await ctx.db.query("waiterOrders")
      .withIndex("by_scope_status", q => q.eq("tenantId", scope.tenantId))
      .collect();
    const needle = raw.toLowerCase();
    // A manager / admin / owner audits EVERY waiter's bills (also those the waiter has not sent to the cashier yet); a cashier still sees only sent ones.
    const seesAll = await isManagerRole(ctx, user);
    const rights = {
      canPrint: await roleHasPermission(ctx, user, "sales.print"),
      canEdit: await roleHasPermission(ctx, user, "sales.edit"),
      canVoid: await roleHasPermission(ctx, user, "sales.void"),
    };
    return rows
      .filter(o => orderInScope(user, scope, o)
        && (!isWaiter(user.role) || o.branchId === scope.branchId)
        && (seesAll || billVisible(user, o))
        && (!!o.invoiceNo && wanted.has(o.invoiceNo) || o.customerName.toLowerCase().includes(needle) || (seesAll && o.waiterName.toLowerCase().includes(needle))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map(o => ({
        _id: o._id, invoiceNo: o.invoiceNo ?? "—", invoiceDate: eatDay(o.createdAt),
        customerName: o.customerName, waiterName: o.waiterName, tableNumber: o.tableNumber, notes: o.notes,
        total: o.total, status: o.status, billSentAt: o.billSentAt, billPrintedAt: o.billPrintedAt,
        canPrint: rights.canPrint,
        // A bill received by the cashier or already paid can still be edited / cancelled: the payment is given back first (see waiterRefund.ts).
        hasPayment: orderHasPayment(o), paidAmount: o.paidAmount ?? (o.settledAt ? o.total : 0),
        canEdit: rights.canEdit && o.status !== "cancelled",
        canVoid: rights.canVoid && o.status !== "cancelled",
        lines: o.lines.map(l => ({ productId: l.productId, productName: l.productName, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount ?? 0, lineTotal: l.lineTotal })),
      }));
  },
});

/** Edit an unpaid Selling Point bill from Invoice Finder without changing its invoice number. Stock is reversed and re-deducted atomically. */
export const editBillFromFinder = mutation({
  args: {
    orderId: v.id("waiterOrders"),
    billDate: v.optional(v.string()), // YYYY-MM-DD: corrects the business day of the bill (bills made after midnight); the time of day is kept
    customerName: v.string(),
    tableNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    lines: v.array(v.object({
      productId: v.id("products"),
      qty: v.number(),
      unitPrice: v.number(),
      discount: v.optional(v.number()),
    })),
    undoPayment: v.optional(v.boolean()), // required when the bill already has money received: the payment is given back, then the bill is edited
  },
  handler: async (ctx, args) => {
    try {
      const user = await requirePermission(ctx, "sales.edit", "sales");
      const scope = await viewScope(ctx, user);
      const order = await ctx.db.get("waiterOrders", args.orderId);
      if (!scope.tenantId || !order || order.tenantId !== scope.tenantId || !orderInScope(user, scope, order)
        || (isWaiter(user.role) && (order.branchId !== scope.branchId || order.waiterId !== user._id))) {
        throw new ConvexError("Bili haipatikani kwenye biashara au tawi lako.");
      }
      if (order.status === "cancelled") throw new ConvexError("Bili hii imebatilishwa.");
      if (orderHasPayment(order) && !args.undoPayment) {
        throw new ConvexError("Bili hii ina malipo yaliyopokelewa. Thibitisha kurudisha malipo kwanza ili kuihariri.");
      }
      if (!args.lines.length) throw new ConvexError("Bili lazima iwe na angalau bidhaa moja.");
      const customerName = args.customerName.trim();
      if (!customerName || customerName.length > 120) throw new ConvexError("Jina la mteja si sahihi.");

      const lines: Array<{ productId: Id<"products">; productName: string; qty: number; unitPrice: number; discount?: number; lineTotal: number }> = [];
      for (const line of args.lines) {
        if (!Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
          throw new ConvexError("Kiasi au bei ya bidhaa si sahihi.");
        }
        const product = await ctx.db.get("products", line.productId);
        if (!product || product.tenantId !== order.tenantId || (order.branchId && product.branchId && product.branchId !== order.branchId)) {
          throw new ConvexError("Bidhaa haipo kwenye biashara au tawi lako.");
        }
        const gross = Math.round(line.qty * line.unitPrice * 100) / 100;
        if (!Number.isFinite(gross)) throw new ConvexError("Jumla ya bidhaa si sahihi.");
        const discount = line.discount ?? 0;
        if (!Number.isFinite(discount) || discount < 0 || discount > gross + 1e-8) {
          throw new ConvexError("Punguzo la bidhaa si sahihi.");
        }
        lines.push({
          productId: product._id, productName: product.name, qty: line.qty, unitPrice: line.unitPrice,
          ...(discount > 0 ? { discount } : {}),
          lineTotal: Math.round((gross - discount) * 100) / 100,
        });
      }

      const now = new Date().toISOString();
      const orderScope = { tenantId: order.tenantId, branchId: order.branchId };
      // Business day of the bill: may be corrected, but not into the future or into / out of a closed accounting period.
      const oldDay = eatDay(order.createdAt);
      const newDay = args.billDate !== undefined && args.billDate !== oldDay ? assertDate(args.billDate, "Tarehe ya bili") : oldDay;
      const dayChanged = newDay !== oldDay;
      if (dayChanged) {
        if (newDay > eatDay(new Date(Date.now() + 24 * 3600000).toISOString())) throw new ConvexError("Tarehe ya bili haiwezi kuwa ya baadaye.");
        await assertPeriodOpen(ctx, orderScope, newDay);
        await assertPeriodOpen(ctx, orderScope, oldDay);
      }
      const newCreatedAt = dayChanged ? new Date(Date.parse(`${newDay}${new Date(Date.parse(order.createdAt) + 3 * 3600000).toISOString().slice(10)}`) - 3 * 3600000).toISOString() : order.createdAt;
      const ensuredInvoiceNo = order.invoiceNo ?? await allocateSellingPointInvoiceNo(ctx, user, order.tenantId); // an old bill without a number gets one now
      const refund = await reverseOrderPayments(ctx, user, order, "bili imehaririwa"); // before the stock moves: the cost of goods is read from it
      if (order.stockDeducted) {
        const restore = new Map<string, number>();
        for (const line of order.lines) restore.set(String(line.productId), (restore.get(String(line.productId)) ?? 0) + line.qty);
        for (const [productId, qty] of restore) {
          const product = await ctx.db.get("products", productId as Id<"products">);
          if (!product || product.tenantId !== order.tenantId || (order.branchId && product.branchId && product.branchId !== order.branchId)) throw new ConvexError("Bidhaa ya awali haipatikani; stock haijabadilishwa.");
          const balance = product.currentQty + qty;
          await ctx.db.patch("products", product._id, { currentQty: balance });
          await ctx.db.insert("stockMovements", {
            ...orderScope, movementDate: now.slice(0, 10), productId: product._id,
            movementType: "waiter_order_edit_return", referenceId: String(order._id),
            referenceType: "waiterOrder", qtyIn: qty, qtyOut: 0, runningBalance: balance,
            unitCost: product.weightedAvgCost ?? product.lastPurchaseCost ?? 0, createdBy: user._id,
          });
        }
      }
      if (order.stockDeducted) await restoreWaiterLotAllocations(ctx, order._id);
      const updated = {
        ...order,
        customerName,
        tableNumber: args.tableNumber?.trim() || undefined,
        notes: args.notes?.trim() || undefined,
        lines,
        total: Math.round(lines.reduce((sum, line) => sum + line.lineTotal, 0) * 100) / 100,
        stockDeducted: false,
        createdAt: newCreatedAt,
        updatedAt: now,
      };
      await ctx.db.patch("waiterOrders", order._id, {
        customerName: updated.customerName, tableNumber: updated.tableNumber, notes: updated.notes,
        lines: updated.lines, total: updated.total, invoiceNo: ensuredInvoiceNo, stockDeducted: false, billPrintedAt: undefined, createdAt: newCreatedAt, updatedAt: now,
      });
      await deductStockOnce(ctx, updated as Doc<"waiterOrders">, user, orderScope);
      // The stock history of this bill follows its corrected day.
      if (dayChanged) for (const m of await ctx.db.query("stockMovements").withIndex("by_reference", (q) => q.eq("referenceType", "waiterOrder").eq("referenceId", String(order._id))).collect()) await ctx.db.patch("stockMovements", m._id, { movementDate: newDay });
      await logAudit(ctx, user, {
        action: "edit_selling_point_bill", module: "sales", referenceId: String(order._id),
        referenceType: "waiterOrder", details: `${order.invoiceNo ?? order._id}; ${order.total} -> ${updated.total}${dayChanged ? `; tarehe ${oldDay} -> ${newDay}` : ""}${refund.refunded > 0 ? `; malipo yaliyorudishwa ${refund.refunded}` : ""}`,
      });
      return { orderId: order._id, invoiceNo: ensuredInvoiceNo, total: updated.total, refunded: refund.refunded };
    } catch (e) { throw surfaceError(e); }
  },
});

/** Cancel a Selling Point bill from Invoice Finder (if money was received it is given back first). The record and invoice number remain in history. */
export const cancelBillFromFinder = mutation({
  args: { orderId: v.id("waiterOrders"), reason: v.string(), refundPayment: v.optional(v.boolean()) }, // refundPayment: required when money was already received
  handler: async (ctx, args) => {
    try {
      const user = await requirePermission(ctx, "sales.void", "sales");
      const scope = await viewScope(ctx, user);
      const order = await ctx.db.get("waiterOrders", args.orderId);
      if (!scope.tenantId || !order || order.tenantId !== scope.tenantId || !orderInScope(user, scope, order)
        || (isWaiter(user.role) && (order.branchId !== scope.branchId || order.waiterId !== user._id))) {
        throw new ConvexError("Bili haipatikani kwenye biashara au tawi lako.");
      }
      if (order.status === "cancelled") return order._id;
      if (order.assignedInvoiceId) throw new ConvexError("Bili hii imeelekezwa kwa mteja kama deni; haiwezi kubatilishwa. Ghairi deni la mteja kwanza.");
      if (orderHasPayment(order) && !args.refundPayment) {
        throw new ConvexError("Bili hii ina malipo yaliyopokelewa. Thibitisha kurudisha malipo kabla ya kuifuta.");
      }
      const reason = args.reason.trim();
      if (!reason || reason.length > 300) throw new ConvexError("Weka sababu ya kubatilisha bili.");
      const now = new Date().toISOString();
      const orderScope = { tenantId: order.tenantId, branchId: order.branchId };
      const refund = await reverseOrderPayments(ctx, user, order, reason); // before the stock moves: the cost of goods is read from it
      if (order.stockDeducted) {
        const restore = new Map<string, number>();
        for (const line of order.lines) restore.set(String(line.productId), (restore.get(String(line.productId)) ?? 0) + line.qty);
        for (const [productId, qty] of restore) {
          const product = await ctx.db.get("products", productId as Id<"products">);
          if (!product || product.tenantId !== order.tenantId || (order.branchId && product.branchId && product.branchId !== order.branchId)) throw new ConvexError("Bidhaa ya bili haipatikani; stock haijabadilishwa.");
          const balance = product.currentQty + qty;
          await ctx.db.patch("products", product._id, { currentQty: balance });
          await ctx.db.insert("stockMovements", {
            ...orderScope, movementDate: now.slice(0, 10), productId: product._id,
            movementType: "waiter_order_cancel", referenceId: String(order._id),
            referenceType: "waiterOrder", qtyIn: qty, qtyOut: 0, runningBalance: balance,
            unitCost: product.weightedAvgCost ?? product.lastPurchaseCost ?? 0, createdBy: user._id,
          });
        }
      }
      if (order.stockDeducted) await restoreWaiterLotAllocations(ctx, order._id);
      await ctx.db.patch("waiterOrders", order._id, {
        status: "cancelled", stockDeducted: false, cancelledAt: now, cancelledBy: user._id, updatedAt: now,
      });
      await logAudit(ctx, user, {
        action: "cancel_selling_point_bill", module: "sales", referenceId: String(order._id),
        referenceType: "waiterOrder", details: `${order.invoiceNo ?? order._id}; ${order.total}; ${reason}${refund.refunded > 0 ? `; malipo yaliyorudishwa ${refund.refunded}` : ""}`,
      });
      return order._id;
    } catch (e) { throw surfaceError(e); }
  },
});

/** Active Bills screen only: sent bills leave the waiter's list; printed bills leave the cashier's list. */
export const listForBills = query({
  args: { table: v.optional(v.string()), includePrinted: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requirePermission(ctx, "waiterOrders.view", "waiterOrders");
    const scope = await viewScope(ctx, user).catch((e) => { throw surfaceError(e); });
    if (!scope.tenantId) return [];
    const rows = await ctx.db.query("waiterOrders").withIndex("by_scope_status", q => q.eq("tenantId", scope.tenantId)).collect();
    const needle = (args.table ?? "").trim().toLowerCase();
    return rows
      .filter(r => orderInScope(user, scope, r) && (!isWaiter(user.role) || r.branchId === scope.branchId) && r.status !== "cancelled" && r.status !== "placed" && (args.includePrinted || !r.billPrintedAt) && (!isWaiter(user.role) || !r.billSentAt) && billVisible(user, r))
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
      if (!o || !orderInScope(user, scope, o) || o.status === "cancelled") throw new ConvexError("Oda haipo kwenye biashara au tawi lako.");
      if (!billVisible(user, o)) throw new ConvexError("Hii si bili yako.");
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
      const scope = await viewScope(ctx, user);
      const now = new Date().toISOString();

      for (const id of [...new Set(args.orderIds.map(String))] as Id<"waiterOrders">[]) {
        const order = await ctx.db.get("waiterOrders", id);
        if (!order || !orderInScope(user, scope, order) || order.status === "cancelled") {
          throw new ConvexError("Oda haipo kwenye biashara au tawi lako.");
        }
        if (!billVisible(user, order)) {
          throw new ConvexError("Hii si bili yako.");
        }
        if (!order.billPrintedAt) {
          await ctx.db.patch("waiterOrders", order._id, {
            billPrintedAt: now,
            updatedAt: now,
          });
        }
      }
      return true;
    } catch (e) {
      throw surfaceError(e);
    }
  },
});

/**
 * A waiter generated his bill (picked his orders on the Bills screen) and now SENDS it to the cashier. Only then does the cashier see
 * these orders on his Bills screen. Only the waiter's own orders can be sent; nothing about stock, payments or sales changes.
 * Sending twice is harmless.
 */
export const sendBillToCashier = mutation({
  args: { orderIds: v.array(v.id("waiterOrders")) },
  handler: async (ctx, args) => {
    try {
      const user = await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
      if (!isWaiter(user.role)) throw new ConvexError("Ni mhudumu pekee anayetuma bili kwa cashier.");
      const scope = await viewScope(ctx, user);
      if (args.orderIds.length === 0) throw new ConvexError("Chagua angalau oda moja.");
      const now = new Date().toISOString();
      for (const id of [...new Set(args.orderIds.map(String))] as Id<"waiterOrders">[]) {
        const order = await ctx.db.get("waiterOrders", id);
        if (!order || !orderInScope(user, scope, order) || order.status === "cancelled" || order.status === "placed") throw new ConvexError("Oda haipo kwenye biashara au tawi lako.");
        if (order.waiterId !== user._id) throw new ConvexError("Hii si oda yako.");
        if (order.billPrintedAt) throw new ConvexError("Bili hii tayari imechapishwa.");
        if (!order.billSentAt) await ctx.db.patch("waiterOrders", order._id, { billSentAt: now, billSentBy: user._id, updatedAt: now });
      }
      await logAudit(ctx, user, { action: "send_bill_to_cashier", module: "sales", details: `oda ${args.orderIds.length}` });
      return true;
    } catch (e) {
      throw surfaceError(e);
    }
  },
});
