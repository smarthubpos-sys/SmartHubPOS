/**
 * Edit / delete (cancel) purchase documents. Two permissions decide who may do it (Role Management or User Settings):
 *   purchasing.edit    - change a purchase invoice, purchase order or draft GRN
 *   purchasing.delete  - cancel a purchase invoice, purchase order, GRN or purchase return
 * Nothing is ever erased: a cancelled document stays with status "cancelled", stock and the ledger are reversed,
 * and the document drops out of every list total and report.
 */
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { canAccessBusinessRecord, canAccessRecord, logAudit, requireActiveUser, requirePermission } from "./access";
import { assertDate, assertPeriodOpen, getSystemAccount, methodAccount, postSystemJournal } from "./ledger";
import { bumpStats } from "./stats";
import { assertSupplierInvoiceFree } from "./purchasing";

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 1e-8;
const scopeOf = (r: { tenantId?: Id<"tenants">; branchId?: Id<"branches"> }) => ({ tenantId: r.tenantId, branchId: r.branchId });
const lineInput = v.object({ productId: v.id("products"), qty: v.number(), unitCost: v.number() });
type LineInput = { productId: Id<"products">; qty: number; unitCost: number };

async function postedReturns(ctx: QueryCtx, purchaseId: Id<"purchases">) {
  return (await ctx.db.query("purchaseReturns").withIndex("by_purchase", (q) => q.eq("purchaseId", purchaseId)).collect()).filter((r) => r.status === "posted");
}

/** Takes `qty` bought at `unitCost` back out of a product's weighted-average cost. */
function avgAfterRemoving(cur: number, avg: number, qty: number, unitCost: number) {
  const left = cur - qty;
  return left > EPS ? Math.max(0, round((cur * avg - qty * unitCost) / left)) : avg;
}

async function validLines(ctx: QueryCtx, u: Doc<"users">, lines: LineInput[], keep: Set<string> = new Set()) {
  if (!lines.length) throw new Error("Ongeza angalau bidhaa moja.");
  const out: Array<LineInput & { total: number }> = [];
  for (const l of lines) {
    if (!Number.isFinite(l.qty) || l.qty <= 0 || !Number.isFinite(l.unitCost) || l.unitCost < 0) throw new Error("Kiasi au gharama si sahihi.");
    const p = await ctx.db.get("products", l.productId);
    if (!p || !canAccessRecord(u, p) || (!p.isActive && !keep.has(String(l.productId)))) throw new Error("Bidhaa haipatikani kwenye branch yako.");
    out.push({ ...l, total: round(l.qty * l.unitCost) });
  }
  return out;
}

async function loadPurchase(ctx: QueryCtx, u: Doc<"users">, id: Id<"purchases">) {
  const purchase = await ctx.db.get("purchases", id);
  if (!purchase || !canAccessRecord(u, purchase)) throw new Error("Purchase invoice haipatikani.");
  if (purchase.status !== "posted") throw new Error("Invoice hii tayari imefutwa.");
  if ((await postedReturns(ctx, id)).length) throw new Error("Invoice hii ina Purchase Return. Futa return kwanza ndipo ubadilishe au kufuta invoice.");
  return purchase;
}

// ───────────────────────────── purchase invoices ─────────────────────────────

/** Everything the edit screen needs for one invoice. */
export const purchaseForEdit = query({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, a) => {
    const u = await requireActiveUser(ctx, "purchasing");
    const purchase = await ctx.db.get("purchases", a.purchaseId);
    if (!purchase || !canAccessRecord(u, purchase)) return null;
    const lines = await ctx.db.query("purchaseLines").withIndex("by_purchase", (q) => q.eq("purchaseId", a.purchaseId)).collect();
    return { purchase, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCost: l.unitCost })), hasReturns: (await postedReturns(ctx, a.purchaseId)).length > 0 };
  },
});

