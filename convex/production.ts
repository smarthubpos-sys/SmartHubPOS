import { mutation, query, type MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { applyRecipePrice, recipeUnitPrices } from "./recipePricing";
import { logAudit, requireActiveUser, requireManagerOrPermission, resolveWriteScope } from "./access";

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
        return { ...line, productName: product?.name ?? "Bidhaa haipo", unitCost: product?.weightedAvgCost ?? product?.lastPurchaseCost ?? 0, sellingPrice: product?.sellingPrice ?? 0, currentQty: product?.currentQty ?? 0 };
      }));
      const unit = await recipeUnitPrices(ctx, r);
      return { ...r, outputName: output?.name ?? "Bidhaa haipo", outputSellingPrice: output?.sellingPrice ?? 0, computedPrice: unit.price, computedCost: unit.cost, ingredients };
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
    priceFromIngredients: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage", "stock");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kabla ya kuhifadhi recipe.");
    if (!Number.isFinite(args.outputQty) || args.outputQty <= 0) throw new ConvexError("Kiasi cha bidhaa inayotengenezwa lazima kiwe zaidi ya sifuri.");
    if (!args.ingredients.length) throw new ConvexError("Recipe lazima iwe na angalau malighafi moja.");
    const output = await ctx.db.get("products", args.outputProductId);
    if (!output || !belongsToScope(output, scope)) throw new ConvexError("Bidhaa ya mwisho haipo kwenye biashara/department hii.");
    const seen = new Set<string>();
    for (const line of args.ingredients) {
      if (!Number.isFinite(line.qty) || line.qty <= 0) throw new ConvexError("Kiasi cha kila malighafi lazima kiwe zaidi ya sifuri.");
      if (line.productId === args.outputProductId) throw new ConvexError("Bidhaa inayotengenezwa haiwezi kuwa malighafi yake yenyewe.");
      if (seen.has(String(line.productId))) throw new ConvexError("Malighafi imechaguliwa zaidi ya mara moja.");
      seen.add(String(line.productId));
      const ingredient = await ctx.db.get("products", line.productId);
      if (!ingredient || !belongsToScope(ingredient, scope)) throw new ConvexError("Malighafi haipo kwenye biashara/department hii.");
    }
    const existing = await ctx.db.query("productionRecipes").withIndex("by_output", q => q.eq("outputProductId", output._id)).collect();
    const prior = existing.find(r => r.tenantId === scope.tenantId && r.branchId === scope.branchId);
    const record = { ...scope, outputProductId: output._id, outputQty: args.outputQty, ingredients: args.ingredients, active: args.active, autoOnSale: args.autoOnSale === true, priceFromIngredients: args.priceFromIngredients === true, updatedAt: now(), updatedBy: user._id };
    const recipeId = prior ? prior._id : await ctx.db.insert("productionRecipes", record);
    if (prior) await ctx.db.patch("productionRecipes", prior._id, record);
    const saved = await ctx.db.get("productionRecipes", recipeId);
    if (saved) await applyRecipePrice(ctx, saved);
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
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kabla ya kuanzisha production.");
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new ConvexError("Kiasi cha production lazima kiwe zaidi ya sifuri.");
    const output = await ctx.db.get("products", args.outputProductId);
    if (!output || !belongsToScope(output, scope)) throw new ConvexError("Bidhaa ya mwisho haipo kwenye biashara/department hii.");
    const recipes = await ctx.db.query("productionRecipes").withIndex("by_output", q => q.eq("outputProductId", output._id)).collect();
    const recipe = recipes.find(r => r.tenantId === scope.tenantId && r.branchId === scope.branchId && r.active)
      ?? recipes.find(r => r.tenantId === scope.tenantId && r.branchId === undefined && r.active);
    if (!recipe) throw new ConvexError("Bidhaa hii haina recipe hai.");
    const factor = args.quantity / recipe.outputQty;
    const consumed = [];
    let totalCost = 0;
    // Validate all ingredient balances before writing any movement.
    for (const line of recipe.ingredients) {
      const product = await ctx.db.get("products", line.productId);
      const qty = line.qty * factor;
      if (!product || !belongsToScope(product, scope)) throw new ConvexError("Malighafi haipatikani kwenye department hii.");
      if (product.currentQty + 1e-8 < qty) throw new ConvexError(`Stock haitoshi kwa ${product.name}. Iliyopo: ${product.currentQty}, inahitajika: ${qty}.`);
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

/**
 * Take finished product back into the raw stock it was made from (unsold or spoiled-recipe batches, wrong batch quantity).
 * The finished product goes down and each ingredient goes up by the batch recipe, in proportion. The batch record is kept;
 * only its returnedQty grows, and every step is a stock movement so reports still reconcile.
 */
export const returnToStock = mutation({
  args: { batchId: v.id("productionBatches"), quantity: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage", "stock");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kabla ya kurudisha stock.");
    const batch = await ctx.db.get("productionBatches", args.batchId);
    if (!batch || !belongsToScope(batch, scope)) throw new ConvexError("Batch haipatikani kwenye biashara/department hii.");
    const reason = args.reason.trim();
    if (reason.length < 3) throw new ConvexError("Andika sababu ya kurudisha bidhaa kwenye stock.");
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new ConvexError("Kiasi cha kurudisha lazima kiwe zaidi ya sifuri.");
    const remaining = batch.producedQty - (batch.returnedQty ?? 0);
    if (args.quantity > remaining + 1e-8) throw new ConvexError(`Unaweza kurudisha hadi ${remaining} tu kutoka kwenye batch hii.`);
    const output = await ctx.db.get("products", batch.outputProductId);
    if (!output || !belongsToScope(output, scope)) throw new ConvexError("Bidhaa ya mwisho haipo kwenye biashara/department hii.");
    if (output.currentQty + 1e-8 < args.quantity) throw new ConvexError(`Stock ya ${output.name} haitoshi. Iliyopo: ${output.currentQty}, unayotaka kurudisha: ${args.quantity}. Huenda imeshauzwa.`);
    const factor = args.quantity / batch.producedQty;
    const lines = [];
    for (const l of batch.recipeSnapshot) {
      const product = await ctx.db.get("products", l.productId);
      if (!product || !belongsToScope(product, scope)) throw new ConvexError(`Malighafi ${l.productName} haipatikani kwenye department hii.`);
      lines.push({ product, qty: l.qty * factor, unitCost: l.unitCost });
    }
    const createdAt = now();
    const date = createdAt.slice(0, 10);
    const outBalance = output.currentQty - args.quantity;
    await ctx.db.patch("products", output._id, { currentQty: outBalance });
    await ctx.db.insert("stockMovements", {
      ...scope, movementDate: date, productId: output._id, movementType: "production_return_output", referenceId: String(batch._id), referenceType: "productionBatch",
      qtyIn: 0, qtyOut: args.quantity, runningBalance: outBalance, unitCost: batch.unitCost, notes: `Imerudishwa kwenye stock ya malighafi: ${reason}`, createdBy: user._id,
    });
    for (const { product, qty, unitCost } of lines) {
      const balance = product.currentQty + qty;
      const avg = product.weightedAvgCost !== undefined && product.currentQty > 0 ? (product.currentQty * product.weightedAvgCost + qty * unitCost) / balance : unitCost || product.weightedAvgCost;
      await ctx.db.patch("products", product._id, { currentQty: balance, ...(avg !== undefined ? { weightedAvgCost: avg } : {}) });
      await ctx.db.insert("stockMovements", {
        ...scope, movementDate: date, productId: product._id, movementType: "production_return_ingredient", referenceId: String(batch._id), referenceType: "productionBatch",
        qtyIn: qty, qtyOut: 0, runningBalance: balance, unitCost, notes: `Imerudi kutoka ${output.name}: ${reason}`, createdBy: user._id,
      });
    }
    await ctx.db.patch("productionBatches", batch._id, { returnedQty: (batch.returnedQty ?? 0) + args.quantity });
    await logAudit(ctx, user, { action: "production_return", module: "stock", referenceId: String(batch._id), details: `${output.name} x${args.quantity}: ${reason}` });
    return { returned: args.quantity, remaining: remaining - args.quantity, ingredients: lines.map((l) => ({ name: l.product.name, qty: l.qty })) };
  },
});

