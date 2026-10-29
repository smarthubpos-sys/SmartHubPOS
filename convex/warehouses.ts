import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requirePermission, logAudit } from "./access";

function positive(n: number) { return Number.isFinite(n) && n > 0; }
function round(n: number) { return Math.round((n + Number.EPSILON) * 10000) / 10000; }

async function scopedWarehouse(
  ctx: QueryCtx,
  id: Id<"warehouses">,
  tenantId: Id<"tenants"> | undefined,
  branchId?: Id<"branches">,
) {
  const row = await ctx.db.get("warehouses", id);
  if (!row || row.tenantId !== tenantId || !row.isActive) {
    throw new ConvexError("Ghala halipo au halitumiki kwenye biashara hii.");
  }
  if (branchId && row.branchId !== branchId) {
    throw new ConvexError("Huna ruhusa ya kufikia ghala la tawi hili.");
  }
  return row;
}

async function visibleWarehouseIds(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
  branchId?: Id<"branches">,
) {
  const warehouses = await ctx.db.query("warehouses")
    .withIndex("by_tenant", q => q.eq("tenantId", tenantId))
    .collect();
  return new Set(warehouses
    .filter(w => !branchId || w.branchId === branchId)
    .map(w => String(w._id)));
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "stock.store.view", "stock");
    if (!user.tenantId) return [];
    return (await ctx.db.query("warehouses").withIndex("by_tenant", q => q.eq("tenantId", user.tenantId!)).collect()).filter(w => w.isActive && (!user.branchId || w.branchId === user.branchId));
  },
});

