import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireActiveUser, requireManagerOrPermission, resolveWriteScope } from "./access";

type Scope = { tenantId?: Id<"tenants">; branchId?: Id<"branches"> };
const now = () => new Date().toISOString();
function belongsToScope(record: { tenantId?: Id<"tenants">; branchId?: Id<"branches"> }, scope: Scope) {
  return record.tenantId === scope.tenantId &&
    (record.branchId === scope.branchId || record.branchId === undefined);
}

export const listRecipes = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "stock");
    const scope = await resolveWriteScope(ctx, user);
    const rows = scope.tenantId
      ? await ctx.db.query("productionRecipes").withIndex("by_tenant", q => q.eq("tenantId", scope.tenantId)).collect()
      : [];
    return Promise.all(rows.filter(r => belongsToScope(r, scope)).map(async r => {
      const output = await ctx.db.get("products", r.outputProductId);
      const ingredients = await Promise.all(r.ingredients.map(async line => {
        const product = await ctx.db.get("products", line.productId);
        return { ...line, productName: product?.name ?? "Bidhaa haipo", unitCost: product?.weightedAvgCost ?? product?.lastPurchaseCost ?? 0, currentQty: product?.currentQty ?? 0 };
      }));
      return { ...r, outputName: output?.name ?? "Bidhaa haipo", ingredients };
    }));
  },
});

export const saveRecipe = mutation({
  args: {
    outputProductId: v.id("products"),
    outputQty: v.number(),
    ingredients: v.array(v.object({ productId: v.id("products"), qty: v.number() })),
    active: v.boolean(),
    autoOnSale: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage", "stock");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new Error("Chagua biashara kabla ya kuhifadhi recipe.");
    if (!Number.isFinite(args.outputQty) || args.outputQty <= 0) throw new Error("Kiasi cha bidhaa inayotengenezwa lazima kiwe zaidi ya sifuri.");
    if (!args.ingredients.length) throw new Error("Recipe lazima iwe na angalau malighafi moja.");
    const output = await ctx.db.get("products", args.outputProductId);
    if (!output || !belongsToScope(output, scope)) throw new Error("Bidhaa ya mwisho haipo kwenye biashara/department hii.");
    const seen = new Set<string>();
    for (const line of args.ingredients) {
      if (!Number.isFinite(line.qty) || line.qty <= 0) throw new Error("Kiasi cha kila malighafi lazima kiwe zaidi ya sifuri.");
      if (line.productId === args.outputProductId) throw new Error("Bidhaa inayotengenezwa haiwezi kuwa malighafi yake yenyewe.");
      if (seen.has(String(line.productId))) throw new Error("Malighafi imechaguliwa zaidi ya mara moja.");
      seen.add(String(line.productId));
      const ingredient = await ctx.db.get("products", line.productId);
      if (!ingredient || !belongsToScope(ingredient, scope)) throw new Error("Malighafi haipo kwenye biashara/department hii.");
    }
    const existing = await ctx.db.query("productionRecipes").withIndex("by_output", q => q.eq("outputProductId", output._id)).collect();
    const prior = existing.find(r => r.tenantId === scope.tenantId && r.branchId === scope.branchId);
    const record = { ...scope, outputProductId: output._id, outputQty: args.outputQty, ingredients: args.ingredients, active: args.active, autoOnSale: args.autoOnSale === true, updatedAt: now(), updatedBy: user._id };
    if (prior) await ctx.db.patch("productionRecipes", prior._id, record);
    else await ctx.db.insert("productionRecipes", record);
    return { ok: true };
  },
});

export const produceBatch = mutation({
  args: {
    outputProductId: v.id("products"),
    quantity: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage", "stock");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new Error("Chagua biashara kabla ya kuanzisha production.");
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new Error("Kiasi cha production lazima kiwe zaidi ya sifuri.");
    const output = await ctx.db.get("products", args.outputProductId);
    if (!output || !belongsToScope(output, scope)) throw new Error("Bidhaa ya mwisho haipo kwenye biashara/department hii.");
    const recipes = await ctx.db.query("productionRecipes").withIndex("by_output", q => q.eq("outputProductId", output._id)).collect();
    const recipe = recipes.find(r => r.tenantId === scope.tenantId && r.branchId === scope.branchId && r.active)
      ?? recipes.find(r => r.tenantId === scope.tenantId && r.branchId === undefined && r.active);
    if (!recipe) throw new Error("Bidhaa hii haina recipe hai.");
    const factor = args.quantity / recipe.outputQty;
    const consumed = [];
    let totalCost = 0;
    // Validate all ingredient balances before writing any movement.
    for (const line of recipe.ingredients) {
      const product = await ctx.db.get("products", line.productId);
      const qty = line.qty * factor;
      if (!product || !belongsToScope(product, scope)) throw new Error("Malighafi haipatikani kwenye department hii.");
      if (product.currentQty + 1e-8 < qty) throw new Error(`Stock haitoshi kwa ${product.name}. Iliyopo: ${product.currentQty}, inahitajika: ${qty}.`);
      const unitCost = product.weightedAvgCost ?? product.lastPurchaseCost ?? 0;
      consumed.push({ product, qty, unitCost });
      totalCost += qty * unitCost;
    }
    const createdAt = now();
    const snapshot = consumed.map(({ product, qty, unitCost }) => ({ productId: product._id, productName: product.name, qty, unitCost }));
    const batchId = await ctx.db.insert("productionBatches", {
      ...scope, outputProductId: output._id, plannedQty: args.quantity, producedQty: args.quantity,
      status: "completed", recipeSnapshot: snapshot, totalCost, unitCost: totalCost / args.quantity,
      notes: args.notes?.trim() || undefined, createdAt, createdBy: user._id,
    });
    for (const item of consumed) {
      const balance = item.product.currentQty - item.qty;
      await ctx.db.patch("products", item.product._id, { currentQty: balance });
      await ctx.db.insert("stockMovements", {
        ...scope, movementDate: createdAt.slice(0, 10), productId: item.product._id,
        movementType: "production_consumption", referenceId: String(batchId), referenceType: "productionBatch",
        qtyIn: 0, qtyOut: item.qty, runningBalance: balance, unitCost: item.unitCost, notes: `Production ya ${output.name}`, createdBy: user._id,
      });
    }
    const outputBalance = output.currentQty + args.quantity;
    await ctx.db.patch("products", output._id, { currentQty: outputBalance, weightedAvgCost: totalCost / args.quantity });
    await ctx.db.insert("stockMovements", {
      ...scope, movementDate: createdAt.slice(0, 10), productId: output._id,
      movementType: "production_output", referenceId: String(batchId), referenceType: "productionBatch",
      qtyIn: args.quantity, qtyOut: 0, runningBalance: outputBalance, unitCost: totalCost / args.quantity,
      notes: "Bidhaa iliyokamilika kutoka production", createdBy: user._id,
    });
    return { batchId, producedQty: args.quantity, totalCost, unitCost: totalCost / args.quantity };
  },
});

export const recentBatches = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "stock");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) return [];
    const rows = await ctx.db.query("productionBatches").withIndex("by_tenant_date", q => q.eq("tenantId", scope.tenantId)).order("desc").take(100);
    return Promise.all(rows.filter(r => belongsToScope(r, scope)).map(async r => {
      const product = await ctx.db.get("products", r.outputProductId);
      return { ...r, outputName: product?.name ?? "Bidhaa haipo" };
    }));
  },
});
