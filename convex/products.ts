import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveUser, requireManagerOrPermission, requirePermission, roleHasPermission, canAccessRecord, filterScoped, resolveWriteScope, scopedRows } from "./access";
import { getSystemAccount, postSystemJournal, roundMoney } from "./ledger";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await scopedRows(ctx, user, "products"));
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await scopedRows(ctx, user, "products")).filter((p) => p.isActive);
  },
});

export const getById = query({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    const user = await requireActiveUser(ctx);
    const record = await ctx.db.get("products", args.id);
    return canAccessRecord(user, record) ? record : null;
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("products")),
    itemCode: v.string(),
    partNumber: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    groupId: v.optional(v.id("productGroups")),
    unitId: v.optional(v.id("unitsOfMeasure")),
    // Opening quantity/cost are only applied when a NEW product is created.
    // After that, stock changes only through Purchase, Sales and Quantity Adjustment.
    openingQty: v.optional(v.number()),
    openingCost: v.optional(v.number()),
    sellingPrice: v.number(),
    minStockLevel: v.optional(v.number()),
    reorderLevel: v.optional(v.number()),
    barcode: v.optional(v.string()),
    trackSerialNumbers: v.optional(v.boolean()),
    trackBatchNumbers: v.optional(v.boolean()),
    trackExpiry: v.optional(v.boolean()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    // New product: stock.manage (or manager). Changing / deactivating an EXISTING product: only with the stock.adjust permission.
    const user = args.id ? await requirePermission(ctx, "stock.adjust") : await requireManagerOrPermission(ctx, "stock.manage");
    const scope = await resolveWriteScope(ctx, user);

    const { id, openingQty, openingCost, ...data } = args;
    const itemCode = data.itemCode.trim();
    const name = data.name.trim();
    const barcode = data.barcode?.trim() || undefined;
    if (!itemCode || !name) throw new Error("Item code na jina la bidhaa vinahitajika.");
    if (!Number.isFinite(data.sellingPrice) || data.sellingPrice < 0) throw new Error("Bei ya kuuzia si sahihi.");
    for (const n of [data.minStockLevel, data.reorderLevel]) if (n !== undefined && (!Number.isFinite(n) || n < 0)) throw new Error("Reorder/minimum level si sahihi.");
    const clean = { ...data, itemCode, name, barcode };

    // Duplicate checks are limited to the user's own office/branch.
    const sameCode = (await ctx.db.query("products").withIndex("by_itemCode", (q) => q.eq("itemCode", itemCode)).collect())
      .filter((p) => p.tenantId === scope.tenantId && p.branchId === scope.branchId && p._id !== id);
    if (sameCode.length) throw new Error(`Item code ${itemCode} tayari ipo.`);
    if (barcode) {
      const sameBarcode = (await ctx.db.query("products").withIndex("by_barcode", (q) => q.eq("barcode", barcode)).collect())
        .filter((p) => p.tenantId === scope.tenantId && p.branchId === scope.branchId && p._id !== id);
      if (sameBarcode.length) throw new Error(`Barcode ${barcode} tayari inatumika na bidhaa nyingine.`);
    }

    if (id) {
      const existingRecord = await ctx.db.get("products", id);
      if (!existingRecord || !canAccessRecord(user, existingRecord)) throw new Error("Forbidden: record is outside your office/branch");
      await ctx.db.patch("products", id, clean); // never touches currentQty / openingQty / cost
      const changes: string[] = [];
      if (existingRecord.sellingPrice !== clean.sellingPrice) changes.push(`bei ${existingRecord.sellingPrice} -> ${clean.sellingPrice}`);
      if (existingRecord.name !== clean.name) changes.push(`jina ${existingRecord.name} -> ${clean.name}`);
      if (existingRecord.isActive !== clean.isActive) changes.push(clean.isActive ? "imewashwa" : "imezimwa");
      await ctx.db.insert("auditLogs", { userId: user._id, userName: user.name ?? user.email ?? "user", action: "modify_product", module: "inventory", referenceId: String(id), referenceType: "product", details: `${clean.name}${changes.length ? ": " + changes.join("; ") : ""}`, timestamp: new Date().toISOString(), result: "success" });
      return id;
    }

    const qty = openingQty ?? 0;
    const cost = openingCost ?? 0;
    if (!Number.isFinite(qty) || qty < 0) throw new Error("Opening quantity si sahihi.");
    if (!Number.isFinite(cost) || cost < 0) throw new Error("Opening cost si sahihi.");

    const productId = await ctx.db.insert("products", {
      ...clean,
      ...scope,
      openingQty: qty,
      currentQty: qty,
      weightedAvgCost: cost,
      lastPurchaseCost: cost > 0 ? cost : undefined,
    });
    if (qty > 0) {
      // Opening balance is recorded as a stock movement so every stock report reconciles.
      const today = new Date().toISOString().slice(0, 10);
      await ctx.db.insert("stockMovements", { ...scope, movementDate: today, productId, movementType: "opening", referenceId: String(productId), referenceType: "product", qtyIn: qty, qtyOut: 0, runningBalance: qty, unitCost: cost, notes: "Opening stock", createdBy: user._id });
      const value = roundMoney(qty * cost);
      if (value > 0) {
        const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
        const equity = await getSystemAccount(ctx, scope, "3000", "Opening balance equity", "equity");
        await postSystemJournal(ctx, { scope, userId: user._id, date: today, reference: `OPEN-${String(productId)}`, description: `Opening stock: ${clean.name}`, sourceType: "opening_stock", sourceId: String(productId), lines: [{ accountId: inventory, debit: value, credit: 0, description: "Opening stock" }, { accountId: equity, debit: 0, credit: value, description: "Opening balance equity" }] });
      }
    }
    await ctx.db.insert("auditLogs", { userId: user._id, userName: user.name ?? user.email ?? "user", action: "create_product", module: "inventory", referenceId: String(productId), referenceType: "product", details: `${clean.name} (${itemCode}); bei ${clean.sellingPrice}; opening ${qty}`, timestamp: new Date().toISOString(), result: "success" });
    return productId;
  },
});

