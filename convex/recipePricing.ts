import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * A recipe product (e.g. "Mbuzi Makange") can take its selling price from its ingredients:
 *   price per unit = sum(ingredient qty x ingredient selling price) / recipe yield.
 * Recipes opt in with `priceFromIngredients`; older recipes are never touched.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function recipeUnitPrices(ctx: QueryCtx, recipe: Pick<Doc<"productionRecipes">, "ingredients" | "outputQty">) {
  let price = 0, cost = 0;
  for (const line of recipe.ingredients) {
    const p = await ctx.db.get("products", line.productId);
    if (!p) continue;
    price += line.qty * (p.sellingPrice ?? 0);
    cost += line.qty * (p.weightedAvgCost ?? p.lastPurchaseCost ?? 0);
  }
  const yieldQty = recipe.outputQty > 0 ? recipe.outputQty : 1;
  return { price: round2(price / yieldQty), cost: round2(cost / yieldQty) };
}

/** Sets the recipe product's selling price from its ingredients. Returns true when the price changed. A computed 0 never overwrites a price. */
export async function applyRecipePrice(ctx: MutationCtx, recipe: Doc<"productionRecipes">): Promise<boolean> {
  if (!recipe.active || recipe.priceFromIngredients !== true) return false;
  const output = await ctx.db.get("products", recipe.outputProductId);
  if (!output) return false;
  const { price } = await recipeUnitPrices(ctx, recipe);
  if (!(price > 0) || output.sellingPrice === price) return false;
  await ctx.db.patch("products", output._id, { sellingPrice: price });
  return true;
}

/** Call after ingredient selling prices change: every price-following recipe that uses one of them is recomputed (nested recipes follow too). */
export async function syncRecipePrices(ctx: MutationCtx, tenantId: Id<"tenants"> | undefined, changed: Id<"products">[]) {
  if (!tenantId || changed.length === 0) return;
  const recipes = (await ctx.db.query("productionRecipes").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect())
    .filter((r) => r.active && r.priceFromIngredients === true);
  if (recipes.length === 0) return;
  const queue = new Set(changed.map(String));
  const done = new Set<string>();
  for (let round = 0; round < 5 && queue.size > 0; round++) {
    const current = [...queue]; queue.clear();
    for (const r of recipes) {
      if (done.has(String(r._id)) || !r.ingredients.some((i) => current.includes(String(i.productId)))) continue;
      done.add(String(r._id));
      if (await applyRecipePrice(ctx, r)) queue.add(String(r.outputProductId));
    }
  }
}