export const create = mutation({
  args: { code: v.string(), name: v.string(), kind: v.string(), branchId: v.optional(v.id("branches")) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.manage", "stock");
    if (!user.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    const code = a.code.trim().toUpperCase(); const name = a.name.trim();
    if (!/^[A-Z0-9_-]{2,24}$/.test(code) || !name) throw new ConvexError("Weka code sahihi na jina la ghala.");
    if (!["warehouse", "shop", "store"].includes(a.kind)) throw new ConvexError("Aina ya eneo si sahihi.");
    if (user.branchId && a.branchId && a.branchId !== user.branchId) {
      throw new ConvexError("Huwezi kuunda ghala kwenye tawi tofauti na ulilochagua.");
    }
    const branchId = user.branchId ?? a.branchId;
    if (branchId) {
      const b = await ctx.db.get("branches", branchId);
      if (!b || b.tenantId !== user.tenantId || !b.isActive) throw new ConvexError("Branch si ya biashara hii au haifanyi kazi.");
    }
    const existing = await ctx.db.query("warehouses").withIndex("by_tenant_code", q => q.eq("tenantId", user.tenantId!).eq("code", code)).first();
    if (existing) throw new ConvexError("Code ya ghala tayari ipo.");
    const id = await ctx.db.insert("warehouses", { tenantId: user.tenantId, branchId, code, name, kind: a.kind, isActive: true, createdBy: user._id, createdAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: "warehouse_create", module: "stock", referenceId: String(id), referenceType: "warehouse", details: `${code} ${name}` });
    return id;
  },
});

export const stockBalances = query({
  args: { warehouseId: v.optional(v.id("warehouses")) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.view", "stock");
    if (!user.tenantId) return [];
    if (a.warehouseId) await scopedWarehouse(ctx, a.warehouseId, user.tenantId, user.branchId);
    const rows = a.warehouseId
      ? await ctx.db.query("warehouseStock").withIndex("by_warehouse", q => q.eq("warehouseId", a.warehouseId!)).collect()
      : await ctx.db.query("warehouseStock").withIndex("by_tenant", q => q.eq("tenantId", user.tenantId!)).collect();
    const out = [];
    for (const row of rows) {
      const product = await ctx.db.get("products", row.productId); const warehouse = await ctx.db.get("warehouses", row.warehouseId);
      if (
        product && warehouse &&
        product.tenantId === user.tenantId &&
        warehouse.tenantId === user.tenantId &&
        (!user.branchId || warehouse.branchId === user.branchId)
      ) {
        out.push({ ...row, productName: product.name, itemCode: product.itemCode, warehouseName: warehouse.name, stockValue: round(row.quantity * row.averageCost) });
      }
    }
    return out;
  },
});

/** Receive stock into a specific warehouse. It does not mutate shop-floor product.currentQty. */
export const receive = mutation({
  args: { idempotencyKey: v.optional(v.string()), warehouseId: v.id("warehouses"), productId: v.id("products"), quantity: v.number(), unitCost: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.receive", "stock");
    if (!user.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    if (!positive(a.quantity) || !Number.isFinite(a.unitCost) || a.unitCost < 0) throw new ConvexError("Kiasi au gharama si sahihi.");
    const warehouse = await scopedWarehouse(ctx, a.warehouseId, user.tenantId, user.branchId);
    if (a.idempotencyKey) {
      const dup = await ctx.db.query("warehouseMovements").withIndex("by_tenant_key", q => q.eq("tenantId", user.tenantId!).eq("idempotencyKey", a.idempotencyKey)).first();
      if (dup) {
        if (dup.movementType !== "receive" || dup.warehouseId !== a.warehouseId || (user.branchId && dup.branchId !== user.branchId)) {
          throw new ConvexError("Idempotency key hii tayari imetumika kwenye ghala au tawi jingine.");
        }
        return { quantity: dup.balance, averageCost: dup.unitCost, duplicate: true };
      }
    }
    const product = await ctx.db.get("products", a.productId);
    if (!product || product.tenantId !== user.tenantId || !product.isActive) throw new ConvexError("Bidhaa haipo kwenye biashara hii.");
    const row = await ctx.db.query("warehouseStock").withIndex("by_warehouse", q => q.eq("warehouseId", a.warehouseId)).collect().then(xs => xs.find(x => x.productId === a.productId));
    const oldQty = row?.quantity ?? 0; const oldCost = row?.averageCost ?? a.unitCost;
    const qty = round(oldQty + a.quantity); const avg = qty > 0 ? round(((oldQty * oldCost) + (a.quantity * a.unitCost)) / qty) : a.unitCost;
    if (row) await ctx.db.patch("warehouseStock", row._id, { quantity: qty, averageCost: avg, updatedAt: new Date().toISOString() });
    else await ctx.db.insert("warehouseStock", { tenantId: user.tenantId, branchId: warehouse.branchId, warehouseId: a.warehouseId, productId: a.productId, quantity: qty, averageCost: a.unitCost, updatedAt: new Date().toISOString() });
    await ctx.db.insert("warehouseMovements", { tenantId: user.tenantId, branchId: warehouse.branchId, warehouseId: a.warehouseId, productId: a.productId, movementType: "receive", quantityIn: a.quantity, quantityOut: 0, balance: qty, unitCost: a.unitCost, notes: a.note, idempotencyKey: a.idempotencyKey, createdBy: user._id, createdAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: "warehouse_receive", module: "stock", referenceId: String(a.productId), referenceType: "product", details: `${warehouse.code}: +${a.quantity} @ ${a.unitCost}` });
    return { quantity: qty, averageCost: avg, duplicate: false };
  },
});

export const createTransfer = mutation({
  args: { idempotencyKey: v.optional(v.string()), fromWarehouseId: v.id("warehouses"), toWarehouseId: v.id("warehouses"), note: v.optional(v.string()), lines: v.array(v.object({ productId: v.id("products"), quantity: v.number() })) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.transfer", "stock");
    if (!user.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    if (a.fromWarehouseId === a.toWarehouseId || !a.lines.length) throw new ConvexError("Chagua maghala mawili tofauti na angalau bidhaa moja.");
    const from = await scopedWarehouse(ctx, a.fromWarehouseId, user.tenantId, user.branchId);
    const to = await scopedWarehouse(ctx, a.toWarehouseId, user.tenantId);
    if (a.idempotencyKey) {
      const dup = await ctx.db.query("stockTransfers").withIndex("by_tenant_key", q => q.eq("tenantId", user.tenantId!).eq("idempotencyKey", a.idempotencyKey)).first();
      if (dup) {
        if (dup.fromWarehouseId !== from._id || dup.toWarehouseId !== to._id) {
          throw new ConvexError("Idempotency key hii tayari imetumika kwa uhamisho mwingine.");
        }
        return dup._id; // retry / double click: same transfer, nothing created twice
      }
    }
    const seen = new Set<string>(); const lines: { productId: Id<"products">; quantity: number; unitCost: number }[] = [];
    for (const line of a.lines) {
      if (!positive(line.quantity) || seen.has(String(line.productId))) throw new ConvexError("Kiasi lazima kiwe chanya na bidhaa zisijirudie."); seen.add(String(line.productId));
      const product = await ctx.db.get("products", line.productId); if (!product || product.tenantId !== user.tenantId || !product.isActive) throw new ConvexError("Bidhaa si ya biashara hii.");
      const row = await ctx.db.query("warehouseStock").withIndex("by_warehouse", q => q.eq("warehouseId", a.fromWarehouseId)).collect().then(xs => xs.find(x => x.productId === line.productId));
      if (!row || row.quantity < line.quantity) throw new ConvexError(`Stock haitoshi kwa ${product.name}.`);
      lines.push({ productId: line.productId, quantity: round(line.quantity), unitCost: row.averageCost });
    }
    const count = await ctx.db.query("stockTransfers").withIndex("by_tenant", q => q.eq("tenantId", user.tenantId!)).collect();
    const transferNo = `TR-${new Date().toISOString().slice(0,10).replaceAll("-", "")}-${String(count.length + 1).padStart(4,"0")}`;
    const id = await ctx.db.insert("stockTransfers", { tenantId: user.tenantId, branchId: from.branchId, transferNo, fromWarehouseId: from._id, toWarehouseId: a.toWarehouseId, status: "pending", note: a.note, idempotencyKey: a.idempotencyKey, createdBy: user._id, createdAt: new Date().toISOString() });
    for (const line of lines) await ctx.db.insert("stockTransferLines", { tenantId: user.tenantId, transferId: id, ...line });
    await logAudit(ctx, user, { action: "stock_transfer_create", module: "stock", referenceId: String(id), referenceType: "stockTransfer", details: `${transferNo}: ${from.code} -> ${(await ctx.db.get("warehouses", a.toWarehouseId))?.code ?? "?"}` });
    return id;
  },
});

/** Dispatch reserves/decrements source stock; receiving adds only confirmed quantities to destination. */
export const dispatchTransfer = mutation({
  args: { transferId: v.id("stockTransfers") },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.dispatch", "stock");
    const transfer = await ctx.db.get("stockTransfers", a.transferId);
    if (!transfer || transfer.tenantId !== user.tenantId) throw new ConvexError("Uhamisho haupo.");
    await scopedWarehouse(ctx, transfer.fromWarehouseId, user.tenantId, user.branchId);
    if (transfer.status !== "pending") throw new ConvexError("Uhamisho huu tayari umechakatwa.");
    const lines = await ctx.db.query("stockTransferLines").withIndex("by_transfer", q => q.eq("transferId", a.transferId)).collect();
    for (const line of lines) {
      const rows = await ctx.db.query("warehouseStock").withIndex("by_warehouse", q => q.eq("warehouseId", transfer.fromWarehouseId)).collect(); const row = rows.find(x => x.productId === line.productId);
      if (!row || row.quantity < line.quantity) throw new ConvexError("Stock imebadilika; hifadhi uhamisho upya baada ya kuhesabu stock.");
      const balance = round(row.quantity - line.quantity); await ctx.db.patch("warehouseStock", row._id, { quantity: balance, updatedAt: new Date().toISOString() });
      await ctx.db.insert("warehouseMovements", { tenantId: transfer.tenantId, branchId: transfer.branchId, warehouseId: transfer.fromWarehouseId, productId: line.productId, movementType: "transfer_out", quantityIn: 0, quantityOut: line.quantity, balance, unitCost: line.unitCost, referenceId: String(transfer._id), createdBy: user._id, createdAt: new Date().toISOString() });
    }
    await ctx.db.patch("stockTransfers", transfer._id, { status: "in_transit", dispatchedBy: user._id, dispatchedAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: "stock_transfer_dispatch", module: "stock", referenceId: String(transfer._id), referenceType: "stockTransfer", details: transfer.transferNo }); return true;
  },
});

export const receiveTransfer = mutation({
  args: { transferId: v.id("stockTransfers"), lines: v.array(v.object({ lineId: v.id("stockTransferLines"), receivedQuantity: v.number(), damagedQuantity: v.optional(v.number()), differenceNote: v.optional(v.string()) })) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.receive_transfer", "stock");
    const transfer = await ctx.db.get("stockTransfers", a.transferId);
    if (!transfer || transfer.tenantId !== user.tenantId) throw new ConvexError("Uhamisho haupo.");
    await scopedWarehouse(ctx, transfer.toWarehouseId, user.tenantId, user.branchId);
    if (transfer.status !== "in_transit") throw new ConvexError("Uhamisho lazima uwe umetumwa kwanza.");
    const all = await ctx.db.query("stockTransferLines").withIndex("by_transfer", q => q.eq("transferId", a.transferId)).collect();
    if (a.lines.length !== all.length || new Set(a.lines.map(x => String(x.lineId))).size !== all.length) throw new ConvexError("Thibitisha kila mstari wa uhamisho mara moja.");
    const dest = await scopedWarehouse(ctx, transfer.toWarehouseId, transfer.tenantId);
    for (const input of a.lines) {
      const line = all.find(x => x._id === input.lineId); if (!line || !Number.isFinite(input.receivedQuantity) || input.receivedQuantity < 0) throw new ConvexError("Kiasi kilichopokelewa si sahihi.");
      const damaged = input.damagedQuantity ?? 0;
      if (!Number.isFinite(damaged) || damaged < 0) throw new ConvexError("Kiasi kilichoharibika si sahihi.");
      if (round(input.receivedQuantity + damaged) > line.quantity) throw new ConvexError("Kilichopokelewa na kilichoharibika haviwezi kuzidi kilichotumwa.");
      const lost = round(line.quantity - input.receivedQuantity); // shortage + damaged: leaves the books, value written off
      if (lost > 0 && !input.differenceNote?.trim()) throw new ConvexError("Andika sababu ya tofauti ya kiasi kilichopokelewa.");
      const rows = await ctx.db.query("warehouseStock").withIndex("by_warehouse", q => q.eq("warehouseId", dest._id)).collect(); const row = rows.find(x => x.productId === line.productId);
      const oldQty = row?.quantity ?? 0; const newQty = round(oldQty + input.receivedQuantity); const oldCost = row?.averageCost ?? line.unitCost;
      const avg = newQty > 0 ? round(((oldQty * oldCost) + (input.receivedQuantity * line.unitCost)) / newQty) : line.unitCost;
      if (row) await ctx.db.patch("warehouseStock", row._id, { quantity: newQty, averageCost: avg, updatedAt: new Date().toISOString() });
      else await ctx.db.insert("warehouseStock", { tenantId: transfer.tenantId, branchId: dest.branchId, warehouseId: dest._id, productId: line.productId, quantity: newQty, averageCost: line.unitCost, updatedAt: new Date().toISOString() });
      await ctx.db.patch("stockTransferLines", line._id, { receivedQuantity: input.receivedQuantity, damagedQuantity: damaged || undefined, differenceNote: input.differenceNote });
      await ctx.db.insert("warehouseMovements", { tenantId: transfer.tenantId, branchId: dest.branchId, warehouseId: dest._id, productId: line.productId, movementType: "transfer_in", quantityIn: input.receivedQuantity, quantityOut: 0, balance: newQty, unitCost: line.unitCost, referenceId: String(transfer._id), notes: input.differenceNote, createdBy: user._id, createdAt: new Date().toISOString() });
      if (lost > 0) await ctx.db.insert("warehouseMovements", { tenantId: transfer.tenantId, branchId: dest.branchId, warehouseId: dest._id, productId: line.productId, movementType: "transfer_loss", quantityIn: 0, quantityOut: 0, quantityLost: lost, balance: newQty, unitCost: line.unitCost, referenceId: String(transfer._id), reason: damaged > 0 ? `damaged ${damaged}; ${input.differenceNote}` : input.differenceNote, notes: input.differenceNote, createdBy: user._id, createdAt: new Date().toISOString() });
    }
    await ctx.db.patch("stockTransfers", transfer._id, { status: "received", receivedBy: user._id, receivedAt: new Date().toISOString() });
    await logAudit(ctx, user, { action: "stock_transfer_receive", module: "stock", referenceId: String(transfer._id), referenceType: "stockTransfer", details: transfer.transferNo }); return true;
  },
});

export const transfers = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.view", "stock"); if (!user.tenantId) return [];
    const all = await ctx.db.query("stockTransfers").withIndex("by_tenant", q => q.eq("tenantId", user.tenantId!)).collect();
    const filtered = all.filter(t => !a.status || t.status === a.status).sort((x,y) => y.createdAt.localeCompare(x.createdAt));
    const visible = [];
    for (const t of filtered) {
      const from = await ctx.db.get("warehouses", t.fromWarehouseId);
      const to = await ctx.db.get("warehouses", t.toWarehouseId);
      if (!from || !to || from.tenantId !== user.tenantId || to.tenantId !== user.tenantId) continue;
      if (user.branchId && from.branchId !== user.branchId && to.branchId !== user.branchId) continue;
      visible.push({ ...t, from: from.name, to: to.name, lines: await ctx.db.query("stockTransferLines").withIndex("by_transfer", q => q.eq("transferId", t._id)).collect() });
    }
    return visible;
  },
});