// Product groups
export const listGroups = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await scopedRows(ctx, user, "productGroups"));
  },
});

export const upsertGroup = mutation({
  args: {
    id: v.optional(v.id("productGroups")),
    code: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage");
    const scope = await resolveWriteScope(ctx, user);
    const { id, ...data } = args;
    if (id) {
      const existingRecord = await ctx.db.get("productGroups", id);
      if (!canAccessRecord(user, existingRecord)) throw new Error("Forbidden: record is outside your office/branch");
      await ctx.db.patch("productGroups", id, data);
      return id;
    }
    return await ctx.db.insert("productGroups", { ...data, ...scope });
  },
});

// Units
export const listUnits = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return (await scopedRows(ctx, user, "unitsOfMeasure"));
  },
});

export const upsertUnit = mutation({
  args: {
    id: v.optional(v.id("unitsOfMeasure")),
    code: v.string(),
    name: v.string(),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage");
    const scope = await resolveWriteScope(ctx, user);
    const { id, ...data } = args;
    if (id) {
      const existingRecord = await ctx.db.get("unitsOfMeasure", id);
      if (!canAccessRecord(user, existingRecord)) throw new Error("Forbidden: record is outside your office/branch");
      await ctx.db.patch("unitsOfMeasure", id, data);
      return id;
    }
    return await ctx.db.insert("unitsOfMeasure", { ...data, ...scope });
  },
});

/* ───────── Excel import (rows are parsed in the browser from the system's template) ───────── */
const importRow = v.object({
  name: v.string(),
  itemCode: v.optional(v.string()),
  barcode: v.optional(v.string()),
  group: v.optional(v.string()),
  unit: v.optional(v.string()),
  sellingPrice: v.optional(v.number()),
  buyingPrice: v.optional(v.number()),
  quantity: v.optional(v.number()),
  reorderLevel: v.optional(v.number()),
});

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const codeFrom = (name: string, taken: Set<string>, prefix: string) => {
  const base = (name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) || prefix);
  let code = base, i = 1;
  while (taken.has(code)) code = `${base}${++i}`;
  taken.add(code);
  return code;
};

