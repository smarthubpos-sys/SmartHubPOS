import { ingredientOnlyIds, onSalesMenu } from "./menuVisibility";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { canAccessRecord, filterScoped, logAudit, normalizeRole, requireActiveUser, resolveWriteScope, requirePermission, scopedRows } from "./access";
import { allocateSellingPointInvoiceNo, deductStockOnce } from "./waiterOrders";
import { assertDate, assertFinite, getSystemAccount, postSystemJournal, roundMoney } from "./ledger";
const validQty = (n: number) => Number.isFinite(n) && n >= 0;
export const listMovements = query({ args: { productId: v.optional(v.id("products")) }, handler: async (ctx, args) => { const user = await requirePermission(ctx, "stock.view", "stock"); const all = args.productId ? await ctx.db.query("stockMovements").withIndex("by_product", q => q.eq("productId", args.productId!)).collect() : await scopedRows(ctx, user, "stockMovements"); return filterScoped(user, all).sort((a,b)=>b.movementDate.localeCompare(a.movementDate)); } });
type AdjustCtx = MutationCtx;
type AdjustUser = Doc<"users">;
type AdjustScope = Awaited<ReturnType<typeof resolveWriteScope>>;

/** One stock correction: product quantity, adjustment record, stock movement, ledger entry and audit line. Shared by Quantity Adjustment and Stock Take. */
async function applyAdjustment(ctx: AdjustCtx, user: AdjustUser, scope: AdjustScope, args: { productId: Doc<"products">["_id"]; newQty: number; reason: string; adjustmentDate: string; reference?: string; baseQty?: number }) {
  assertFinite(args.newQty, "Stock mpya");
  if (!validQty(args.newQty) || !args.reason.trim()) throw new ConvexError("Weka stock halali na sababu ya marekebisho.");
  const p = await ctx.db.get("products", args.productId);
  if (!canAccessRecord(user, p) || !p) throw new ConvexError("Bidhaa haipatikani kwenye branch yako.");
  // baseQty = what the system showed on the adjustment date (stock take of a past day); the difference is then carried to today's quantity.
  const before = args.baseQty ?? p.currentQty;
  const delta = Math.round((args.newQty - before) * 1e8) / 1e8;
  if (delta === 0) throw new ConvexError("Kiasi kipya ni sawa na kilichopo; hakuna cha kurekebisha.");
  const finalQty = args.baseQty === undefined ? args.newQty : Math.round((p.currentQty + delta) * 1e8) / 1e8;
  if (!validQty(finalQty)) throw new ConvexError(`Marekebisho ya tarehe hii yangeshusha stock ya sasa ya ${p.name} chini ya sifuri; angalia mauzo ya baada ya tarehe hiyo.`);
  const unitCost = p.weightedAvgCost ?? p.lastPurchaseCost ?? 0;
  await ctx.db.patch("products", args.productId, { currentQty: finalQty });
  const id = await ctx.db.insert("stockAdjustments", { ...scope, adjustmentDate: args.adjustmentDate, productId: args.productId, qtyBefore: before, adjustmentQty: delta, qtyAfter: args.newQty, reason: args.reason, reference: args.reference, status: "approved", requestedBy: user._id, approvedBy: user._id, approvedAt: new Date().toISOString() });
  await ctx.db.insert("stockMovements", { ...scope, movementDate: args.adjustmentDate, productId: args.productId, movementType: "adjustment", referenceId: String(id), referenceType: "stockAdjustment", qtyIn: Math.max(delta, 0), qtyOut: Math.max(-delta, 0), runningBalance: finalQty, unitCost, notes: args.reason, createdBy: user._id });
  const value = roundMoney(Math.abs(delta) * unitCost);
  if (value > 0) {
    const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
    const adjustment = await getSystemAccount(ctx, scope, delta > 0 ? "5100" : "5200", delta > 0 ? "Stock adjustment gain" : "Stock shrinkage expense", "expense");
    await postSystemJournal(ctx, { scope, userId: user._id, date: args.adjustmentDate, reference: `STOCK-${String(id)}`, description: `Stock adjustment: ${p.name} — ${args.reason}`, sourceType: "stock_adjustment", sourceId: String(id), lines: delta > 0 ? [{ accountId: inventory, debit: value, credit: 0, description: "Stock increase" }, { accountId: adjustment, debit: 0, credit: value, description: "Stock adjustment gain" }] : [{ accountId: adjustment, debit: value, credit: 0, description: "Stock shrinkage" }, { accountId: inventory, debit: 0, credit: value, description: "Stock decrease" }] });
  }
  await ctx.db.insert("auditLogs", { userId: user._id, userName: user.name ?? user.email ?? "user", action: "stock_adjustment", module: "inventory", referenceId: String(id), referenceType: "stockAdjustment", details: `${p.name}: ${before} -> ${args.newQty}. ${args.reason}`, timestamp: new Date().toISOString(), result: "success" });
  return { id, delta, value };
}

