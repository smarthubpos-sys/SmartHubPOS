import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { canAccessRecord, filterScoped, requireActiveUser, resolveWriteScope, requirePermission, scopedRows } from "./access";
import { assertDate, assertFinite, getSystemAccount, postSystemJournal, roundMoney } from "./ledger";
const validQty = (n: number) => Number.isFinite(n) && n >= 0;
export const listMovements = query({ args: { productId: v.optional(v.id("products")) }, handler: async (ctx, args) => { const user = await requirePermission(ctx, "stock.view", "stock"); const all = args.productId ? await ctx.db.query("stockMovements").withIndex("by_product", q => q.eq("productId", args.productId!)).collect() : await scopedRows(ctx, user, "stockMovements"); return filterScoped(user, all).sort((a,b)=>b.movementDate.localeCompare(a.movementDate)); } });
export const adjust = mutation({ args: { productId: v.id("products"), newQty: v.number(), reason: v.string(), adjustmentDate: v.string() }, handler: async (ctx,args) => { const user = await requirePermission(ctx, "stock.adjust", "stock"); const scope = await resolveWriteScope(ctx, user); assertDate(args.adjustmentDate, "Tarehe ya marekebisho"); assertFinite(args.newQty, "Stock mpya"); if (!validQty(args.newQty) || !args.reason.trim()) throw new Error("Weka stock halali na sababu ya marekebisho."); const p = await ctx.db.get("products", args.productId); if (!canAccessRecord(user,p) || !p) throw new Error("Bidhaa haipatikani kwenye branch yako."); const delta = Math.round((args.newQty - p.currentQty) * 1e8) / 1e8; if (delta === 0) throw new Error("Kiasi kipya ni sawa na kilichopo; hakuna cha kurekebisha."); await ctx.db.patch("products", args.productId,{currentQty:args.newQty}); const id = await ctx.db.insert("stockAdjustments",{...scope,adjustmentDate:args.adjustmentDate,productId:args.productId,qtyBefore:p.currentQty,adjustmentQty:delta,qtyAfter:args.newQty,reason:args.reason,status:"approved",requestedBy:user._id,approvedBy:user._id,approvedAt:new Date().toISOString()}); await ctx.db.insert("stockMovements",{...scope,movementDate:args.adjustmentDate,productId:args.productId,movementType:"adjustment",referenceId:String(id),referenceType:"stockAdjustment",qtyIn:Math.max(delta,0),qtyOut:Math.max(-delta,0),runningBalance:args.newQty,unitCost:p.weightedAvgCost??p.lastPurchaseCost??0,notes:args.reason,createdBy:user._id});
 const value=roundMoney(Math.abs(delta)*(p.weightedAvgCost??p.lastPurchaseCost??0));
 if(value>0){const inventory=await getSystemAccount(ctx,scope,"1200","Inventory","asset");const adjustment=await getSystemAccount(ctx,scope,delta>0?"5100":"5200",delta>0?"Stock adjustment gain":"Stock shrinkage expense","expense");await postSystemJournal(ctx,{scope,userId:user._id,date:args.adjustmentDate,reference:`STOCK-${String(id)}`,description:`Stock adjustment: ${p.name} — ${args.reason}`,sourceType:"stock_adjustment",sourceId:String(id),lines:delta>0?[{accountId:inventory,debit:value,credit:0,description:"Stock increase"},{accountId:adjustment,debit:0,credit:value,description:"Stock adjustment gain"}]:[{accountId:adjustment,debit:value,credit:0,description:"Stock shrinkage"},{accountId:inventory,debit:0,credit:value,description:"Stock decrease"}]});}
 await ctx.db.insert("auditLogs",{userId:user._id,userName:user.name??user.email??"user",action:"stock_adjustment",module:"inventory",referenceId:String(id),referenceType:"stockAdjustment",details:`${p.name}: ${p.currentQty} -> ${args.newQty}. ${args.reason}`,timestamp:new Date().toISOString(),result:"success"}); return id; } });


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
        trackExpiry: !!p.trackExpiry, trackSerialNumbers: !!p.trackSerialNumbers, trackBatchNumbers: !!p.trackBatchNumbers,
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
      .map((x) => ({ _id: x._id, date: x.adjustmentDate, productName: pById.get(String(x.productId))?.name ?? "Bidhaa", itemCode: pById.get(String(x.productId))?.itemCode ?? "—", qtyBefore: x.qtyBefore, counted: x.qtyAfter, difference: x.adjustmentQty, reason: x.reason, status: x.status, cost: costOf(pById.get(String(x.productId))) }));

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