export const importBatch = mutation({
  args: { rows: v.array(importRow), dryRun: v.boolean(), updateExisting: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage");
    if (args.updateExisting && !(await roleHasPermission(ctx, user, "stock.adjust"))) throw new Error("Kuboresha bidhaa zilizopo kunahitaji ruhusa ya kubadili / kufuta stock (inatolewa na Super Admin). Ingiza bidhaa mpya tu.");
    const scope = await resolveWriteScope(ctx, user);
    if (args.rows.length > 400) throw new Error("Pakia hadi bidhaa 400 kwa mara moja.");
    // Read only THIS business (and department) through the by_scope index - never every business's products.
    const inScope = (r: { tenantId?: Id<"tenants">; branchId?: Id<"branches"> }) => r.tenantId === scope.tenantId && r.branchId === scope.branchId;
    const products = (await ctx.db.query("products").withIndex("by_scope", (q) => (scope.branchId ? q.eq("tenantId", scope.tenantId).eq("branchId", scope.branchId) : q.eq("tenantId", scope.tenantId))).collect()).filter(inScope);
    const groups = (await ctx.db.query("productGroups").withIndex("by_scope", (q) => (scope.branchId ? q.eq("tenantId", scope.tenantId).eq("branchId", scope.branchId) : q.eq("tenantId", scope.tenantId))).collect()).filter(inScope);
    const units = (await ctx.db.query("unitsOfMeasure").withIndex("by_scope", (q) => (scope.branchId ? q.eq("tenantId", scope.tenantId).eq("branchId", scope.branchId) : q.eq("tenantId", scope.tenantId))).collect()).filter(inScope);
    type KnownProduct = Partial<Doc<"products">> & { _id: Id<"products"> };
    const byCode = new Map<string, KnownProduct>(products.map((p) => [norm(p.itemCode), p]));
    const byBarcode = new Map<string, KnownProduct>(products.filter((p) => p.barcode).map((p) => [norm(p.barcode), p]));
    const byName = new Map(products.map((p) => [norm(p.name), p]));
    const groupByName = new Map(groups.flatMap((g) => [[norm(g.name), g._id], [norm(g.code), g._id]] as const));
    const unitByName = new Map(units.flatMap((u) => [[norm(u.name), u._id], [norm(u.code), u._id]] as const));
    const groupCodes = new Set(groups.map((g) => g.code.toUpperCase()));
    const unitCodes = new Set(units.map((u) => u.code.toUpperCase()));
    let nextNo = products.reduce((m, p) => { const x = /^ITM-(\d+)$/.exec(p.itemCode); return x ? Math.max(m, Number(x[1])) : m; }, 0);
    const today = new Date().toISOString().slice(0, 10);

    const seenNames = new Set<string>();
    const seenCodes = new Set<string>();
    const seenBarcodes = new Set<string>();
    const results: { row: number; status: "new" | "update" | "error"; itemCode?: string; message?: string }[] = [];
    let openingValue = 0;
    let created = 0, updated = 0;

    for (let i = 0; i < args.rows.length; i++) {
      const r = args.rows[i];
      const name = r.name.trim();
      const code = r.itemCode?.trim() || undefined;
      const barcode = r.barcode?.trim() || undefined;
      const fail = (message: string) => results.push({ row: i, status: "error", message });
      if (!name) { fail("Jina la bidhaa linahitajika."); continue; }
      for (const [label, n] of [["Bei ya kuuzia", r.sellingPrice], ["Bei ya manunuzi", r.buyingPrice], ["Idadi", r.quantity], ["Reorder level", r.reorderLevel]] as const) {
        if (n !== undefined && (!Number.isFinite(n) || n < 0)) { fail(`${label} si sahihi.`); }
      }
      if (results.some((x) => x.row === i)) continue;
      if (seenNames.has(norm(name)) || (code && seenCodes.has(norm(code))) || (barcode && seenBarcodes.has(norm(barcode)))) { fail("Bidhaa hii imerudiwa kwenye faili."); continue; }
      seenNames.add(norm(name)); if (code) seenCodes.add(norm(code)); if (barcode) seenBarcodes.add(norm(barcode));

      const existing = (code && byCode.get(norm(code))) || (barcode && byBarcode.get(norm(barcode))) || (!code && byName.get(norm(name))) || undefined;
      const barcodeOwner = barcode ? byBarcode.get(norm(barcode)) : undefined;
      if (barcodeOwner && existing && barcodeOwner._id !== existing._id) { fail(`Barcode ${barcode} tayari inatumika na bidhaa nyingine.`); continue; }
      if (!existing && barcodeOwner) { fail(`Barcode ${barcode} tayari inatumika na bidhaa nyingine.`); continue; }
      if (!existing && code && byCode.has(norm(code))) { fail(`Item code ${code} tayari ipo.`); continue; }

      // resolve / create group and unit by name
      let groupId = r.group?.trim() ? groupByName.get(norm(r.group)) : undefined;
      if (r.group?.trim() && !groupId && !args.dryRun) {
        groupId = await ctx.db.insert("productGroups", { ...scope, code: codeFrom(r.group, groupCodes, "GRP"), name: r.group.trim(), isActive: true });
        groupByName.set(norm(r.group), groupId);
      }
      let unitId = r.unit?.trim() ? unitByName.get(norm(r.unit)) : undefined;
      if (r.unit?.trim() && !unitId && !args.dryRun) {
        unitId = await ctx.db.insert("unitsOfMeasure", { ...scope, code: codeFrom(r.unit, unitCodes, "UNT"), name: r.unit.trim(), isActive: true });
        unitByName.set(norm(r.unit), unitId);
      }

      if (existing) {
        if (!args.updateExisting) { fail("Bidhaa tayari ipo (kuboresha zilizopo kumezimwa)."); continue; }
        const warn = r.quantity ? "Imepo: bei na taarifa zimeboreshwa; idadi haikuguswa (tumia Manunuzi au Marekebisho ya Kiasi)." : undefined;
        results.push({ row: i, status: "update", itemCode: existing.itemCode, message: warn });
        updated++;
        if (!args.dryRun) {
          const patch: Record<string, unknown> = {};
          if (r.sellingPrice !== undefined) patch.sellingPrice = r.sellingPrice;
          if (r.reorderLevel !== undefined) patch.reorderLevel = r.reorderLevel;
          if (barcode) patch.barcode = barcode;
          if (groupId) patch.groupId = groupId;
          if (unitId) patch.unitId = unitId;
          if (Object.keys(patch).length) await ctx.db.patch("products", existing._id, patch);
        }
        continue;
      }

      const itemCode = code ?? `ITM-${String(++nextNo).padStart(4, "0")}`;
      if (!code) while (byCode.has(norm(itemCode))) { /* sequence already past existing codes */ break; }
      results.push({ row: i, status: "new", itemCode });
      created++;
      if (args.dryRun) continue;
      const qty = r.quantity ?? 0, cost = r.buyingPrice ?? 0;
      const productId = await ctx.db.insert("products", {
        ...scope, itemCode, name, barcode, groupId, unitId,
        sellingPrice: r.sellingPrice ?? 0, reorderLevel: r.reorderLevel,
        openingQty: qty, currentQty: qty, weightedAvgCost: cost, lastPurchaseCost: cost > 0 ? cost : undefined, isActive: true,
      });
      byCode.set(norm(itemCode), { _id: productId, itemCode });
      if (barcode) byBarcode.set(norm(barcode), { _id: productId });
      if (qty > 0) {
        await ctx.db.insert("stockMovements", { ...scope, movementDate: today, productId, movementType: "opening", referenceId: String(productId), referenceType: "product", qtyIn: qty, qtyOut: 0, runningBalance: qty, unitCost: cost, notes: "Opening stock (Excel import)", createdBy: user._id });
        openingValue += qty * cost;
      }
    }

    if (!args.dryRun && roundMoney(openingValue) > 0) {
      const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
      const equity = await getSystemAccount(ctx, scope, "3000", "Opening balance equity", "equity");
      const ref = `IMPORT-${Date.now()}`;
      await postSystemJournal(ctx, { scope, userId: user._id, date: today, reference: ref, description: "Opening stock (Excel import)", sourceType: "opening_stock", sourceId: ref, lines: [{ accountId: inventory, debit: openingValue, credit: 0, description: "Imported opening stock" }, { accountId: equity, debit: 0, credit: openingValue, description: "Opening balance equity" }] });
    }
    if (!args.dryRun) {
      await ctx.db.insert("auditLogs", { tenantId: user.tenantId, userId: user._id, userName: user.name ?? user.email ?? "user", action: "import_products_excel", module: "inventory", details: `new ${created}, updated ${updated}, errors ${results.filter((x) => x.status === "error").length}`, timestamp: new Date().toISOString(), result: "success" });
    }
    return { results, created, updated, errors: results.filter((x) => x.status === "error").length };
  },
});
