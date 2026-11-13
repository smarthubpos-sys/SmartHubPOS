import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { filterScoped, requirePermission, scopedRows } from "./access";
import { assertDate } from "./ledger";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round8 = (n: number) => Math.round((n + Number.EPSILON) * 1e8) / 1e8;
const costOf = (p: Pick<Doc<"products">, "weightedAvgCost" | "lastPurchaseCost">) => p.weightedAvgCost ?? p.lastPurchaseCost ?? 0;

type Bucket = "purchases" | "returns" | "adjust" | "production" | "transfer" | "sold" | "other";
/** Which column of the daily stock report a stock movement belongs to. */
const bucketOf = (type: string): Bucket => {
  if (["purchase", "purchase_edit", "purchase_void", "grn", "grn_void", "receive", "opening", "purchase_return", "purchase_return_void"].includes(type)) return "purchases";
  if (["sale_return", "waiter_order_cancel", "waiter_order_edit_return"].includes(type)) return "returns";
  if (["adjustment", "adjust_in"].includes(type)) return "adjust";
  if (type.startsWith("production_")) return "production";
  if (type.startsWith("transfer_")) return "transfer";
  if (["sale", "waiter_order"].includes(type)) return "sold";
  return "other";
};

/**
 * CLOSING STOCK OF ANY DAY, rebuilt from the dated stock movements (not from today's quantity):
 *   opening (what the day started with) + purchases + returns + adjustments + production + transfers - sales = closing.
 * `sold` = sales and Selling Point bills, net of cancelled / returned bills shown separately as `returns`.
 * Value = closing quantity x the item's current average cost (for FIFO value of a past day use the Stock Value Report).
 */
export const closingStock = query({
  args: { date: v.string(), groupId: v.optional(v.id("productGroups")) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "stock.view", "stock");
    const date = assertDate(a.date, "Tarehe ya ripoti");
    const [productsRaw, groupsRaw] = await Promise.all([scopedRows(ctx, user, "products"), scopedRows(ctx, user, "productGroups")]);
    const products = filterScoped(user, productsRaw).filter((p) => p.isActive && (!a.groupId || p.groupId === a.groupId));
    const groupName = new Map(filterScoped(user, groupsRaw).map((g) => [String(g._id), g.name]));
    const tenantId = user.tenantId;
    const movesRaw = tenantId
      ? await ctx.db.query("stockMovements").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).lte("movementDate", date)).collect()
      : (await scopedRows(ctx, user, "stockMovements")).filter((m) => m.movementDate <= date);
    const moves = filterScoped(user, movesRaw);

    type Acc = { opening: number } & Record<Bucket, number>;
    const acc = new Map<string, Acc>();
    for (const p of products) acc.set(String(p._id), { opening: 0, purchases: 0, returns: 0, adjust: 0, production: 0, transfer: 0, sold: 0, other: 0 });
    for (const m of moves) {
      const g = acc.get(String(m.productId)); if (!g) continue;
      const net = m.qtyIn - m.qtyOut;
      if (m.movementDate < date) { g.opening += net; continue; }
      const b = bucketOf(m.movementType);
      g[b] += b === "sold" ? -net : net; // sold is shown as a positive "went out" figure
    }

    const rows = products.map((p) => {
      const g = acc.get(String(p._id))!;
      const closing = round8(g.opening + g.purchases + g.returns + g.adjust + g.production + g.transfer + g.other - g.sold);
      const cost = costOf(p);
      return {
        productId: p._id, code: p.itemCode, name: p.name, groupName: p.groupId ? groupName.get(String(p.groupId)) ?? "—" : "—",
        opening: round8(g.opening), purchases: round8(g.purchases), returns: round8(g.returns), adjust: round8(g.adjust),
        production: round8(g.production), transfer: round8(g.transfer), other: round8(g.other), sold: round8(g.sold),
        closing, cost, value: round2(closing * cost),
      };
    }).filter((r) => [r.opening, r.purchases, r.returns, r.adjust, r.production, r.transfer, r.other, r.sold, r.closing].some((x) => Math.abs(x) > 1e-8))
      .sort((x, y) => x.name.localeCompare(y.name));

    const sum = (f: (r: (typeof rows)[number]) => number) => round2(rows.reduce((n, r) => n + f(r), 0));
    return {
      date, rows,
      totals: { items: rows.length, closingQty: sum((r) => r.closing), value: sum((r) => r.value), openingValue: sum((r) => r.opening * r.cost), soldQty: sum((r) => r.sold) },
    };
  },
});