export const recentBatches = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "stock");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) return [];
    const rows = await ctx.db.query("productionBatches").withIndex("by_tenant_date", q => q.eq("tenantId", scope.tenantId)).order("desc").take(100);
    return Promise.all(rows.filter(r => belongsToScope(r, scope) && r.status !== "cancelled").map(async r => {
      const product = await ctx.db.get("products", r.outputProductId);
      return { ...r, outputName: product?.name ?? "Bidhaa haipo" };
    }));
  },
});

const EPS_PROD = 1e-8;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const AUTO_BATCH_NOTE = "Imetengenezwa yenyewe wakati wa mauzo";

/** A batch a user may still change: posted, not cancelled, nothing returned from it, and not one the system made by itself during a sale. */
async function editableBatch(ctx: MutationCtx, scope: Scope, batchId: Id<"productionBatches">) {
  const batch = await ctx.db.get("productionBatches", batchId);
  if (!batch || !belongsToScope(batch, scope)) throw new ConvexError("Batch haipatikani kwenye biashara/department hii.");
  if (batch.status === "cancelled") throw new ConvexError("Batch hii tayari imefutwa.");
  if ((batch.returnedQty ?? 0) > EPS_PROD) throw new ConvexError("Batch hii ina bidhaa zilizorudishwa kwenye stock. Haiwezi kubadilishwa au kufutwa.");
  if (batch.notes?.startsWith(AUTO_BATCH_NOTE)) throw new ConvexError("Batch hii ilitengenezwa yenyewe wakati wa mauzo. Rekebisha au futa mauzo husika badala yake.");
  const output = await ctx.db.get("products", batch.outputProductId);
  if (!output || !belongsToScope(output, scope)) throw new ConvexError("Bidhaa ya mwisho haipo kwenye biashara/department hii.");
  return { batch, output };
}