export const editPurchase = mutation({
  args: { purchaseId: v.id("purchases"), purchaseDate: v.optional(v.string()), supplierInvoiceNo: v.optional(v.string()), notes: v.optional(v.string()), lines: v.optional(v.array(lineInput)) },
  handler: async (ctx, a) => {
    const u = await requirePermission(ctx, "purchasing.edit", "purchasing");
    const purchase = await loadPurchase(ctx, u, a.purchaseId);
    const scope = scopeOf(purchase);
    const patch: Partial<Doc<"purchases">> = {};
    if (a.purchaseDate !== undefined) { assertDate(a.purchaseDate); if (a.purchaseDate !== purchase.purchaseDate) await assertPeriodOpen(ctx, scope, a.purchaseDate); patch.purchaseDate = a.purchaseDate; }
    if (a.supplierInvoiceNo !== undefined) {
      const typed = a.supplierInvoiceNo.trim();
      if (typed && typed !== (purchase.supplierInvoiceNo ?? "").trim()) await assertSupplierInvoiceFree(ctx, purchase.supplierId, typed, purchase._id);
      patch.supplierInvoiceNo = typed || purchase.invoiceNo || purchase.supplierInvoiceNo;
    }
    if (a.notes !== undefined) patch.notes = a.notes.trim() || undefined;
    const newDate = a.purchaseDate ?? purchase.purchaseDate;
    let newTotal = purchase.total;
    let newOutstanding = purchase.outstanding;

    if (a.lines) {
      const oldLines = await ctx.db.query("purchaseLines").withIndex("by_purchase", (q) => q.eq("purchaseId", a.purchaseId)).collect();
      const keep = new Set(oldLines.map((l) => String(l.productId)));
      const next = await validLines(ctx, u, a.lines, keep);
      newTotal = round(next.reduce((n, l) => n + l.total, 0));
      if (newTotal + EPS < purchase.amountPaid) throw new Error(`Jumla mpya (${newTotal}) ni chini ya kilicholipwa tayari (${purchase.amountPaid}). Punguza malipo kwanza au weka jumla kubwa zaidi.`);
      newOutstanding = round(newTotal - purchase.amountPaid);

      // Stock and average cost move by the difference per product.
      const ids = new Set<string>([...oldLines.map((l) => String(l.productId)), ...next.map((l) => String(l.productId))]);
      const stage: Array<{ id: Id<"products">; name: string; cur: number; net: number; newCur: number; avg: number | undefined; last: number | undefined; unitCost: number }> = [];
      for (const key of ids) {
        const id = key as Id<"products">;
        const product = await ctx.db.get("products", id);
        if (!product) throw new Error("Bidhaa haipo.");
        const oldQty = oldLines.filter((l) => l.productId === id).reduce((n, l) => n + l.qty, 0);
        const oldVal = oldLines.filter((l) => l.productId === id).reduce((n, l) => n + l.qty * l.unitCost, 0);
        const mine = next.filter((l) => l.productId === id);
        const newQty = mine.reduce((n, l) => n + l.qty, 0);
        const newVal = mine.reduce((n, l) => n + l.qty * l.unitCost, 0);
        const net = round(newQty - oldQty);
        const newCur = product.currentQty + net;
        if (newCur < -EPS) throw new Error(`Stock ya ${product.name} haitoshi kupunguza kiasi hiki (sehemu yake imeshauzwa au kutumika).`);
        const oldAvg = product.weightedAvgCost ?? product.lastPurchaseCost ?? 0;
        const avg = newCur > EPS ? Math.max(0, round((product.currentQty * oldAvg - oldVal + newVal) / newCur)) : product.weightedAvgCost;
        stage.push({ id, name: product.name, cur: product.currentQty, net, newCur, avg, last: mine.length ? mine[mine.length - 1].unitCost : undefined, unitCost: mine.length ? mine[mine.length - 1].unitCost : (oldLines.find((l) => l.productId === id)?.unitCost ?? 0) });
      }
      for (const s of stage) {
        const p: Partial<Doc<"products">> = { currentQty: s.newCur };
        if (s.avg !== undefined) p.weightedAvgCost = s.avg;
        if (s.last !== undefined) p.lastPurchaseCost = s.last;
        await ctx.db.patch("products", s.id, p);
        if (Math.abs(s.net) > EPS) await ctx.db.insert("stockMovements", { ...scope, movementDate: newDate, productId: s.id, movementType: "purchase_edit", referenceId: String(purchase._id), referenceType: "purchase", qtyIn: s.net > 0 ? s.net : 0, qtyOut: s.net < 0 ? -s.net : 0, runningBalance: s.newCur, unitCost: s.unitCost, supplierId: purchase.supplierId, notes: `Edit ${purchase.internalRef}`, createdBy: u._id });
      }
      for (const l of oldLines) await ctx.db.delete("purchaseLines", l._id);
      for (const l of next) await ctx.db.insert("purchaseLines", { purchaseId: a.purchaseId, productId: l.productId, qty: l.qty, qtyStr: String(l.qty), unitCost: l.unitCost, unitCostStr: String(l.unitCost), lineTotal: l.total, lineTotalStr: String(l.total), discount: 0, receivedQty: l.qty });

      // Ledger: only the difference is posted (more stock bought = more payable, and the reverse).
      const delta = round(newTotal - purchase.total);
      if (Math.abs(delta) > 0.004) {
        const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
        const payable = await getSystemAccount(ctx, scope, "2000", "Accounts payable", "liability");
        const up = delta > 0, amt = Math.abs(delta);
        await postSystemJournal(ctx, { scope, userId: u._id, date: newDate, reference: `PUREDIT-${purchase.internalRef}-${Date.now().toString(36).toUpperCase()}`, description: `Edited purchase ${purchase.internalRef}`, sourceType: "purchase_edit", sourceId: `${purchase._id}:${Date.now()}`, lines: [
          { accountId: inventory, debit: up ? amt : 0, credit: up ? 0 : amt, description: "Inventory adjusted by purchase edit" },
          { accountId: payable, debit: up ? 0 : amt, credit: up ? amt : 0, description: "Supplier payable adjusted by purchase edit" },
        ] });
      }
      patch.subtotal = newTotal; patch.total = newTotal; patch.outstanding = newOutstanding;
      patch.paymentStatus = newOutstanding <= 0 ? "paid" : purchase.amountPaid > 0 ? "partial" : "unpaid";
    }

    if (!Object.keys(patch).length) return { purchaseId: a.purchaseId, total: purchase.total };
    await ctx.db.patch("purchases", a.purchaseId, patch);
    if (newTotal !== purchase.total || newOutstanding !== purchase.outstanding || newDate !== purchase.purchaseDate) {
      await bumpStats(ctx, scope, { payable: -purchase.outstanding, date: purchase.purchaseDate, purchases: -purchase.total });
      await bumpStats(ctx, scope, { payable: newOutstanding, date: newDate, purchases: newTotal });
    }
    await logAudit(ctx, u, { action: "edit_purchase", module: "purchasing", referenceId: String(a.purchaseId), referenceType: "purchase", details: `${purchase.internalRef}; total ${purchase.total} -> ${newTotal}` });
    return { purchaseId: a.purchaseId, total: newTotal };
  },
});

