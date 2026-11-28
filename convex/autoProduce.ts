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

/** A menu item (tick "stock item" switched off): it never carries a quantity of its own; selling it takes the recipe's ingredients out of stock. */
export const isMenuItem = (p: { isStockItem?: boolean } | null | undefined) => p?.isStockItem === false;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function inScope(record: { tenantId?: Id<"tenants">; branchId?: Id<"branches"> }, scope: Scope) {
  return record.tenantId === scope.tenantId && (record.branchId === undefined || record.branchId === scope.branchId);
}

/**
 * The active recipe a sale takes its ingredients from, in this department (a department recipe wins over a business-wide one).
 * An ordinary stock item is produced on sale only when its recipe has the "auto on sale" tick; a menu item (not a stock item)
 * always works from its recipe, tick or no tick.
 */
export async function autoRecipeFor(ctx: QueryCtx, scope: Scope, productId: Id<"products">, product?: Doc<"products"> | null): Promise<Doc<"productionRecipes"> | null> {
  if (!scope.tenantId) return null;
  const owner = product ?? await ctx.db.get("products", productId);
  const menu = isMenuItem(owner);
  const rows = (await ctx.db.query("productionRecipes").withIndex("by_output", (q) => q.eq("outputProductId", productId)).collect())
    .filter((r) => r.active && (menu || r.autoOnSale === true) && r.tenantId === scope.tenantId);
  return rows.find((r) => r.branchId === scope.branchId) ?? rows.find((r) => r.branchId === undefined) ?? null;
}

/** A menu item that points to no recipe cannot be sold: there is nowhere to take it from. */
const notRouted = (name: string) => new ConvexError(`${name} haijaelekezwa kwenye stock (hakuna recipe). Weka recipe yake kwanza kupitia Stock > Production.`);

/** Ingredients (with quantities) needed to produce `shortfall` of the recipe's product; throws if one is missing or short. */
async function plan(ctx: QueryCtx, scope: Scope, recipe: Doc<"productionRecipes">, outputName: string, shortfall: number, allowNegativeStock: boolean, taken: Map<string, number>) { // allowNegativeStock is always false for a menu item: its ingredients must really be in stock
  const factor = shortfall / recipe.outputQty;
  const lines: Array<{ product: Doc<"products">; qty: number; unitCost: number }> = [];
  for (const line of recipe.ingredients) {
    const product = await ctx.db.get("products", line.productId);
    if (!product || !inScope(product, scope)) throw new ConvexError(`Kiungo cha ${outputName} hakipatikani kwenye idara hii. Angalia recipe.`);
    const qty = round(line.qty * factor);
    const already = taken.get(String(product._id)) ?? 0; // the same ingredient may serve two products of one sale
    if (!allowNegativeStock && product.currentQty + EPS < already + qty) {
      throw new ConvexError(`Hakuna stock ya kutosha ya ${product.name} kwa ${outputName}. Iliyopo: ${round(product.currentQty - already)}, inahitajika: ${qty}`);
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
    const menu = isMenuItem(product);
    const recipe = await autoRecipeFor(ctx, scope, product._id, product);
    if (!recipe) { if (menu) throw notRouted(product.name); continue; }
    handled.add(pid);
    const shortfall = menu ? qty : qty - product.currentQty; // a menu item holds nothing: the whole quantity comes from the ingredients. A MINUS balance of an ordinary product is cleared too
    if (shortfall > EPS) await plan(ctx, scope, recipe, product.name, shortfall, menu ? false : allowNegativeStock, taken);
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
    const menu = isMenuItem(output);
    const recipe = await autoRecipeFor(ctx, scope, output._id, output);
    if (!recipe) { if (menu) throw notRouted(output.name); continue; }
    const shortfall = round(menu ? qty : qty - output.currentQty); // a menu item never keeps a quantity (old leftovers, plus or minus, are ignored): the whole sale is taken from the ingredients // current stock below zero: the minus is produced away as well, so the product ends at 0 and nothing stays negative
    if (shortfall <= EPS) continue; // already in stock (e.g. cooked ahead in a batch): the sale simply takes it
    const used = await plan(ctx, scope, recipe, output.name, shortfall, menu ? false : allowNegativeStock, new Map());
    const at = new Date().toISOString();
    const totalCost = round(used.reduce((n, l) => n + l.qty * l.unitCost, 0));
    const unitCost = totalCost / shortfall;
    const batchId = await ctx.db.insert("productionBatches", {
      ...scope, outputProductId: output._id, plannedQty: shortfall, producedQty: shortfall, status: "completed",
      recipeSnapshot: used.map((l) => ({ productId: l.product._id, productName: l.product.name, qty: l.qty, unitCost: l.unitCost })),
      totalCost, unitCost, notes: `Imetengenezwa yenyewe wakati wa mauzo (${ref.label})`, createdAt: at, createdBy: user._id, autoOnSale: true, settledQty: 0,
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
    const keptQty = menu ? 0 : Math.max(0, output.currentQty);
    const blended = keptQty + shortfall > EPS ? (keptQty * (output.weightedAvgCost ?? output.lastPurchaseCost ?? 0) + shortfall * unitCost) / (keptQty + shortfall) : unitCost;
    const newQty = round((menu ? 0 : output.currentQty) + shortfall); // the sale takes it straight out again, so a menu item ends at 0
    await ctx.db.patch("products", output._id, { currentQty: newQty, weightedAvgCost: blended });
    await ctx.db.insert("stockMovements", {
      ...scope, movementDate: at.slice(0, 10), productId: output._id, movementType: "production_output", referenceId: String(batchId), referenceType: "productionBatch",
      qtyIn: shortfall, qtyOut: 0, runningBalance: newQty, unitCost, notes: "Bidhaa iliyokamilika kutoka production (mauzo)", createdBy: user._id,
    });
    produced.push({ productId: output._id, qty: shortfall, totalCost });
  }
  return produced;
}