export const adjust = mutation({
  args: { productId: v.id("products"), newQty: v.number(), reason: v.string(), adjustmentDate: v.string() },
  handler: async (ctx, args) => {
    const user = await requirePermission(ctx, "stock.adjust", "stock");
    const scope = await resolveWriteScope(ctx, user);
    assertDate(args.adjustmentDate, "Tarehe ya marekebisho");
    return (await applyAdjustment(ctx, user, scope, args)).id;
  },
});

const MAX_TAKE_LINES = 400; // each line writes ~5 documents; stays far below the per-mutation write limit

/**
 * STOCK TAKE: the counted quantities of many products are saved at once. Only products whose count differs from the system are adjusted
 * (system quantity -> counted), each as a normal Quantity Adjustment with the same ledger entry, and all share one stock-take reference.
 * The whole take is refused (nothing saved) when any line is invalid, so a take is never half applied.
 */
export const stockTake = mutation({
  args: { adjustmentDate: v.string(), reason: v.string(), lines: v.array(v.object({ productId: v.id("products"), counted: v.number() })), sellShortageTo: v.optional(v.id("users")) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.adjust", "stock");
    const scope = await resolveWriteScope(ctx, user);
    assertDate(a.adjustmentDate, "Tarehe ya stock take");
    const reason = a.reason.trim();
    if (!reason) throw new ConvexError("Weka sababu au jina la stock take (mfano: Stock take ya mwisho wa mwezi).");
    if (a.lines.length === 0) throw new ConvexError("Hakuna bidhaa zilizohesabiwa.");
    if (a.lines.length > MAX_TAKE_LINES) throw new ConvexError(`Hifadhi bidhaa zisizozidi ${MAX_TAKE_LINES} kwa mara moja; chagua group moja moja.`);
    const seen = new Set<string>();
    for (const l of a.lines) {
      if (seen.has(String(l.productId))) throw new ConvexError("Bidhaa moja imeorodheshwa mara mbili.");
      seen.add(String(l.productId));
      assertFinite(l.counted, "Kiasi kilichohesabiwa");
      if (!validQty(l.counted)) throw new ConvexError("Kiasi kilichohesabiwa lazima kiwe sifuri au zaidi.");
    }
    const reference = `ST-${a.adjustmentDate.replace(/-/g, "")}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
    let adjusted = 0, unchanged = 0, shortageValue = 0, overageValue = 0;
    // SELL THE SHORTAGE: what is missing on the shelf (counted < system) is sold, at the SELLING price, to the chosen staff member.
    // It becomes one Selling Point order on his account, so the cashier receives the money through "Receive waiters' money".
    // Overages are never sold: they are only added to stock as a normal adjustment.
    const soldLines: Array<{ productId: Id<"products">; productName: string; qty: number; unitPrice: number; lineTotal: number }> = [];
    let seller: Doc<"users"> | null = null;
    if (a.sellShortageTo) {
      await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
      seller = await ctx.db.get("users", a.sellShortageTo);
      if (!seller || seller.tenantId !== scope.tenantId || seller.isActive === false || ["super_admin", "superadmin"].includes(normalizeRole(seller.role))) throw new ConvexError("Mtumiaji aliyechaguliwa hayupo kwenye biashara hii.");
    }
    // Stock on the stock-take date = today's quantity minus everything that moved AFTER that date (same basis as the Closing Stock report).
    const later = new Map<string, number>();
    if (scope.tenantId) {
      const tenantId = scope.tenantId;
      const after = await ctx.db.query("stockMovements").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).gt("movementDate", a.adjustmentDate)).collect();
      for (const m of after) later.set(String(m.productId), (later.get(String(m.productId)) ?? 0) + m.qtyIn - m.qtyOut);
    }
    for (const l of a.lines) {
      const p = await ctx.db.get("products", l.productId);
      if (!p || !canAccessRecord(user, p)) throw new ConvexError("Bidhaa haipatikani kwenye branch yako.");
      const systemQty = Math.round((p.currentQty - (later.get(String(p._id)) ?? 0)) * 1e8) / 1e8;
      if (Math.round((l.counted - systemQty) * 1e8) === 0) { unchanged++; continue; }
      if (seller && l.counted < systemQty) {
        const qty = Math.round((systemQty - l.counted) * 1e8) / 1e8;
        if (!Number.isFinite(p.sellingPrice) || p.sellingPrice <= 0) throw new ConvexError(`Bei ya kuuzia ya ${p.name} haijawekwa; weka bei kwanza kabla ya kuuza upungufu.`);
        soldLines.push({ productId: p._id, productName: p.name, qty, unitPrice: p.sellingPrice, lineTotal: roundMoney(qty * p.sellingPrice) });
        adjusted++;
        shortageValue += roundMoney(qty * (p.weightedAvgCost ?? p.lastPurchaseCost ?? 0));
        continue;
      }
      const r = await applyAdjustment(ctx, user, scope, { productId: l.productId, newQty: l.counted, reason: `${reason} (${reference})`, adjustmentDate: a.adjustmentDate, reference, baseQty: systemQty });
      adjusted++;
      if (r.delta < 0) shortageValue += r.value; else overageValue += r.value;
    }
    let soldInvoiceNo: string | undefined, soldTotal = 0;
    if (seller && soldLines.length) {
      const now = new Date().toISOString();
      soldInvoiceNo = await allocateSellingPointInvoiceNo(ctx, user, scope.tenantId!);
      soldTotal = roundMoney(soldLines.reduce((n, x) => n + x.lineTotal, 0));
      const orderId = await ctx.db.insert("waiterOrders", {
        tenantId: scope.tenantId!, branchId: scope.branchId, invoiceNo: soldInvoiceNo,
        customerName: `Stock take ${reference}`, waiterId: seller._id, waiterName: seller.name || seller.username || "Staff",
        status: "pending", sentAt: now, stockDeducted: false, lines: soldLines, total: soldTotal,
        notes: `${reason} (${reference})`, createdAt: now, updatedAt: now,
      });
      const order = (await ctx.db.get("waiterOrders", orderId))!;
      await deductStockOnce(ctx, order, user, { tenantId: scope.tenantId, branchId: scope.branchId }); // takes the shortage out of stock; a failure rolls back the whole take
      await logAudit(ctx, user, { action: "stock_take_sell_shortage", module: "stock", referenceId: String(orderId), referenceType: "waiterOrder", details: `${reference}; ${soldInvoiceNo}; jumla ${soldTotal}; mhudumu ${seller.name || seller.username || ""}` });
    }
    return { reference, adjusted, unchanged, shortageValue: roundMoney(shortageValue), overageValue: roundMoney(overageValue), soldInvoiceNo, soldTotal, soldCount: soldLines.length };
  },
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round8 = (n: number) => Math.round((n + Number.EPSILON) * 1e8) / 1e8;
const costOf = (p: Pick<Doc<"products">, "weightedAvgCost" | "lastPurchaseCost"> | undefined) => p?.weightedAvgCost ?? p?.lastPurchaseCost ?? 0;

/**
 * Single source of truth for every Stock screen and report.
 * Quantities come from the product ledger (products.currentQty) and are cross-checked
 * against the sum of stock movements, so differences are visible instead of hidden.
 */
export const stockRegisters = query({
  args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()), light: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.view", "stock");
    // Fast path: only the movements from the period start onwards are read (opening balance = stock now minus those movements).
    // Screens that list products only read no movements at all. Callers that do not ask for `light` get the full, reconciled history.
    const fullHistory = a.light !== true;
    const needMovements = fullHistory || !!a.startDate || !!a.endDate;
    const partial = needMovements && !fullHistory && !!a.startDate && !!user.tenantId;
    const inRange = (d: string) => (!a.startDate || d >= a.startDate) && (!a.endDate || d <= a.endDate);
    const [productsRaw, groupsRaw, unitsRaw, movementsRaw, adjustmentsRaw, invoicesRaw] = await Promise.all([
      scopedRows(ctx, user, "products"), scopedRows(ctx, user, "productGroups"), scopedRows(ctx, user, "unitsOfMeasure"),
      !needMovements ? Promise.resolve([] as Doc<"stockMovements">[]) : partial
        ? ctx.db.query("stockMovements").withIndex("by_tenant_date", (q) => q.eq("tenantId", user.tenantId!).gte("movementDate", a.startDate!)).collect()
        : scopedRows(ctx, user, "stockMovements"),
      scopedRows(ctx, user, "stockAdjustments"),
      user.tenantId
        ? ctx.db.query("invoices").withIndex("by_tenant_date", (q) => { const b = q.eq("tenantId", user.tenantId!); if (a.startDate && a.endDate) return b.gte("invoiceDate", a.startDate).lte("invoiceDate", a.endDate); if (a.startDate) return b.gte("invoiceDate", a.startDate); if (a.endDate) return b.lte("invoiceDate", a.endDate); return b; }).collect()
        : scopedRows(ctx, user, "invoices"),
    ]);
    const products = filterScoped(user, productsRaw);
    const hiddenByDefault = await ingredientOnlyIds(ctx, user.tenantId);
    const groups = filterScoped(user, groupsRaw);
    const units = filterScoped(user, unitsRaw);
    const movements = filterScoped(user, movementsRaw).sort((x, y) => x.movementDate.localeCompare(y.movementDate) || x._creationTime - y._creationTime);
    const groupName = new Map(groups.map((g) => [String(g._id), g.name]));
    const unitName = new Map(units.map((u) => [String(u._id), u.name]));
    const pById = new Map(products.map((p) => [String(p._id), p]));

    // Per-product movement totals: before the period, inside the period, and all time.
    const agg = new Map<string, { before: number; inQty: number; outQty: number; all: number; running: number }>();
    for (const p of products) agg.set(String(p._id), { before: 0, inQty: 0, outQty: 0, all: 0, running: 0 });
    for (const m of movements) {
      const g = agg.get(String(m.productId)); if (!g) continue;
      const net = m.qtyIn - m.qtyOut;
      g.all += net;
      if (a.startDate && m.movementDate < a.startDate) g.before += net;
      else if (inRange(m.movementDate)) { g.inQty += m.qtyIn; g.outQty += m.qtyOut; }
    }
    // Without the full history there is nothing to compare against, so no false "difference" is reported.
    if (!fullHistory) for (const [id, g] of agg) { const cur = pById.get(id)?.currentQty ?? 0; if (partial) g.before = round8(cur - g.all); g.all = cur; }
    for (const g of agg.values()) g.running = g.before;

    // Resolve document numbers for the movements shown.
    const refCache = new Map<string, string>();
    const refOf = async (m: Doc<"stockMovements">) => {
      const key = `${m.referenceType}:${m.referenceId}`;
      if (refCache.has(key)) return refCache.get(key)!;
      let label = m.notes ?? "";
      try {
        if (m.referenceType === "invoice") { const id = ctx.db.normalizeId("invoices", m.referenceId ?? ""); const d = id ? await ctx.db.get("invoices", id) : null; label = d?.invoiceNo ?? label; }
        else if (m.referenceType === "purchase") { const id = ctx.db.normalizeId("purchases", m.referenceId ?? ""); const d = id ? await ctx.db.get("purchases", id) : null; label = d?.invoiceNo ? `Purchase #${d.invoiceNo}` : d?.internalRef ?? label; }
        else if (m.referenceType === "goodsReceivedNote" || m.referenceType === "purchaseReturn") label = m.notes ?? label;
        else if (m.referenceType === "stockAdjustment") label = m.notes ?? "Adjustment";
        else if (m.referenceType === "waiterOrder") { const id = ctx.db.normalizeId("waiterOrders", m.referenceId ?? ""); const d = id ? await ctx.db.get("waiterOrders", id) : null; label = d ? `Selling Point${d.tableNumber ? ` meza ${d.tableNumber}` : ""} - ${d.waiterName}` : label || "Selling Point"; }
      } catch { /* keep fallback label */ }
      refCache.set(key, label); return label;
    };
    const rows: Array<{ _id: Doc<"stockMovements">["_id"]; date: string; productId: Doc<"stockMovements">["productId"]; itemCode: string; productName: string; type: string; qtyIn: number; qtyOut: number; balance: number; unitCost: number; reference: string; notes: string }> = [];
    for (const m of movements) {
      const g = agg.get(String(m.productId)); const p = pById.get(String(m.productId)); if (!g || !p) continue;
      g.running = round8(g.running + m.qtyIn - m.qtyOut);
      if (!inRange(m.movementDate)) continue;
      rows.push({ _id: m._id, date: m.movementDate, productId: m.productId, itemCode: p.itemCode, productName: p.name, type: m.movementType, qtyIn: m.qtyIn, qtyOut: m.qtyOut, balance: g.running, unitCost: m.unitCost ?? 0, reference: await refOf(m), notes: m.notes ?? "" });
    }

    const productRows = products.map((p) => {
      const g = agg.get(String(p._id))!; const cost = costOf(p);
      return {
        _id: p._id, itemCode: p.itemCode, partNumber: p.partNumber ?? "", name: p.name, description: p.description ?? "", barcode: p.barcode ?? "",
        groupId: p.groupId, groupName: p.groupId ? groupName.get(String(p.groupId)) ?? "—" : "—", unitId: p.unitId, unitName: p.unitId ? unitName.get(String(p.unitId)) ?? "Unit" : "Unit",
        openingQty: p.openingQty, currentQty: p.currentQty, sellingPrice: p.sellingPrice, cost, lastPurchaseCost: p.lastPurchaseCost ?? 0, lastPurchaseDate: p.lastPurchaseDate ?? "",
        stockValue: round2(p.currentQty * cost), retailValue: round2(p.currentQty * p.sellingPrice),
        reorderLevel: p.reorderLevel ?? null, minStockLevel: p.minStockLevel ?? null, isActive: p.isActive,
        trackExpiry: !!p.trackExpiry, trackSerialNumbers: !!p.trackSerialNumbers, trackBatchNumbers: !!p.trackBatchNumbers, onMenu: onSalesMenu(p, hiddenByDefault),
        qtyBefore: round8(g.before), qtyIn: round8(g.inQty), qtyOut: round8(g.outQty), qtyEnd: round8(g.before + g.inQty - g.outQty),
        movementBalance: round8(g.all), difference: round8(p.currentQty - g.all),
      };
    }).sort((x, y) => x.name.localeCompare(y.name));

    // Earnings per item from posted invoices (invoice-level discount is spread across lines; tax excluded).
    const invoices = filterScoped(user, invoicesRaw).filter((i) => i.status === "posted" && inRange(i.invoiceDate));
    const earn = new Map<string, { qty: number; sales: number; cost: number; invoices: Set<string> }>();
    for (const inv of invoices) {
      const lines = await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id)).collect();
      const factor = inv.subtotal > 0 ? (inv.subtotal - inv.discount) / inv.subtotal : 1;
      for (const l of lines) {
        const kept = Math.max(0, l.qty - (l.returnedQty ?? 0)); if (kept <= 1e-8) continue; // goods taken back by a partial return are not "sold"
        const keep = l.qty > 0 ? kept / l.qty : 1;
        const e = earn.get(String(l.productId)) ?? { qty: 0, sales: 0, cost: 0, invoices: new Set<string>() };
        e.qty += kept; e.sales += l.lineTotal * keep * factor; e.cost += kept * l.costAtSale; e.invoices.add(String(inv._id));
        earn.set(String(l.productId), e);
      }
    }
    // Selling Point (waiter) sales: their stock left the shelf when the waiter sent / printed the order; the sale counts on the day the cashier received the money.
    if (user.tenantId) {
      const tenantId = user.tenantId;
      const collections = filterScoped(user, await ctx.db.query("waiterCollections").withIndex("by_tenant_date", (q) => {
        const b = q.eq("tenantId", tenantId);
        if (a.startDate && a.endDate) return b.gte("date", a.startDate).lte("date", a.endDate);
        if (a.startDate) return b.gte("date", a.startDate);
        if (a.endDate) return b.lte("date", a.endDate);
        return b;
      }).collect());
      for (const c of collections) {
        for (const orderId of c.orderIds) {
          const o = await ctx.db.get("waiterOrders", orderId); if (!o) continue;
          const part = c.allocations?.find((x) => x.orderId === orderId)?.amount; // partial payment: only the paid share of the order is earned now
          const share = part !== undefined && o.total > 0 ? Math.min(1, part / o.total) : 1;
          const moves = await ctx.db.query("stockMovements").withIndex("by_reference", (q) => q.eq("referenceType", "waiterOrder").eq("referenceId", String(o._id))).collect();
          const unitCostOf = (productId: string) => {
            let qty = 0, cost = 0;
            for (const m of moves) if (String(m.productId) === productId) { qty += m.qtyOut - m.qtyIn; cost += (m.qtyOut - m.qtyIn) * (m.unitCost ?? 0); }
            return qty > 1e-8 ? cost / qty : costOf(pById.get(productId));
          };
          for (const l of o.lines) {
            const e = earn.get(String(l.productId)) ?? { qty: 0, sales: 0, cost: 0, invoices: new Set<string>() };
            e.qty += l.qty * share; e.sales += l.lineTotal * share; e.cost += l.qty * share * unitCostOf(String(l.productId)); e.invoices.add(String(o._id));
            earn.set(String(l.productId), e);
          }
        }
      }
    }
    const earnings = [...earn.entries()].map(([id, e]) => {
      const p = pById.get(id); const profit = e.sales - e.cost;
      return { productId: id, itemCode: p?.itemCode ?? "—", productName: p?.name ?? "Bidhaa iliyofutwa", qtySold: round8(e.qty), invoices: e.invoices.size, sales: round2(e.sales), cost: round2(e.cost), profit: round2(profit), marginPct: e.sales > 0 ? round2((profit / e.sales) * 100) : 0 };
    }).sort((x, y) => y.profit - x.profit);

    const adjustments = filterScoped(user, adjustmentsRaw).filter((x) => inRange(x.adjustmentDate)).sort((x, y) => y.adjustmentDate.localeCompare(x.adjustmentDate))
      .map((x) => ({ _id: x._id, date: x.adjustmentDate, productName: pById.get(String(x.productId))?.name ?? "Bidhaa", itemCode: pById.get(String(x.productId))?.itemCode ?? "—", qtyBefore: x.qtyBefore, counted: x.qtyAfter, difference: x.adjustmentQty, reason: x.reason, reference: x.reference ?? "", status: x.status, cost: costOf(pById.get(String(x.productId))) }));

    const active = productRows.filter((p) => p.isActive);
    return {
      products: productRows, groups: groups.map((g) => ({ _id: g._id, code: g.code, name: g.name, description: g.description ?? "", isActive: g.isActive })), units: units.map((u) => ({ _id: u._id, code: u.code, name: u.name, isActive: u.isActive })),
      movements: rows, adjustments, earnings,
      totals: {
        items: active.length, stockValue: round2(active.reduce((n, p) => n + p.stockValue, 0)), retailValue: round2(active.reduce((n, p) => n + p.retailValue, 0)),
        outOfStock: active.filter((p) => p.currentQty <= 0).length, belowReorder: active.filter((p) => p.reorderLevel !== null && p.currentQty <= p.reorderLevel).length,
        mismatches: productRows.filter((p) => Math.abs(p.difference) > 1e-6).length,
      },
    };
  },
});