export const voidPurchase = mutation({
  args: { purchaseId: v.id("purchases"), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const u = await requirePermission(ctx, "purchasing.delete", "purchasing");
    const purchase = await loadPurchase(ctx, u, a.purchaseId);
    const scope = scopeOf(purchase);
    const today = new Date().toISOString().slice(0, 10);
    const lines = await ctx.db.query("purchaseLines").withIndex("by_purchase", (q) => q.eq("purchaseId", a.purchaseId)).collect();
    const paidNow = (await ctx.db.query("supplierPayments").withIndex("by_purchase", (q) => q.eq("purchaseId", a.purchaseId)).collect()).filter((p) => !p.voided);
    const refunded = round(paidNow.reduce((n, p) => n + p.amount, 0));

    // 1. Stock must still be there: goods already sold cannot be "un-bought".
    const need = new Map<string, number>();
    for (const l of lines) need.set(String(l.productId), (need.get(String(l.productId)) ?? 0) + l.qty);
    for (const [id, qty] of need) {
      const p = await ctx.db.get("products", id as Id<"products">);
      if (p && p.currentQty + EPS < qty) throw new Error(`Huwezi kufuta invoice: stock ya ${p.name} (${p.currentQty}) ni ndogo kuliko iliyonunuliwa (${qty}); sehemu imeshauzwa au kutumika.`);
    }
    for (const l of lines) {
      const p = await ctx.db.get("products", l.productId);
      if (!p) continue;
      const left = p.currentQty - l.qty;
      const patch: Partial<Doc<"products">> = { currentQty: left };
      if (p.weightedAvgCost !== undefined) patch.weightedAvgCost = avgAfterRemoving(p.currentQty, p.weightedAvgCost, l.qty, l.unitCost);
      await ctx.db.patch("products", l.productId, patch);
      await ctx.db.insert("stockMovements", { ...scope, movementDate: today, productId: l.productId, movementType: "purchase_void", referenceId: String(a.purchaseId), referenceType: "purchase_void", qtyIn: 0, qtyOut: l.qty, runningBalance: left, unitCost: l.unitCost, supplierId: purchase.supplierId, notes: `Cancelled ${purchase.internalRef}`, createdBy: u._id });
    }

    // 2. Ledger: stock out; what was owed is cleared; money paid on receipt comes back to the account it left.
    const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
    const payable = await getSystemAccount(ctx, scope, "2000", "Accounts payable", "liability");
    const journal: Array<{ accountId: Id<"accounts">; debit: number; credit: number; description: string }> = [
      { accountId: inventory, debit: 0, credit: purchase.total, description: "Inventory reversed - cancelled purchase" },
      { accountId: payable, debit: round(purchase.total - refunded), credit: 0, description: "Supplier payable reversed" },
    ];
    for (const p of paidNow) journal.push({ accountId: await methodAccount(ctx, scope, { methodId: p.paymentMethodId, method: p.paymentMethod }), debit: p.amount, credit: 0, description: `Refund from supplier - ${p.paymentMethod}` });
    await postSystemJournal(ctx, { scope, userId: u._id, date: today, reference: `PURVOID-${purchase.internalRef}`, description: `Cancelled purchase ${purchase.internalRef}${a.reason ? ` - ${a.reason}` : ""}`, sourceType: "purchase_void", sourceId: String(a.purchaseId), lines: journal });

    // 3. Mark everything cancelled and keep the dashboard in step.
    for (const p of paidNow) await ctx.db.patch("supplierPayments", p._id, { voided: true });
    await ctx.db.patch("purchases", a.purchaseId, { status: "cancelled", cancelledAt: new Date().toISOString(), cancelledBy: u._id, amountPaid: 0, outstanding: 0, paymentStatus: "cancelled", notes: [purchase.notes, `Imefutwa ${today}${a.reason ? `: ${a.reason}` : ""}`].filter(Boolean).join(" | ") });
    await bumpStats(ctx, scope, { payable: -purchase.outstanding, date: purchase.purchaseDate, purchases: -purchase.total });
    await logAudit(ctx, u, { action: "void_purchase", module: "purchasing", referenceId: String(a.purchaseId), referenceType: "purchase", details: `${purchase.internalRef} cancelled; total ${purchase.total}; refunded ${refunded}${a.reason ? `; ${a.reason}` : ""}` });
    return { reference: purchase.invoiceNo ?? purchase.internalRef, refunded };
  },
});