/** Cancel a transfer that has not been dispatched. No stock has moved, so there is nothing to reverse. */
export const cancelTransfer = mutation({
  args: { transferId: v.id("stockTransfers"), reason: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.transfer", "stock");
    const transfer = await ctx.db.get("stockTransfers", a.transferId);
    if (!transfer || transfer.tenantId !== user.tenantId) throw new ConvexError("Uhamisho haupo.");
    await scopedWarehouse(ctx, transfer.fromWarehouseId, user.tenantId, user.branchId);
    if (transfer.status !== "pending") throw new ConvexError("Ni uhamisho ambao haujatumwa tu unaweza kufutwa.");
    if (!a.reason.trim()) throw new ConvexError("Andika sababu.");
    await ctx.db.patch("stockTransfers", transfer._id, { status: "cancelled", closedBy: user._id, closedAt: new Date().toISOString(), closeReason: a.reason.trim() });
    await logAudit(ctx, user, { action: "stock_transfer_cancel", module: "stock", referenceId: String(transfer._id), referenceType: "stockTransfer", details: `${transfer.transferNo}: ${a.reason.trim()}` });
    return true;
  },
});

/** Receiver refuses the whole shipment: the quantities go back to the source warehouse with ledger entries. */
export const rejectTransfer = mutation({
  args: { transferId: v.id("stockTransfers"), reason: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.receive_transfer", "stock");
    const transfer = await ctx.db.get("stockTransfers", a.transferId);
    if (!transfer || transfer.tenantId !== user.tenantId) throw new ConvexError("Uhamisho haupo.");
    await scopedWarehouse(ctx, transfer.toWarehouseId, user.tenantId, user.branchId);
    if (transfer.status !== "in_transit") throw new ConvexError("Uhamisho lazima uwe umetumwa kabla ya kukataliwa.");
    if (!a.reason.trim()) throw new ConvexError("Andika sababu ya kukataa.");
    const lines = await ctx.db.query("stockTransferLines").withIndex("by_transfer", q => q.eq("transferId", a.transferId)).collect();
    const now = new Date().toISOString();
    for (const line of lines) {
      const row = (await ctx.db.query("warehouseStock").withIndex("by_warehouse", q => q.eq("warehouseId", transfer.fromWarehouseId)).collect()).find(x => x.productId === line.productId);
      const oldQty = row?.quantity ?? 0; const qty = round(oldQty + line.quantity);
      if (row) await ctx.db.patch("warehouseStock", row._id, { quantity: qty, updatedAt: now });
      else await ctx.db.insert("warehouseStock", { tenantId: transfer.tenantId, branchId: transfer.branchId, warehouseId: transfer.fromWarehouseId, productId: line.productId, quantity: qty, averageCost: line.unitCost, updatedAt: now });
      await ctx.db.insert("warehouseMovements", { tenantId: transfer.tenantId, branchId: transfer.branchId, warehouseId: transfer.fromWarehouseId, productId: line.productId, movementType: "transfer_return", quantityIn: line.quantity, quantityOut: 0, balance: qty, unitCost: line.unitCost, referenceId: String(transfer._id), reason: a.reason.trim(), createdBy: user._id, createdAt: now });
    }
    await ctx.db.patch("stockTransfers", transfer._id, { status: "rejected", closedBy: user._id, closedAt: now, closeReason: a.reason.trim() });
    await logAudit(ctx, user, { action: "stock_transfer_reject", module: "stock", referenceId: String(transfer._id), referenceType: "stockTransfer", details: `${transfer.transferNo}: ${a.reason.trim()}` });
    return true;
  },
});