/** Historical inventory valuation reconstructed from dated stock movements using FIFO layers. */
export const historicalStockValue = query({
  args: { asOfDate: v.string(), groupId: v.optional(v.id("productGroups")) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.view", "stock");
    assertDate(a.asOfDate, "Tarehe ya valuation");
    const products = filterScoped(user, await scopedRows(ctx, user, "products"))
      .filter((p) => p.isActive && (!a.groupId || p.groupId === a.groupId));
    const groups = filterScoped(user, await scopedRows(ctx, user, "productGroups"));
    const groupNames = new Map(groups.map((g) => [String(g._id), g.name]));
    const productIds = new Set(products.map((p) => String(p._id)));
    const allMoves = filterScoped(user, await scopedRows(ctx, user, "stockMovements"))
      .filter((m) => productIds.has(String(m.productId)) && m.movementDate <= a.asOfDate)
      .sort((x, y) => x.movementDate.localeCompare(y.movementDate) || x._creationTime - y._creationTime);
    const layers = new Map<string, Array<{ qty: number; cost: number }>>();
    for (const p of products) layers.set(String(p._id), []);
    for (const m of allMoves) {
      const q = layers.get(String(m.productId)); if (!q) continue;
      if (m.qtyIn > 0) q.push({ qty: m.qtyIn, cost: m.unitCost ?? 0 });
      let out = m.qtyOut;
      while (out > 1e-8 && q.length) {
        const first = q[0]; const used = Math.min(first.qty, out);
        first.qty = round8(first.qty - used); out = round8(out - used);
        if (first.qty <= 1e-8) q.shift();
      }
      // If outbound history predates the first recorded receipt, retain an explicit zero-cost layer
      // rather than fabricating a historical purchase cost.
      if (out > 1e-8) q.unshift({ qty: out, cost: 0 });
    }
    const rows = products.map((p) => {
      const remaining = layers.get(String(p._id)) ?? [];
      const qty = round8(remaining.reduce((n, x) => n + x.qty, 0));
      const value = round2(remaining.reduce((n, x) => n + x.qty * x.cost, 0));
      const unknownQty = round8(remaining.filter((x) => x.cost <= 0).reduce((n, x) => n + x.qty, 0));
      return { productId: p._id, code: p.itemCode, name: p.name, groupName: p.groupId ? groupNames.get(String(p.groupId)) ?? "—" : "—", quantity: qty, value, averageCost: qty > 0 ? round2(value / qty) : 0, unknownCostQty: unknownQty };
    }).sort((x, y) => y.value - x.value);
    return { asOfDate: a.asOfDate, method: "FIFO", rows, totals: {
      quantity: round8(rows.reduce((n, x) => n + x.quantity, 0)),
      value: round2(rows.reduce((n, x) => n + x.value, 0)),
      unknownCostQty: round8(rows.reduce((n, x) => n + x.unknownCostQty, 0)),
    }};
  },
});