// ───────────────────────────── purchase orders ─────────────────────────────

const EDITABLE_ORDER = ["draft", "pending_approval", "approved"];

async function loadOrder(ctx: QueryCtx, u: Doc<"users">, id: Id<"purchaseOrders">) {
  const order = await ctx.db.get("purchaseOrders", id);
  if (!order || !canAccessRecord(u, order)) throw new Error("Purchase Order haipatikani.");
  if (order.status === "cancelled") throw new Error("Order hii tayari imefutwa.");
  const lines = await ctx.db.query("purchaseOrderLines").withIndex("by_order", (q) => q.eq("orderId", id)).collect();
  if (!EDITABLE_ORDER.includes(order.status) || lines.some((l) => l.qtyReceived > EPS)) throw new Error("Order hii ina bidhaa zilizopokelewa (GRN). Futa GRN kwanza, au tumia Purchase Return.");
  return { order, lines };
}
const draftGrns = async (ctx: QueryCtx, orderId: Id<"purchaseOrders">) => (await ctx.db.query("goodsReceivedNotes").withIndex("by_po", (q) => q.eq("purchaseOrderId", orderId)).collect()).filter((g) => g.status === "draft");

export const orderForEdit = query({
  args: { orderId: v.id("purchaseOrders") },
  handler: async (ctx, a) => {
    const u = await requireActiveUser(ctx, "purchasing");
    const order = await ctx.db.get("purchaseOrders", a.orderId);
    if (!order || !canAccessRecord(u, order)) return null;
    const lines = await ctx.db.query("purchaseOrderLines").withIndex("by_order", (q) => q.eq("orderId", a.orderId)).collect();
    return { order, lines: lines.map((l) => ({ productId: l.productId, qty: l.qtyOrdered, unitCost: l.unitCost })), received: lines.some((l) => l.qtyReceived > EPS) };
  },
});

