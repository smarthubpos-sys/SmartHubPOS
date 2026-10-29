import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Recipe-driven products ("Mbuzi Makange" made from mbuzi 400g + nyanya 100g + vitunguu ...).
 *
 * A recipe marked `autoOnSale` is produced AT THE MOMENT OF SALE: when a sale / waiter order needs more of that product than the
 * stock holds, the shortfall is produced first from the recipe (ingredients leave stock, a production batch is recorded, the finished
 * product enters stock with its real cost) and the normal sale then takes it out. Because the sale code itself is unchanged, cancelling,
 * voiding, returning, reports and accounting keep working exactly as before; the cost of goods sold is the real cost of the ingredients.
 * Everything runs inside the sale's own transaction: if an ingredient is short, nothing is saved and the person is told which one.
 */
type Scope = { tenantId?: Id<"tenants">; branchId?: Id<"branches"> };
const EPS = 1e-8;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function inScope(record: { tenantId?: Id<"tenants">; branchId?: Id<"branches"> }, scope: Scope) {
  return record.tenantId === scope.tenantId && (record.branchId === undefined || record.branchId === scope.branchId);
}

/** The active auto-on-sale recipe of this product in this department (a department recipe wins over a business-wide one). */
export async function autoRecipeFor(ctx: QueryCtx, scope: Scope, productId: Id<"products">): Promise<Doc<"productionRecipes"> | null> {
  if (!scope.tenantId) return null;
  const rows = (await ctx.db.query("productionRecipes").withIndex("by_output", (q) => q.eq("outputProductId", productId)).collect())
    .filter((r) => r.active && r.autoOnSale === true && r.tenantId === scope.tenantId);
  return rows.find((r) => r.branchId === scope.branchId) ?? rows.find((r) => r.branchId === undefined) ?? null;
}

/** Ingredients (with quantities) needed to produce `shortfall` of the recipe's product; throws if one is missing or short. */
async function plan(ctx: QueryCtx, scope: Scope, recipe: Doc<"productionRecipes">, outputName: string, shortfall: number, allowNegativeStock: boolean, taken: Map<string, number>) {
  const factor = shortfall / recipe.outputQty;
  const lines: Array<{ product: Doc<"products">; qty: number; unitCost: number }> = [];
  for (const line of recipe.ingredients) {
    const product = await ctx.db.get("products", line.productId);
    if (!product || !inScope(product, scope)) throw new ConvexError(`Kiungo cha ${outputName} hakipatikani kwenye idara hii. Angalia recipe.`);
    const qty = round(line.qty * factor);
    const already = taken.get(String(product._id)) ?? 0; // the same ingredient may serve two products of one sale
    if (!allowNegativeStock && product.currentQty + EPS < already + qty) {
      throw new ConvexError(`Viungo havitoshi kutengeneza ${outputName}: ${product.name} iliyopo ${round(product.currentQty - already)}, inahitajika ${qty}.`);
    }
    taken.set(String(product._id), already + qty);
    lines.push({ product, qty, unitCost: product.weightedAvgCost ?? product.lastPurchaseCost ?? 0 });
  }
  return lines;
}

/** Read-only check used when an order is written: could the shortfall be produced from today's ingredients? */
export async function assertAutoProducible(ctx: QueryCtx, scope: Scope, need: Map<string, number>, allowNegativeStock: boolean): Promise<Set<string>> {
  const handled = new Set<string>();
  const taken = new Map<string, number>();
  for (const [pid, qty] of need) {
    const product = await ctx.db.get("products", pid as Id<"products">);
    if (!product) continue;
    const recipe = await autoRecipeFor(ctx, scope, product._id);
    if (!recipe) continue;
    handled.add(pid);
    const shortfall = qty - Math.max(0, product.currentQty);
    if (shortfall > EPS) await plan(ctx, scope, recipe, product.name, shortfall, allowNegativeStock, taken);
  }
  return handled; // products whose stock is "produced on sale": the plain stock check does not apply to them
}

/** Produces whatever the sale lacks. Call it BEFORE the sale reads stock and cost. Returns the products it produced. */
export async function autoProduceForSale(
  ctx: MutationCtx, user: Doc<"users">, scope: Scope, need: Map<string, number>, allowNegativeStock: boolean, ref: { id: string; label: string },
): Promise<Array<{ productId: Id<"products">; qty: number; totalCost: number }>> {
  const produced: Array<{ productId: Id<"products">; qty: number; totalCost: number }> = [];
  for (const [pid, qty] of need) {
    const output = await ctx.db.get("products", pid as Id<"products">);
    if (!output) continue;
    const recipe = await autoRecipeFor(ctx, scope, output._id);
    if (!recipe) continue;
    const shortfall = round(qty - Math.max(0, output.currentQty));
    if (shortfall <= EPS) continue; // already in stock (e.g. cooked ahead in a batch): the sale simply takes it
    const used = await plan(ctx, scope, recipe, output.name, shortfall, allowNegativeStock, new Map());
    const at = new Date().toISOString();
    const totalCost = round(used.reduce((n, l) => n + l.qty * l.unitCost, 0));
    const unitCost = totalCost / shortfall;
    const batchId = await ctx.db.insert("productionBatches", {
      ...scope, outputProductId: output._id, plannedQty: shortfall, producedQty: shortfall, status: "completed",
      recipeSnapshot: used.map((l) => ({ productId: l.product._id, productName: l.product.name, qty: l.qty, unitCost: l.unitCost })),
      totalCost, unitCost, notes: `Imetengenezwa yenyewe wakati wa mauzo (${ref.label})`, createdAt: at, createdBy: user._id,
    });
    for (const l of used) {
      const fresh = (await ctx.db.get("products", l.product._id))!; // re-read: earlier lines of this sale may have used it
      const balance = round(fresh.currentQty - l.qty);
      await ctx.db.patch("products", fresh._id, { currentQty: balance });
      await ctx.db.insert("stockMovements", {
        ...scope, movementDate: at.slice(0, 10), productId: fresh._id, movementType: "production_consumption", referenceId: String(batchId), referenceType: "productionBatch",
        qtyIn: 0, qtyOut: l.qty, runningBalance: balance, unitCost: l.unitCost, notes: `Production ya ${output.name} (mauzo)`, createdBy: user._id,
      });
    }
    const keptQty = Math.max(0, output.currentQty);
    const blended = keptQty + shortfall > EPS ? (keptQty * (output.weightedAvgCost ?? output.lastPurchaseCost ?? 0) + shortfall * unitCost) / (keptQty + shortfall) : unitCost;
    const newQty = round(output.currentQty + shortfall);
    await ctx.db.patch("products", output._id, { currentQty: newQty, weightedAvgCost: blended });
    await ctx.db.insert("stockMovements", {
      ...scope, movementDate: at.slice(0, 10), productId: output._id, movementType: "production_output", referenceId: String(batchId), referenceType: "productionBatch",
      qtyIn: shortfall, qtyOut: 0, runningBalance: newQty, unitCost, notes: "Bidhaa iliyokamilika kutoka production (mauzo)", createdBy: user._id,
    });
    produced.push({ productId: output._id, qty: shortfall, totalCost });
  }
  return produced;
}
