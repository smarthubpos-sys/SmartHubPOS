import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Which products appear on the sales menu (Selling Point, invoice entry).
 * A ticked product (showInSales = true) always shows, an unticked one (false) never does.
 * Products nobody has decided about yet: an item that only ever feeds production (an ingredient of an active recipe and not the
 * finished product of any) stays off the menu; everything else shows exactly as before.
 */
export async function ingredientOnlyIds(ctx: QueryCtx, tenantId: Id<"tenants"> | undefined): Promise<Set<string>> {
  if (!tenantId) return new Set();
  const recipes = (await ctx.db.query("productionRecipes").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect()).filter((r) => r.active);
  const outputs = new Set(recipes.map((r) => String(r.outputProductId)));
  const ingredients = new Set(recipes.flatMap((r) => r.ingredients.map((i) => String(i.productId))));
  return new Set([...ingredients].filter((id) => !outputs.has(id)));
}

export const onSalesMenu = (p: { _id: unknown; showInSales?: boolean }, ingredientOnly: Set<string>) => p.showInSales ?? !ingredientOnly.has(String(p._id));