export const editPurchaseOrder = mutation({
  args: { orderId: v.id("purchaseOrders"), supplierId: v.optional(v.id("suppliers")), orderDate: v.optional(v.string()), expectedDelivery: v.optional(v.string()), notes: v.optional(v.string()), lines: v.optional(v.array(lineInput)) },
  handler: async (ctx, a) => {
    const u = await requirePermission(ctx, "purchasing.edit", "purchasing");
    const { order, lines: oldLines } = await loadOrder(ctx, u, a.orderId);
    const patch: Partial<Doc<"purchaseOrders">> = {};
    if (a.supplierId !== undefined) { const s = await ctx.db.get("suppliers", a.supplierId); if (!s || !canAccessBusinessRecord(u, s)) throw new Error("Supplier hayupo kwenye branch yako."); patch.supplierId = a.supplierId; }
    if (a.orderDate !== undefined) { assertDate(a.orderDate); patch.orderDate = a.orderDate; }
    if (a.expectedDelivery !== undefined) patch.expectedDelivery = a.expectedDelivery.trim() || undefined;
    if (a.notes !== undefined) patch.notes = a.notes.trim() || undefined;
    if (a.lines) {
      if ((await draftGrns(ctx, a.orderId)).length) throw new Error("Order hii ina GRN ya rasimu. Ifute kwanza kabla ya kubadilisha bidhaa.");
      const next = await validLines(ctx, u, a.lines, new Set(oldLines.map((l) => String(l.productId))));
      const total = round(next.reduce((n, l) => n + l.total, 0));
      for (const l of oldLines) await ctx.db.delete("purchaseOrderLines", l._id);
      for (const l of next) await ctx.db.insert("purchaseOrderLines", { orderId: a.orderId, productId: l.productId, qtyOrdered: l.qty, unitCost: l.unitCost, lineTotal: l.total, qtyReceived: 0 });
      patch.subtotal = total; patch.total = total;
    }
    if (Object.keys(patch).length) await ctx.db.patch("purchaseOrders", a.orderId, patch);
    await logAudit(ctx, u, { action: "edit_purchase_order", module: "purchasing", referenceId: String(a.orderId), referenceType: "purchaseOrder", details: `${order.orderRef}; total ${order.total} -> ${patch.total ?? order.total}` });
    return { orderId: a.orderId, total: patch.total ?? order.total };
  },
});

