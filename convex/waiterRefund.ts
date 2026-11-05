import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { logAudit } from "./access";
import { assertPeriodOpen, getSystemAccount, methodAccount, postSystemJournal } from "./ledger";
import { bumpStats } from "./stats";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const eatDay = (iso: string) => new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 10); // East Africa Time business day
const same = (a: unknown, b: unknown) => String(a) === String(b);

/** True when the cashier has received money (all or part) for this order. */
export const orderHasPayment = (o: Doc<"waiterOrders">) => (o.paidAmount ?? 0) > 0.005 || !!o.settledAt || !!o.collectionId;

/** Cost of the goods of one order = what its stock movements took out of the shelf (minus what came back), at the cost recorded then. */
async function orderCost(ctx: MutationCtx, orderId: Doc<"waiterOrders">["_id"]): Promise<number> {
  const moves = await ctx.db.query("stockMovements").withIndex("by_reference", (q) => q.eq("referenceType", "waiterOrder").eq("referenceId", String(orderId))).collect();
  return r2(moves.reduce((n, m) => n + (m.qtyOut - m.qtyIn) * (m.unitCost ?? 0), 0));
}

/**
 * Gives back the money a cashier received for ONE Selling Point order (bill cancelled or edited after it was paid / received by mistake).
 * Call it BEFORE the order's stock is put back: the cost of goods is read from the stock movements that are still out.
 *
 *   - Ledger (today): Dr Sales revenue, Cr the money account of each method that was used (cash / bank / mobile ...),
 *                     Dr Inventory, Cr Cost of goods sold (for the paid share)
 *   - Receipt (waiterCollections): the order leaves it; total, methods, settled count and the debt left at that receipt follow, so the
 *     Sales report, Dashboard and Stock earnings agree with the ledger.
 *   - Dashboard counters: reduced on the day of the receipt.
 *   - The order itself goes back to "nothing paid", so a cashier can receive it again after an edit.
 * A closed accounting period is never changed: the whole thing is refused and nothing is written.
 */
export async function reverseOrderPayments(ctx: MutationCtx, user: Doc<"users">, order: Doc<"waiterOrders">, why: string): Promise<{ refunded: number; receipts: number }> {
  if (!orderHasPayment(order)) return { refunded: 0, receipts: 0 };
  const tenantId = order.tenantId;
  if (!tenantId) throw new ConvexError("Bili hii haina biashara; malipo hayawezi kurudishwa.");
  const rows = await ctx.db.query("waiterCollections").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).gte("date", eatDay(order.createdAt))).collect();
  const mine = rows.filter((c) => c.orderIds.some((id) => same(id, order._id))).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  if (!mine.length) throw new ConvexError("Malipo ya bili hii hayapatikani kwenye makusanyo ya cashier; wasiliana na msimamizi.");

  const orderScope = { tenantId, branchId: order.branchId };
  const today = eatDay(new Date().toISOString());
  const totalCost = await orderCost(ctx, order._id);
  const revenue = await getSystemAccount(ctx, orderScope, "4000", "Sales revenue", "revenue");
  const cogs = await getSystemAccount(ctx, orderScope, "5000", "Cost of goods sold", "expense");
  const inventory = await getSystemAccount(ctx, orderScope, "1200", "Inventory", "asset");

  let refunded = 0;
  let paidSoFar = 0;
  for (const c of mine) {
    await assertPeriodOpen(ctx, { tenantId, branchId: c.branchId }, c.date); // a closed period is never altered
    const own = c.allocations?.find((x) => same(x.orderId, order._id))?.amount;
    const a = r2(Math.min(own ?? order.total, c.total));
    if (a <= 0.005 || c.total <= 0.005) continue;
    paidSoFar = r2(paidSoFar + a);

    // The money goes back through the same methods it came in by, in the same proportion.
    const ratio = Math.min(1, a / c.total);
    const back = c.splits.map((s) => r2(s.amount * ratio));
    const diff = r2(a - back.reduce((n, x) => n + x, 0));
    if (Math.abs(diff) > 0.001) { let big = 0; back.forEach((x, i) => { if (x > back[big]) big = i; }); back[big] = r2(back[big] + diff); }

    const cost = order.total > 0 ? r2(totalCost * Math.min(1, a / order.total)) : 0; // same share the receipt booked
    const lines: Array<{ accountId: typeof revenue; debit: number; credit: number; description: string }> = [
      { accountId: revenue, debit: a, credit: 0, description: "Selling Point sale reversed" },
    ];
    for (let i = 0; i < c.splits.length; i++) {
      if (back[i] <= 0) continue;
      lines.push({ accountId: await methodAccount(ctx, orderScope, { methodId: c.splits[i].methodId, method: c.splits[i].method }), debit: 0, credit: back[i], description: `Money returned - ${c.splits[i].method}` });
    }
    lines.push({ accountId: inventory, debit: cost, credit: 0, description: "Inventory restored" });
    lines.push({ accountId: cogs, debit: 0, credit: cost, description: "Cost of goods sold reversed" });
    await postSystemJournal(ctx, {
      scope: orderScope, userId: user._id, date: today, reference: `WVOID-${c._id}-${order._id}`,
      description: `Selling Point payment returned: ${order.invoiceNo ?? order._id} (${why})`, sourceType: "waiter_sale_void", sourceId: `${c._id}:${order._id}`, lines,
    });

    // Take the order out of that receipt.
    const rest = c.orderIds.filter((id) => !same(id, order._id));
    let allocations = c.allocations?.filter((x) => !same(x.orderId, order._id));
    if (!allocations && rest.length) { // receipts without allocations paid every order in full: write that down before one of them leaves
      allocations = [];
      for (const id of rest) { const o = await ctx.db.get("waiterOrders", id); if (o) allocations.push({ orderId: id, amount: o.total }); }
    }
    const settledHere = !!order.settledAt && same(order.collectionId, c._id);
    const settledCount = c.settledCount === undefined ? rest.length : Math.max(0, c.settledCount - (settledHere ? 1 : 0));
    const stillOwed = settledHere ? 0 : Math.max(0, r2(order.total - paidSoFar)); // debt this order had left at that receipt: gone with the order
    await ctx.db.patch("waiterCollections", c._id, {
      orderIds: rest, ...(allocations ? { allocations } : {}), total: r2(c.total - a),
      splits: c.splits.map((s, i) => ({ ...s, amount: r2(s.amount - back[i]) })).filter((s) => s.amount > 0.005),
      settledCount, ...(c.shortfall !== undefined ? { shortfall: Math.max(0, r2(c.shortfall - stillOwed)) } : {}),
    });
    await bumpStats(ctx, { tenantId, branchId: c.branchId }, { date: c.date, sales: -a, collected: -a, invoices: settledHere ? -1 : 0 });
    refunded = r2(refunded + a);
  }

  const now = new Date().toISOString();
  await ctx.db.patch("waiterOrders", order._id, { paidAmount: 0, settledAt: undefined, collectionId: undefined, updatedAt: now });
  await logAudit(ctx, user, {
    action: "refund_selling_point_payment", module: "sales", referenceId: String(order._id), referenceType: "waiterOrder",
    details: `${order.invoiceNo ?? order._id}; imerudishwa ${refunded}; ${why}`,
  });
  return { refunded, receipts: mine.length };
}