/** Lot/expiry register for goods already received. This is a traceability record; it does not change stock quantity. */
export const listTrackedLots = query({
  args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()), productId: v.optional(v.id("products")) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.view", "stock");
    const products = filterScoped(user, await scopedRows(ctx, user, "products"));
    const names = new Map(products.map((p) => [String(p._id), { name: p.name, code: p.itemCode }]));
    const rows = filterScoped(user, await scopedRows(ctx, user, "stockLots"))
      .filter((x) => (!a.productId || x.productId === a.productId) && (!a.startDate || (x.expiryDate ?? "") >= a.startDate) && (!a.endDate || (x.expiryDate ?? "") <= a.endDate))
      .map((x) => ({ ...x, productName: names.get(String(x.productId))?.name ?? "Bidhaa", itemCode: names.get(String(x.productId))?.code ?? "—" }))
      .sort((x, y) => (x.expiryDate ?? "9999").localeCompare(y.expiryDate ?? "9999"));
    return rows;
  },
});

export const registerStockLot = mutation({
  args: { productId: v.id("products"), lotNumber: v.string(), receivedDate: v.string(), expiryDate: v.optional(v.string()), quantity: v.number(), unitCost: v.number(), reference: v.optional(v.string()), notes: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.adjust", "stock");
    const scope = await resolveWriteScope(ctx, user);
    assertDate(a.receivedDate, "Tarehe ya kupokea");
    if (a.expiryDate) { assertDate(a.expiryDate, "Tarehe ya mwisho wa matumizi"); if (a.expiryDate < a.receivedDate) throw new ConvexError("Expiry date haiwezi kuwa kabla ya tarehe ya kupokea."); }
    if (!a.lotNumber.trim() || !(a.quantity > 0) || !(a.unitCost >= 0)) throw new ConvexError("Jaza lot number, quantity na unit cost sahihi.");
    const product = await ctx.db.get("products", a.productId);
    if (!product || !canAccessRecord(user, product) || !product.trackExpiry && !product.trackBatchNumbers) throw new ConvexError("Bidhaa hii haijawezeshwa Batch/Expiry tracking.");
    const duplicate = await ctx.db.query("stockLots").withIndex("by_lot", q => q.eq("tenantId", scope.tenantId).eq("productId", a.productId).eq("lotNumber", a.lotNumber.trim())).first();
    if (duplicate) throw new ConvexError("Lot number hii tayari imesajiliwa kwa bidhaa hii.");
    const existing = filterScoped(user, await scopedRows(ctx, user, "stockLots")).filter((x) => x.productId === a.productId).reduce((n, x) => n + x.quantityRemaining, 0);
    if (existing + a.quantity > product.currentQty + 1e-8) throw new ConvexError("Kiasi cha batch kinazidi stock iliyopo. Sajili kiasi kilichopokelewa tu.");
    return await ctx.db.insert("stockLots", { ...scope, productId: a.productId, lotNumber: a.lotNumber.trim(), receivedDate: a.receivedDate, expiryDate: a.expiryDate, quantityReceived: a.quantity, quantityRemaining: a.quantity, unitCost: a.unitCost, reference: a.reference, notes: a.notes, createdBy: user._id });
  },
});