export const cancelPurchaseOrder = mutation({
  args: { orderId: v.id("purchaseOrders"), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const u = await requirePermission(ctx, "purchasing.delete", "purchasing");
    const { order } = await loadOrder(ctx, u, a.orderId);
    for (const g of await draftGrns(ctx, a.orderId)) await ctx.db.patch("goodsReceivedNotes", g._id, { status: "cancelled" });
    await ctx.db.patch("purchaseOrders", a.orderId, { status: "cancelled", notes: [order.notes, a.reason ? `Imefutwa: ${a.reason}` : "Imefutwa"].filter(Boolean).join(" | ") });
    await logAudit(ctx, u, { action: "cancel_purchase_order", module: "purchasing", referenceId: String(a.orderId), referenceType: "purchaseOrder", details: `${order.orderRef} cancelled${a.reason ? `; ${a.reason}` : ""}` });
    return { orderRef: order.orderRef };
  },
});

// ───────────────────────────── goods received notes ─────────────────────────────

export const grnForEdit = query({
  args: { grnId: v.id("goodsReceivedNotes") },
  handler: async (ctx, a) => {
    const u = await requireActiveUser(ctx, "purchasing");
    const grn = await ctx.db.get("goodsReceivedNotes", a.grnId);
    if (!grn || !canAccessRecord(u, grn)) return null;
    const lines = await ctx.db.query("grnLines").withIndex("by_grn", (q) => q.eq("grnId", a.grnId)).collect();
    return { grn, lines: lines.map((l) => ({ productId: l.productId, qtyReceived: l.qtyReceived, qtyRejected: l.qtyRejected })) };
  },
});

export const editGoodsReceivedNote = mutation({
  args: { grnId: v.id("goodsReceivedNotes"), receiptDate: v.optional(v.string()), notes: v.optional(v.string()), lines: v.optional(v.array(v.object({ productId: v.id("products"), qtyReceived: v.number(), qtyRejected: v.optional(v.number()) }))) },
  handler: async (ctx, a) => {
    const u = await requirePermission(ctx, "purchasing.edit", "purchasing");
    const grn = await ctx.db.get("goodsReceivedNotes", a.grnId);
    if (!grn || !canAccessRecord(u, grn)) throw new Error("GRN haipatikani.");
    if (grn.status !== "draft") throw new Error("GRN iliyothibitishwa imeshaongeza stock, haiwezi kubadilishwa. Ifute kisha uunde upya.");
    const patch: Partial<Doc<"goodsReceivedNotes">> = {};
    if (a.receiptDate !== undefined) { assertDate(a.receiptDate); patch.receiptDate = a.receiptDate; }
    if (a.notes !== undefined) patch.notes = a.notes.trim() || undefined;
    if (a.lines) {
      if (!a.lines.length) throw new Error("Ongeza bidhaa za kupokea.");
      const poLines = grn.purchaseOrderId ? await ctx.db.query("purchaseOrderLines").withIndex("by_order", (q) => q.eq("orderId", grn.purchaseOrderId!)).collect() : [];
      const clean: Array<{ productId: Id<"products">; qtyOrdered: number; qtyReceived: number; qtyRejected: number; unitCost: number }> = [];
      for (const l of a.lines) {
        const po = poLines.find((x) => x.productId === l.productId);
        if (!po) throw new Error("Bidhaa haipo kwenye Purchase Order.");
        const rejected = l.qtyRejected ?? 0;
        if (!Number.isFinite(l.qtyReceived) || l.qtyReceived < 0 || !Number.isFinite(rejected) || rejected < 0 || l.qtyReceived + rejected <= 0) throw new Error("Kiasi kilichopokelewa/kukataliwa si sahihi.");
        if (l.qtyReceived + rejected > po.qtyOrdered - po.qtyReceived + EPS) throw new Error("Kiasi kinazidi salio la Purchase Order.");
        clean.push({ productId: l.productId, qtyOrdered: po.qtyOrdered, qtyReceived: l.qtyReceived, qtyRejected: rejected, unitCost: po.unitCost });
      }
      for (const old of await ctx.db.query("grnLines").withIndex("by_grn", (q) => q.eq("grnId", a.grnId)).collect()) await ctx.db.delete("grnLines", old._id);
      for (const l of clean) await ctx.db.insert("grnLines", { grnId: a.grnId, ...l });
    }
    if (Object.keys(patch).length) await ctx.db.patch("goodsReceivedNotes", a.grnId, patch);
    await logAudit(ctx, u, { action: "edit_grn", module: "purchasing", referenceId: String(a.grnId), referenceType: "goodsReceivedNote", details: grn.grnRef });
    return { grnId: a.grnId };
  },
});