async function removeStock(ctx: MutationCtx, user: NonNullable<Awaited<ReturnType<typeof requirePermission>>>, a: { warehouseId: Id<"warehouses">; productId: Id<"products">; quantity: number; reason: string; idempotencyKey?: string }, type: "wastage" | "adjust_out") {
  if (!user.tenantId) throw new ConvexError("Chagua biashara kwanza.");
  if (!positive(a.quantity)) throw new ConvexError("Kiasi lazima kiwe chanya.");
  if (!a.reason.trim()) throw new ConvexError("Andika sababu.");
  const wh = await scopedWarehouse(ctx, a.warehouseId, user.tenantId, user.branchId);
  if (a.idempotencyKey) {
    const dup = await ctx.db.query("warehouseMovements").withIndex("by_tenant_key", q => q.eq("tenantId", user.tenantId!).eq("idempotencyKey", a.idempotencyKey)).first();
    if (dup) {
      if (dup.movementType !== type || dup.warehouseId !== a.warehouseId || (user.branchId && dup.branchId !== user.branchId)) {
        throw new ConvexError("Idempotency key hii tayari imetumika kwenye ghala au tawi jingine.");
      }
      return { quantity: dup.balance, duplicate: true };
    }
  }
  const row = (await ctx.db.query("warehouseStock").withIndex("by_warehouse", q => q.eq("warehouseId", a.warehouseId)).collect()).find(x => x.productId === a.productId);
  if (!row || row.quantity < a.quantity) throw new ConvexError("Stock haitoshi; hairuhusiwi kwenda hasi ya sifuri.");
  const balance = round(row.quantity - a.quantity); const now = new Date().toISOString();
  await ctx.db.patch("warehouseStock", row._id, { quantity: balance, updatedAt: now });
  await ctx.db.insert("warehouseMovements", { tenantId: user.tenantId, branchId: wh.branchId, warehouseId: a.warehouseId, productId: a.productId, movementType: type, quantityIn: 0, quantityOut: a.quantity, balance, unitCost: row.averageCost, reason: a.reason.trim(), notes: a.reason.trim(), idempotencyKey: a.idempotencyKey, createdBy: user._id, createdAt: now });
  await logAudit(ctx, user, { action: `warehouse_${type}`, module: "stock", referenceId: String(a.productId), referenceType: "product", details: `${wh.code}: -${a.quantity}: ${a.reason.trim()}` });
  return { quantity: balance, duplicate: false };
}