export const listTrackedSerials = query({
  args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()), productId: v.optional(v.id("products")), status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.view", "stock");
    const products = filterScoped(user, await scopedRows(ctx, user, "products"));
    const names = new Map(products.map((p) => [String(p._id), { name: p.name, code: p.itemCode }]));
    return filterScoped(user, await scopedRows(ctx, user, "stockSerials"))
      .filter((x) => (!a.productId || x.productId === a.productId) && (!a.status || x.status === a.status) && (!a.startDate || x.receivedDate >= a.startDate) && (!a.endDate || x.receivedDate <= a.endDate))
      .map((x) => ({ ...x, productName: names.get(String(x.productId))?.name ?? "Bidhaa", itemCode: names.get(String(x.productId))?.code ?? "—" }))
      .sort((x, y) => y.receivedDate.localeCompare(x.receivedDate));
  },
});

export const registerStockSerials = mutation({
  args: { productId: v.id("products"), serialNumbers: v.array(v.string()), receivedDate: v.string(), unitCost: v.number(), lotId: v.optional(v.id("stockLots")), reference: v.optional(v.string()), notes: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.adjust", "stock");
    const scope = await resolveWriteScope(ctx, user);
    assertDate(a.receivedDate, "Tarehe ya kupokea");
    const serials = [...new Set(a.serialNumbers.map((x) => x.trim()).filter(Boolean))];
    if (!serials.length || serials.length !== a.serialNumbers.length || serials.length > 200 || !(a.unitCost >= 0)) throw new ConvexError("Weka serial numbers za kipekee (zisizozidi 200) na unit cost sahihi.");
    const product = await ctx.db.get("products", a.productId);
    if (!product || !canAccessRecord(user, product) || !product.trackSerialNumbers) throw new ConvexError("Bidhaa hii haijawezeshwa Serial Number tracking.");
    let linkedLot: Doc<"stockLots"> | null = null;
    if (product.trackExpiry || product.trackBatchNumbers) {
      if (!a.lotId) throw new ConvexError("Chagua batch/lot inayohusiana na serial numbers hizi.");
      linkedLot = await ctx.db.get("stockLots", a.lotId);
      if (!linkedLot || linkedLot.productId !== a.productId || linkedLot.tenantId !== scope.tenantId || linkedLot.branchId !== scope.branchId) throw new ConvexError("Batch/lot haipatikani kwenye biashara au tawi hili.");
      if (a.receivedDate < linkedLot.receivedDate) throw new ConvexError("Tarehe ya serial haiwezi kuwa kabla ya tarehe ya batch.");
      const inStockForLot = (await ctx.db.query("stockSerials").withIndex("by_product", q => q.eq("productId", a.productId)).collect()).filter(x => x.lotId === linkedLot!._id && x.status === "in_stock").length;
      if (inStockForLot + serials.length > linkedLot.quantityRemaining + 1e-8) throw new ConvexError("Serial numbers zinazidi vipande vilivyobaki kwenye batch hii.");
    }
    const existing = filterScoped(user, await scopedRows(ctx, user, "stockSerials")).filter((x) => x.productId === a.productId && x.status === "in_stock");
    if (existing.length + serials.length > Math.floor(product.currentQty)) throw new ConvexError("Serial numbers zinazidi vipande vya stock vilivyopo.");
    for (const serialNumber of serials) {
      const found = await ctx.db.query("stockSerials").withIndex("by_serial", q => q.eq("tenantId", scope.tenantId).eq("serialNumber", serialNumber)).first();
      if (found) throw new ConvexError(`Serial number ${serialNumber} tayari imesajiliwa.`);
    }
    for (const serialNumber of serials) await ctx.db.insert("stockSerials", { ...scope, productId: a.productId, serialNumber, receivedDate: a.receivedDate, status: "in_stock", unitCost: a.unitCost, lotId: linkedLot?._id, supplierId: linkedLot?.supplierId, reference: a.reference ?? linkedLot?.reference, receivedReference: a.reference ?? linkedLot?.reference, notes: a.notes, createdBy: user._id });
    return { created: serials.length };
  },
});