export const cancelGoodsReceivedNote = mutation({
  args: { grnId: v.id("goodsReceivedNotes"), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const u = await requirePermission(ctx, "purchasing.delete", "purchasing");
    const grn = await ctx.db.get("goodsReceivedNotes", a.grnId);
    if (!grn || !canAccessRecord(u, grn)) throw new Error("GRN haipatikani.");
    if (grn.status === "cancelled") throw new Error("GRN hii tayari imefutwa.");
    if (grn.status === "confirmed") {
      // Goods were added to stock: take them out again (only possible while they are still on the shelf).
      const scope = scopeOf(grn);
      const lines = await ctx.db.query("grnLines").withIndex("by_grn", (q) => q.eq("grnId", a.grnId)).collect();
      const need = new Map<string, number>();
      for (const l of lines) need.set(String(l.productId), (need.get(String(l.productId)) ?? 0) + l.qtyReceived);
      for (const [id, qty] of need) { const p = await ctx.db.get("products", id as Id<"products">); if (p && p.currentQty + EPS < qty) throw new Error(`Huwezi kufuta GRN: stock ya ${p.name} (${p.currentQty}) ni ndogo kuliko iliyopokelewa (${qty}); sehemu imeshauzwa au kutumika.`); }
      const today = new Date().toISOString().slice(0, 10);
      for (const l of lines) {
        const p = await ctx.db.get("products", l.productId);
        if (!p || l.qtyReceived <= EPS) continue;
        const left = p.currentQty - l.qtyReceived;
        const patch: Partial<Doc<"products">> = { currentQty: left };
        if (p.weightedAvgCost !== undefined) patch.weightedAvgCost = avgAfterRemoving(p.currentQty, p.weightedAvgCost, l.qtyReceived, l.unitCost);
        await ctx.db.patch("products", l.productId, patch);
        await ctx.db.insert("stockMovements", { ...scope, movementDate: today, productId: l.productId, movementType: "grn_void", referenceId: String(a.grnId), referenceType: "goodsReceivedNote", qtyIn: 0, qtyOut: l.qtyReceived, runningBalance: left, unitCost: l.unitCost, supplierId: grn.supplierId, notes: `Cancelled ${grn.grnRef}`, createdBy: u._id });
      }
      const value = round(lines.reduce((n, l) => n + round(l.qtyReceived * l.unitCost), 0));
      if (value > 0) {
        const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
        const grni = await getSystemAccount(ctx, scope, "2050", "Goods received not invoiced", "liability");
        await postSystemJournal(ctx, { scope, userId: u._id, date: today, reference: `GRNVOID-${grn.grnRef}`, description: `Cancelled ${grn.grnRef}`, sourceType: "grn_void", sourceId: String(a.grnId), lines: [{ accountId: grni, debit: value, credit: 0, description: "Goods received not invoiced reversed" }, { accountId: inventory, debit: 0, credit: value, description: "Inventory reversed - cancelled GRN" }] });
      }
      if (grn.purchaseOrderId) {
        const poLines = await ctx.db.query("purchaseOrderLines").withIndex("by_order", (q) => q.eq("orderId", grn.purchaseOrderId!)).collect();
        for (const l of lines) { const po = poLines.find((x) => x.productId === l.productId); if (po) { po.qtyReceived = Math.max(0, round(po.qtyReceived - l.qtyReceived)); await ctx.db.patch("purchaseOrderLines", po._id, { qtyReceived: po.qtyReceived }); } }
        const order = await ctx.db.get("purchaseOrders", grn.purchaseOrderId);
        if (order && order.status !== "cancelled") await ctx.db.patch("purchaseOrders", order._id, { status: poLines.every((x) => x.qtyReceived <= EPS) ? "approved" : poLines.every((x) => x.qtyReceived + EPS >= x.qtyOrdered) ? "fully_received" : "partially_received" });
      }
    }
    await ctx.db.patch("goodsReceivedNotes", a.grnId, { status: "cancelled", notes: [grn.notes, a.reason ? `Imefutwa: ${a.reason}` : "Imefutwa"].filter(Boolean).join(" | ") });
    await logAudit(ctx, u, { action: "cancel_grn", module: "purchasing", referenceId: String(a.grnId), referenceType: "goodsReceivedNote", details: `${grn.grnRef} cancelled${a.reason ? `; ${a.reason}` : ""}` });
    return { grnRef: grn.grnRef };
  },
});