/**
 * Edit a batch you already made: change the quantity produced and/or the note.
 * Nothing is erased. The ingredients and the finished product move only by the DIFFERENCE (one stock movement each),
 * and the batch keeps its own record with the new quantity and the new cost.
 */
export const editBatch = mutation({
  args: { batchId: v.id("productionBatches"), quantity: v.number(), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage", "stock");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) throw new ConvexError("Kiasi cha production lazima kiwe zaidi ya sifuri.");
    const { batch, output } = await editableBatch(ctx, scope, args.batchId);
    const factor = args.quantity / batch.producedQty;
    const delta = round6(args.quantity - batch.producedQty);
    const notes = args.notes === undefined ? batch.notes : (args.notes.trim() || undefined);
    if (Math.abs(delta) <= EPS_PROD) {
      await ctx.db.patch("productionBatches", batch._id, { notes });
      await logAudit(ctx, user, { action: "production_edit", module: "stock", referenceId: String(batch._id), details: `${output.name}: maelezo yamebadilishwa` });
      return { batchId: batch._id, producedQty: batch.producedQty, totalCost: batch.totalCost, unitCost: batch.unitCost };
    }
    if (output.currentQty + delta < -EPS_PROD) throw new ConvexError(`Stock ya ${output.name} haitoshi kupunguza batch hii (iliyopo: ${output.currentQty}). Huenda sehemu imeshauzwa.`);
    const lines: Array<{ product: Doc<"products">; oldQty: number; newQty: number; unitCost: number; productName: string }> = [];
    for (const l of batch.recipeSnapshot) {
      const product = await ctx.db.get("products", l.productId);
      if (!product || !belongsToScope(product, scope)) throw new ConvexError(`Malighafi ${l.productName} haipatikani kwenye department hii.`);
      const newQty = round6(l.qty * factor);
      const extra = newQty - l.qty;
      if (extra > EPS_PROD && product.currentQty + EPS_PROD < extra) throw new ConvexError(`Stock haitoshi kwa ${product.name}. Iliyopo: ${product.currentQty}, inahitajika zaidi: ${round6(extra)}.`);
      lines.push({ product, oldQty: l.qty, newQty, unitCost: l.unitCost, productName: l.productName });
    }
    const date = now().slice(0, 10);
    for (const l of lines) {
      const extra = round6(l.newQty - l.oldQty); // > 0: more raw material used, < 0: raw material comes back
      if (Math.abs(extra) <= EPS_PROD) continue;
      const balance = round6(l.product.currentQty - extra);
      await ctx.db.patch("products", l.product._id, { currentQty: balance });
      await ctx.db.insert("stockMovements", {
        ...scope, movementDate: date, productId: l.product._id, movementType: "production_edit_ingredient", referenceId: String(batch._id), referenceType: "productionBatch",
        qtyIn: extra < 0 ? -extra : 0, qtyOut: extra > 0 ? extra : 0, runningBalance: balance, unitCost: l.unitCost, notes: `Batch ya ${output.name} imebadilishwa (${batch.producedQty} -> ${args.quantity})`, createdBy: user._id,
      });
    }
    const outBalance = round6(output.currentQty + delta);
    await ctx.db.patch("products", output._id, { currentQty: outBalance });
    await ctx.db.insert("stockMovements", {
      ...scope, movementDate: date, productId: output._id, movementType: "production_edit_output", referenceId: String(batch._id), referenceType: "productionBatch",
      qtyIn: delta > 0 ? delta : 0, qtyOut: delta < 0 ? -delta : 0, runningBalance: outBalance, unitCost: batch.unitCost, notes: `Batch imebadilishwa (${batch.producedQty} -> ${args.quantity})`, createdBy: user._id,
    });
    const snapshot = lines.map((l) => ({ productId: l.product._id, productName: l.productName, qty: l.newQty, unitCost: l.unitCost }));
    const totalCost = snapshot.reduce((n, l) => n + l.qty * l.unitCost, 0);
    await ctx.db.patch("productionBatches", batch._id, { plannedQty: args.quantity, producedQty: args.quantity, recipeSnapshot: snapshot, totalCost, unitCost: totalCost / args.quantity, notes });
    await logAudit(ctx, user, { action: "production_edit", module: "stock", referenceId: String(batch._id), details: `${output.name}: ${batch.producedQty} -> ${args.quantity}` });
    return { batchId: batch._id, producedQty: args.quantity, totalCost, unitCost: totalCost / args.quantity };
  },
});