export const updateStockSerialStatus = mutation({
  args: { serialId: v.id("stockSerials"), status: v.string(), soldDate: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.adjust", "stock");
    if (!["in_stock", "sold", "returned", "scrapped"].includes(a.status)) throw new ConvexError("Hali ya serial si sahihi.");
    const row = await ctx.db.get("stockSerials", a.serialId);
    if (!row || !canAccessRecord(user, row)) throw new ConvexError("Serial number haipatikani.");
    if (a.soldDate) assertDate(a.soldDate, "Tarehe ya mauzo");
    await ctx.db.patch("stockSerials", a.serialId, { status: a.status, soldDate: a.status === "sold" ? (a.soldDate ?? new Date().toISOString().slice(0, 10)) : undefined });
  },
});

/** Repairs old products whose movement history does not add up to the current quantity (e.g. opening stock saved before movements existed). */
export const reconcileMovements = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "stock.adjust", "stock"); const scope = await resolveWriteScope(ctx, user);
    const products = (await scopedRows(ctx, user, "products"));
    const movements = (await scopedRows(ctx, user, "stockMovements"));
    const today = new Date().toISOString().slice(0, 10);
    let fixed = 0;
    const byProduct = new Map<string, typeof movements>();
    for (const m of movements) { const k = String(m.productId); const list = byProduct.get(k); if (list) list.push(m); else byProduct.set(k, [m]); }
    for (const p of products) {
      const mine = byProduct.get(String(p._id)) ?? [];
      const net = round8(mine.reduce((n, m) => n + m.qtyIn - m.qtyOut, 0));
      const diff = round8(p.currentQty - net);
      if (Math.abs(diff) <= 1e-6) continue;
      const firstDate = mine.length ? mine.map((m) => m.movementDate).sort()[0] : today;
      const isOpening = mine.length === 0 || (mine.every((m) => m.movementType !== "opening") && diff > 0);
      await ctx.db.insert("stockMovements", { ...scope, movementDate: isOpening ? firstDate : today, productId: p._id, movementType: isOpening ? "opening" : "adjustment", referenceId: String(p._id), referenceType: "reconcile", qtyIn: Math.max(diff, 0), qtyOut: Math.max(-diff, 0), runningBalance: p.currentQty, unitCost: costOf(p), notes: isOpening ? "Opening stock (reconciled)" : "Reconciliation to system quantity", createdBy: user._id });
      fixed++;
    }
    await ctx.db.insert("auditLogs", { userId: user._id, userName: user.name ?? user.email ?? "user", action: "reconcile_stock_movements", module: "inventory", details: `${fixed} product(s) reconciled`, timestamp: new Date().toISOString(), result: "success" });
    return { fixed };
  },
});

/** Staff the stock-taker can charge the missing stock to (active users of the business, never the Super Admin). */
export const sellableStaff = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "stock.adjust", "stock");
    const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
    if (!scope.tenantId) return [];
    const rows = await ctx.db.query("users").withIndex("by_scope", (q) => q.eq("tenantId", scope.tenantId!)).collect();
    return rows.filter((u) => u.isActive !== false && !["super_admin", "superadmin"].includes(normalizeRole(u.role))).map((u) => ({ _id: u._id, name: u.name ?? u.username ?? "", role: u.role ?? "" })).sort((x, y) => x.name.localeCompare(y.name));
  },
});