// ───────────────────────────── purchase returns ─────────────────────────────

export const voidPurchaseReturn = mutation({
  args: { returnId: v.id("purchaseReturns"), reason: v.optional(v.string()) },
  handler: async (ctx: MutationCtx, a) => {
    const u = await requirePermission(ctx, "purchasing.delete", "purchasing");
    const ret = await ctx.db.get("purchaseReturns", a.returnId);
    if (!ret || !canAccessRecord(u, ret)) throw new Error("Purchase Return haipatikani.");
    if (ret.status !== "posted") throw new Error("Return hii tayari imefutwa.");
    const purchase = await ctx.db.get("purchases", ret.purchaseId);
    if (!purchase || purchase.status !== "posted") throw new Error("Invoice ya return hii imefutwa; return haiwezi kubadilishwa tena.");
    const scope = scopeOf(ret);
    const today = new Date().toISOString().slice(0, 10);
    const lines = await ctx.db.query("purchaseReturnLines").withIndex("by_return", (q) => q.eq("returnId", a.returnId)).collect();

    // Goods go back on the shelf.
    for (const l of lines) {
      const p = await ctx.db.get("products", l.productId);
      if (!p) continue;
      const bal = p.currentQty + l.qty;
      await ctx.db.patch("products", l.productId, { currentQty: bal });
      await ctx.db.insert("stockMovements", { ...scope, movementDate: today, productId: l.productId, movementType: "purchase_return_void", referenceId: String(a.returnId), referenceType: "purchaseReturn", qtyIn: l.qty, qtyOut: 0, runningBalance: bal, unitCost: l.unitCost, supplierId: ret.supplierId, notes: `Cancelled ${ret.returnRef}`, createdBy: u._id });
    }
    // Ledger: the supplier owes us nothing less than before.
    const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
    const payable = await getSystemAccount(ctx, scope, "2000", "Accounts payable", "liability");
    await postSystemJournal(ctx, { scope, userId: u._id, date: today, reference: `PRVOID-${ret.returnRef}`, description: `Cancelled purchase return ${ret.returnRef}`, sourceType: "purchase_return_void", sourceId: String(a.returnId), lines: [
      { accountId: inventory, debit: ret.total, credit: 0, description: "Goods back in stock" },
      { accountId: payable, debit: 0, credit: ret.total, description: "Supplier payable restored" },
    ] });
    await ctx.db.patch("purchaseReturns", a.returnId, { status: "cancelled", reason: [ret.reason, a.reason ? `Imefutwa: ${a.reason}` : "Imefutwa"].filter(Boolean).join(" | ") });
    // What the invoice still owes = total - paid - the returns that remain.
    const remaining = (await postedReturns(ctx, ret.purchaseId)).reduce((n, r) => n + r.total, 0);
    const outstanding = Math.max(0, round(purchase.total - purchase.amountPaid - remaining));
    await ctx.db.patch("purchases", ret.purchaseId, { outstanding, paymentStatus: outstanding <= 0 ? "paid" : purchase.amountPaid > 0 ? "partial" : "unpaid" });
    await bumpStats(ctx, scope, { payable: round(outstanding - purchase.outstanding) });
    await logAudit(ctx, u, { action: "void_purchase_return", module: "purchasing", referenceId: String(a.returnId), referenceType: "purchaseReturn", details: `${ret.returnRef} cancelled; total ${ret.total}${a.reason ? `; ${a.reason}` : ""}` });
    return { returnRef: ret.returnRef };
  },
});