/** Spoilage / breakage / theft in a warehouse. Reason is mandatory; stock can never go negative. */
export const recordWastage = mutation({
  args: { idempotencyKey: v.optional(v.string()), warehouseId: v.id("warehouses"), productId: v.id("products"), quantity: v.number(), reason: v.string() },
  handler: async (ctx, a) => removeStock(ctx, await requirePermission(ctx, "stock.store.manage", "stock"), a, "wastage"),
});

/** Count correction (decrease). Requires the Super-Admin-granted stock.adjust permission, like shop-floor adjustments. */
export const adjustDown = mutation({
  args: { idempotencyKey: v.optional(v.string()), warehouseId: v.id("warehouses"), productId: v.id("products"), quantity: v.number(), reason: v.string() },
  handler: async (ctx, a) => removeStock(ctx, await requirePermission(ctx, "stock.adjust", "stock"), a, "adjust_out"),
});

export const adjustUp = mutation({
  args: { idempotencyKey: v.optional(v.string()), warehouseId: v.id("warehouses"), productId: v.id("products"), quantity: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.adjust", "stock");
    if (!user.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    if (!positive(a.quantity)) throw new ConvexError("Kiasi lazima kiwe chanya.");
    if (!a.reason.trim()) throw new ConvexError("Andika sababu.");
    const wh = await scopedWarehouse(ctx, a.warehouseId, user.tenantId, user.branchId);
    if (a.idempotencyKey) {
      const dup = await ctx.db.query("warehouseMovements").withIndex("by_tenant_key", q => q.eq("tenantId", user.tenantId!).eq("idempotencyKey", a.idempotencyKey)).first();
      if (dup) {
        if (dup.movementType !== "adjust_in" || dup.warehouseId !== a.warehouseId || (user.branchId && dup.branchId !== user.branchId)) {
          throw new ConvexError("Idempotency key hii tayari imetumika kwenye ghala au tawi jingine.");
        }
        return { quantity: dup.balance, duplicate: true };
      }
    }
    const row = (await ctx.db.query("warehouseStock").withIndex("by_warehouse", q => q.eq("warehouseId", a.warehouseId)).collect()).find(x => x.productId === a.productId);
    if (!row) throw new ConvexError("Bidhaa haina rekodi ya stock kwenye ghala hili; ipokee kwanza.");
    const balance = round(row.quantity + a.quantity); const now = new Date().toISOString();
    await ctx.db.patch("warehouseStock", row._id, { quantity: balance, updatedAt: now });
    await ctx.db.insert("warehouseMovements", { tenantId: user.tenantId, branchId: wh.branchId, warehouseId: a.warehouseId, productId: a.productId, movementType: "adjust_in", quantityIn: a.quantity, quantityOut: 0, balance, unitCost: row.averageCost, reason: a.reason.trim(), notes: a.reason.trim(), idempotencyKey: a.idempotencyKey, createdBy: user._id, createdAt: now });
    await logAudit(ctx, user, { action: "warehouse_adjust_in", module: "stock", referenceId: String(a.productId), referenceType: "product", details: `${wh.code}: +${a.quantity}: ${a.reason.trim()}` });
    return { quantity: balance, duplicate: false };
  },
});

/** Ledger history, newest first, paginated. Optional filters by warehouse / product / movement type. */
export const movements = query({
  args: { warehouseId: v.optional(v.id("warehouses")), productId: v.optional(v.id("products")), movementType: v.optional(v.string()), limit: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.store.view", "stock");
    if (!user.tenantId) return { rows: [], nextCursor: null as string | null };
    if (a.warehouseId) await scopedWarehouse(ctx, a.warehouseId, user.tenantId, user.branchId);
    const visibleIds = await visibleWarehouseIds(ctx, user.tenantId, user.branchId);
    const limit = Math.min(Math.max(Math.floor(a.limit ?? 50), 1), 200);
    // Pick the narrowest index; by_warehouse / by_product are not tenant-scoped, so tenant is always re-checked below.
    const base = ctx.db.query("warehouseMovements");
    const ordered = a.warehouseId
      ? base.withIndex("by_warehouse", q => q.eq("warehouseId", a.warehouseId!))
      : a.productId ? base.withIndex("by_product", q => q.eq("productId", a.productId!))
      : base.withIndex("by_tenant_date", q => q.eq("tenantId", user.tenantId!));
    const page = await ordered.order("desc").paginate({ numItems: limit, cursor: a.cursor ?? null });
    const rows = page.page.filter(m => m.tenantId === user.tenantId && visibleIds.has(String(m.warehouseId)) && (!a.productId || m.productId === a.productId) && (!a.movementType || m.movementType === a.movementType));
    return { rows, nextCursor: page.isDone ? null : page.continueCursor };
  },
});

/** Valuation at weighted-average cost per warehouse (the same method used for receipts and transfers). */
export const valuation = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "stock.store.view", "stock");
    if (!user.tenantId) return { byWarehouse: [], total: 0 };
    const allRows = await ctx.db.query("warehouseStock").withIndex("by_tenant", q => q.eq("tenantId", user.tenantId!)).collect();
    const visibleIds = await visibleWarehouseIds(ctx, user.tenantId, user.branchId);
    const rows = allRows.filter(r => visibleIds.has(String(r.warehouseId)));
    const map = new Map<string, number>();
    for (const r of rows) map.set(String(r.warehouseId), round((map.get(String(r.warehouseId)) ?? 0) + r.quantity * r.averageCost));
    const byWarehouse = [...map].map(([warehouseId, value]) => ({ warehouseId, value }));
    return { byWarehouse, total: round(byWarehouse.reduce((s, x) => s + x.value, 0)) };
  },
});