/**
 * Delete a batch made by mistake: the ingredients go back on the shelf and the finished product comes off it.
 * The batch record is kept with status "cancelled" (never erased) and drops out of the lists. It cannot be deleted once any of
 * the finished product was sold or used (the stock would go negative), nor after a return to stock.
 */
export const deleteBatch = mutation({
  args: { batchId: v.id("productionBatches"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage", "stock");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    const { batch, output } = await editableBatch(ctx, scope, args.batchId);
    if (output.currentQty + EPS_PROD < batch.producedQty) throw new ConvexError(`Huwezi kufuta batch: stock ya ${output.name} (${output.currentQty}) ni ndogo kuliko iliyotengenezwa (${batch.producedQty}); sehemu imeshauzwa au kutumika.`);
    const lines: Array<{ product: Doc<"products">; qty: number; unitCost: number }> = [];
    for (const l of batch.recipeSnapshot) {
      const product = await ctx.db.get("products", l.productId);
      if (!product || !belongsToScope(product, scope)) throw new ConvexError(`Malighafi ${l.productName} haipatikani kwenye department hii.`);
      lines.push({ product, qty: l.qty, unitCost: l.unitCost });
    }
    const reason = args.reason?.trim();
    const date = now().slice(0, 10);
    const outBalance = round6(output.currentQty - batch.producedQty);
    await ctx.db.patch("products", output._id, { currentQty: outBalance });
    await ctx.db.insert("stockMovements", {
      ...scope, movementDate: date, productId: output._id, movementType: "production_cancel_output", referenceId: String(batch._id), referenceType: "productionBatch",
      qtyIn: 0, qtyOut: batch.producedQty, runningBalance: outBalance, unitCost: batch.unitCost, notes: `Batch imefutwa${reason ? `: ${reason}` : ""}`, createdBy: user._id,
    });
    for (const { product, qty, unitCost } of lines) {
      const balance = round6(product.currentQty + qty);
      await ctx.db.patch("products", product._id, { currentQty: balance });
      await ctx.db.insert("stockMovements", {
        ...scope, movementDate: date, productId: product._id, movementType: "production_cancel_ingredient", referenceId: String(batch._id), referenceType: "productionBatch",
        qtyIn: qty, qtyOut: 0, runningBalance: balance, unitCost, notes: `Batch ya ${output.name} imefutwa${reason ? `: ${reason}` : ""}`, createdBy: user._id,
      });
    }
    await ctx.db.patch("productionBatches", batch._id, { status: "cancelled", notes: [batch.notes, `Imefutwa ${date}${reason ? `: ${reason}` : ""}`].filter(Boolean).join(" | ") });
    await logAudit(ctx, user, { action: "production_delete", module: "stock", referenceId: String(batch._id), details: `${output.name} x${batch.producedQty}${reason ? `; ${reason}` : ""}` });
    return { ok: true, ingredients: lines.map((l) => ({ name: l.product.name, qty: l.qty })) };
  },
});

/** Delete a recipe (the finished product and its stock are untouched; batches already made keep their own snapshot). */
export const deleteRecipe = mutation({
  args: { recipeId: v.id("productionRecipes") },
  handler: async (ctx, args) => {
    const user = await requireManagerOrPermission(ctx, "stock.manage", "stock");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    const recipe = await ctx.db.get("productionRecipes", args.recipeId);
    if (!recipe || !belongsToScope(recipe, scope)) throw new ConvexError("Recipe haipatikani kwenye biashara/department hii.");
    const output = await ctx.db.get("products", recipe.outputProductId);
    await ctx.db.delete("productionRecipes", recipe._id);
    await logAudit(ctx, user, { action: "recipe_delete", module: "stock", referenceId: String(recipe._id), details: output?.name ?? "" });
    return { ok: true };
  },
});