/** Differences (shortage/damage in transit) and wastage, with the value written off. */
export const lossReport = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "stock.store.view", "stock");
    if (!user.tenantId) return { rows: [], totalValue: 0 };
    const all = await ctx.db.query("warehouseMovements").withIndex("by_tenant_date", q => q.eq("tenantId", user.tenantId!)).collect();
    const visibleIds = await visibleWarehouseIds(ctx, user.tenantId, user.branchId);
    const rows = all.filter(m => visibleIds.has(String(m.warehouseId)) && (m.movementType === "transfer_loss" || m.movementType === "wastage")).map(m => {
      const qty = m.movementType === "wastage" ? m.quantityOut : (m.quantityLost ?? 0);
      return { ...m, lostQuantity: qty, lostValue: round(qty * m.unitCost) };
    });
    return { rows, totalValue: round(rows.reduce((s, r) => s + r.lostValue, 0)) };
  },
});

/** Reconciliation: every balance must equal the sum of its ledger entries. Returns the rows that do not. */
export const reconcile = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "stock.store.view", "stock");
    if (!user.tenantId) return [];
    const allStock = await ctx.db.query("warehouseStock").withIndex("by_tenant", q => q.eq("tenantId", user.tenantId!)).collect();
    const allMoves = await ctx.db.query("warehouseMovements").withIndex("by_tenant_date", q => q.eq("tenantId", user.tenantId!)).collect();
    const visibleIds = await visibleWarehouseIds(ctx, user.tenantId, user.branchId);
    const stock = allStock.filter(r => visibleIds.has(String(r.warehouseId)));
    const moves = allMoves.filter(m => visibleIds.has(String(m.warehouseId)));
    const sums = new Map<string, number>();
    for (const m of moves) { const k = `${m.warehouseId}|${m.productId}`; sums.set(k, round((sums.get(k) ?? 0) + m.quantityIn - m.quantityOut)); }
    const bad = [];
    for (const r of stock) { const ledger = sums.get(`${r.warehouseId}|${r.productId}`) ?? 0; if (Math.abs(ledger - r.quantity) > 0.0001) bad.push({ warehouseId: r.warehouseId, productId: r.productId, balance: r.quantity, ledger }); }
    return bad;
  },
});
