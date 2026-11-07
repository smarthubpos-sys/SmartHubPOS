import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isManagerRole, logAudit, normalizeRole, requireActiveUser, requirePermission, resolveWriteScope } from "./access";
import { normaliseSplits, splitValidator } from "./paymentMethods";
import { bumpStats } from "./stats";
import { assertDate, assertPeriodOpen, getSystemAccount, postSystemJournal } from "./ledger";
import { surfaceError } from "./surfaceError";
import { allocateSellingPointInvoiceNo } from "./waiterOrders";
import { applyCustomerPayment } from "./sales";
import { waiterOwes } from "./waiterMath";

/**
 * Customer debt at the cashier:
 *  1. assignOrdersToCustomer - a waiter's credit sale is moved to a REGISTERED customer of the business/department. The waiter no longer owes it;
 *     the customer owes it (a normal posted invoice dated on the day of the sale), so every debt report names the customer, not the waiter.
 *  2. repayments book - the cashier picks a customer, sees his open invoices, ticks them (or types an amount) and receives the money.
 *     The money is a normal customer payment: it counts in the cash of the day it is received, and reports show it as that customer's repayment.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const eatDay = (iso: string) => new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 10); // East Africa Time business day
const isWaiter = (role?: string) => ["waiter", "waitress"].includes(normalizeRole(role));
const collectable = (o: Doc<"waiterOrders">) => !o.cancelledAt && (o.status === "pending" || o.status === "accepted" || o.status === "printed");

/** A cashier or a manager of this business (the same people who may receive customer payments). Never a waiter, never a bare Super Admin. */
async function cashierScope(ctx: MutationCtx | QueryCtx) {
  const user = await requireActiveUser(ctx, "sales");
  if (isWaiter(user.role)) throw new ConvexError("Cashier pekee ndiye anaelekeza deni kwa mteja au kupokea marejesho.");
  if (normalizeRole(user.role) !== "cashier" && !(await isManagerRole(ctx, user))) throw new ConvexError("Forbidden: cashier permission required.");
  const scope = await resolveWriteScope(ctx, user, { tenantWide: true });
  if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
  return { user, tenantId: scope.tenantId, branchId: scope.branchId };
}

/** A customer saved in this business; when it belongs to a department it must be the department of the bill. */
function clientUsable(client: Doc<"clients"> | null, tenantId: Id<"tenants">, branchId?: Id<"branches">) {
  return !!client && client.tenantId === tenantId && client.isActive && (!client.branchId || !branchId || client.branchId === branchId);
}

/** Cost of goods of one waiter bill = what its stock movements took off the shelf. */
async function orderCost(ctx: MutationCtx, orderId: Id<"waiterOrders">): Promise<number> {
  const moves = await ctx.db.query("stockMovements").withIndex("by_reference", (q) => q.eq("referenceType", "waiterOrder").eq("referenceId", String(orderId))).collect();
  return r2(moves.reduce((n, m) => n + (m.qtyOut - m.qtyIn) * (m.unitCost ?? 0), 0));
}

/** Customers the cashier can choose: saved in this business, and in the cashier's department when the customer belongs to one. With what each owes now. */
export const customersForCashier = query({
  args: {},
  handler: async (ctx) => {
    const { tenantId, branchId } = await cashierScope(ctx);
    const clients = (await ctx.db.query("clients").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).take(2000))
      .filter((c) => c.isActive && (!c.branchId || !branchId || c.branchId === branchId));
    const owing = new Map<string, number>();
    for (const inv of await ctx.db.query("invoices").withIndex("by_tenant_outstanding", (q) => q.eq("tenantId", tenantId).gt("outstanding", 0)).take(5000)) {
      if (inv.status !== "posted" || (branchId && inv.branchId !== branchId)) continue;
      owing.set(String(inv.clientId), r2((owing.get(String(inv.clientId)) ?? 0) + inv.outstanding));
    }
    return clients
      .map((c) => ({ _id: c._id, name: c.name, code: c.code, phone: c.phone ?? "", owes: owing.get(String(c._id)) ?? 0 }))
      .sort((a, b) => b.owes - a.owes || a.name.localeCompare(b.name));
  },
});

/** Open (unpaid) invoices of one customer, oldest first: what the repayments book lets the cashier tick. */
export const openInvoicesOfCustomer = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, a) => {
    const { tenantId, branchId } = await cashierScope(ctx);
    const client = await ctx.db.get("clients", a.clientId);
    if (!clientUsable(client, tenantId, branchId)) throw new ConvexError("Mteja hayupo kwenye biashara au tawi lako.");
    const rows = (await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", a.clientId)).take(2000))
      .filter((i) => i.tenantId === tenantId && i.status === "posted" && i.outstanding > 0.005 && (!branchId || i.branchId === branchId))
      .sort((x, y) => x.invoiceDate.localeCompare(y.invoiceDate) || x.invoiceNo.localeCompare(y.invoiceNo));
    return {
      client: { _id: client!._id, name: client!.name, phone: client!.phone ?? "" },
      owes: r2(rows.reduce((n, i) => n + i.outstanding, 0)),
      invoices: rows.map((i) => ({ _id: i._id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, total: i.total, amountPaid: i.amountPaid, outstanding: i.outstanding, notes: i.notes ?? "" })),
    };
  },
});

/**
 * Move what the waiter still owes for some bills to one registered customer. Per bill: a posted invoice for the customer, dated on the
 * day of the sale, with the sale booked in the ledger (receivable / revenue / cost of goods) like a credit sale. The waiter's balance drops.
 * The invoice has no product lines (stock already left the shelf with the waiter's bill and the bill's lines stay in the product reports).
 */
export const assignOrdersToCustomer = mutation({
  args: { orderIds: v.array(v.id("waiterOrders")), clientId: v.id("clients") },
  handler: async (ctx, a) => {
    try {
      const { user, tenantId, branchId } = await cashierScope(ctx);
      await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
      if (!a.orderIds.length) throw new ConvexError("Chagua bili za kuelekeza kwa mteja.");
      if (a.orderIds.length > 50) throw new ConvexError("Bili nyingi mno kwa mara moja (kikomo 50).");
      if (new Set(a.orderIds.map(String)).size !== a.orderIds.length) throw new ConvexError("Bili moja imechaguliwa mara mbili.");
      const client = await ctx.db.get("clients", a.clientId);
      const orders: Doc<"waiterOrders">[] = [];
      for (const id of a.orderIds) {
        const o = await ctx.db.get("waiterOrders", id);
        if (!o || o.tenantId !== tenantId || (branchId && o.branchId !== branchId)) throw new ConvexError("Bili haipo kwenye biashara au tawi lako.");
        if (!collectable(o) || o.settledAt || waiterOwes(o) <= 0.005) throw new ConvexError("Bili hii haina deni la mhudumu la kuelekezwa.");
        if (!clientUsable(client, tenantId, o.branchId)) throw new ConvexError("Mteja huyu hayupo kwenye biashara au idara ya bili hii.");
        orders.push(o);
      }
      const now = new Date().toISOString();
      const results: Array<{ orderId: Id<"waiterOrders">; invoiceId: Id<"invoices">; invoiceNo: string; amount: number }> = [];
      for (const o of orders) {
        const amount = waiterOwes(o);
        const day = eatDay(o.createdAt);
        const scope = { tenantId, branchId: o.branchId };
        await assertPeriodOpen(ctx, scope, day);
        const invoiceNo = await allocateSellingPointInvoiceNo(ctx, user, tenantId);
        const note = `Deni la bili ya ${o.waiterName}${o.invoiceNo ? ` (${o.invoiceNo})` : ""}${o.tableNumber ? ` meza ${o.tableNumber}` : ""} - limeelekezwa kwa mteja na cashier`;
        const invoiceId = await ctx.db.insert("invoices", {
          ...scope, invoiceNo, invoiceDate: day, clientId: a.clientId, subtotal: amount, discount: 0, taxAmount: 0, total: amount,
          amountPaid: 0, outstanding: amount, paymentStatus: "unpaid", status: "posted", salespersonId: o.waiterId, salesSource: "Selling Point",
          notes: note, createdBy: user._id, postedAt: now,
        });
        // Ledger: this part of the sale is now a customer receivable (the rest was booked when the cashier received money from the waiter).
        const receivable = await getSystemAccount(ctx, scope, "1100", "Accounts receivable", "asset");
        const revenue = await getSystemAccount(ctx, scope, "4000", "Sales revenue", "revenue");
        const cogs = await getSystemAccount(ctx, scope, "5000", "Cost of goods sold", "expense");
        const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
        const cost = o.total > 0 ? r2((await orderCost(ctx, o._id)) * (amount / o.total)) : 0;
        await postSystemJournal(ctx, {
          scope, userId: user._id, date: day, reference: `SALE-${invoiceNo}`, description: `Waiter bill moved to customer ${client!.name} (${invoiceNo})`, sourceType: "sale", sourceId: String(invoiceId),
          lines: [
            { accountId: receivable, debit: amount, credit: 0, description: "Customer receivable" },
            { accountId: revenue, debit: 0, credit: amount, description: "Sales revenue" },
            { accountId: cogs, debit: cost, credit: 0, description: "Cost of goods sold" },
            { accountId: inventory, debit: 0, credit: cost, description: "Inventory relieved" },
          ],
        });
        await bumpStats(ctx, scope, { receivable: amount, date: day, sales: amount, invoices: 1 });
        // The waiter owes nothing for this bill any more.
        await ctx.db.patch("waiterOrders", o._id, { assignedAmount: r2((o.assignedAmount ?? 0) + amount), assignedClientId: a.clientId, assignedInvoiceId: invoiceId, paidAmount: o.paidAmount ?? 0, settledAt: now, updatedAt: now });
        results.push({ orderId: o._id, invoiceId, invoiceNo, amount });
      }
      const total = r2(results.reduce((n, r) => n + r.amount, 0));
      await logAudit(ctx, user, { action: "assign_waiter_debt_to_customer", module: "sales", referenceId: String(a.clientId), referenceType: "client", details: `${client!.name}; bili ${results.length}; jumla ${total}; ${results.map((r) => `${r.invoiceNo}:${r.amount}`).join(", ")}` });
      return { total, clientName: client!.name, results };
    } catch (e) { throw surfaceError(e); }
  },
});

/**
 * Repayments book: the customer pays part or all of his open invoices. `allocations` say how much goes to which invoice; the payment
 * methods (e.g. 10,000 phone + 5,000 cash) are shared out over the invoices in order. All or nothing: one refused invoice records nothing.
 * The payment date is today unless the cashier chooses another day (never in the future).
 */
export const receiveRepayment = mutation({
  args: {
    clientId: v.id("clients"),
    splits: v.array(splitValidator),
    allocations: v.array(v.object({ invoiceId: v.id("invoices"), amount: v.number() })),
    paymentDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    try {
      const { user, tenantId, branchId } = await cashierScope(ctx);
      const client = await ctx.db.get("clients", a.clientId);
      if (!clientUsable(client, tenantId, branchId)) throw new ConvexError("Mteja hayupo kwenye biashara au tawi lako.");
      if (!a.allocations.length) throw new ConvexError("Chagua angalau deni moja la kulipa.");
      if (a.allocations.length > 50) throw new ConvexError("Madeni mengi mno kwa mara moja (kikomo 50).");
      if (new Set(a.allocations.map((x) => String(x.invoiceId))).size !== a.allocations.length) throw new ConvexError("Deni moja limechaguliwa mara mbili.");
      const today = eatDay(new Date().toISOString());
      const date = a.paymentDate === undefined ? today : assertDate(a.paymentDate, "Tarehe ya malipo");
      if (date > today) throw new ConvexError("Tarehe ya malipo haiwezi kuwa ya baadaye.");
      const { splits, total } = await normaliseSplits(ctx, user, a.splits);
      const allocated = r2(a.allocations.reduce((n, x) => n + x.amount, 0));
      if (a.allocations.some((x) => !Number.isFinite(x.amount) || x.amount <= 0)) throw new ConvexError("Kila deni lazima lilipwe kiasi kikubwa kuliko sifuri.");
      if (Math.abs(allocated - total) > 0.01) throw new ConvexError(`Jumla ya malipo (${total}) haikulingana na jumla ya madeni yaliyochaguliwa (${allocated}).`);
      // Shared out: take each invoice's amount from the payment methods in order.
      const pool = splits.map((s) => ({ ...s, left: s.amount }));
      const label = `Repayment ya ${client!.name}${a.notes?.trim() ? ` - ${a.notes.trim()}` : ""}`;
      const results: Array<{ invoiceNo: string; amount: number; outstanding: number; receiptNo: string }> = [];
      for (const al of a.allocations) {
        const inv = await ctx.db.get("invoices", al.invoiceId);
        if (!inv || inv.tenantId !== tenantId || inv.clientId !== a.clientId || (branchId && inv.branchId !== branchId)) throw new ConvexError("Deni hili si la mteja aliyechaguliwa.");
        let need = r2(al.amount);
        const part: Array<{ method: string; methodId?: Id<"paymentMethods">; amount: number; reference?: string }> = [];
        for (const p of pool) {
          if (need <= 0.001) break;
          const take = r2(Math.min(need, p.left));
          if (take <= 0) continue;
          part.push({ method: p.method, methodId: p.methodId, amount: take, reference: p.reference });
          p.left = r2(p.left - take); p.reference = undefined; // a reference is attached once only (a repeated one is refused as a duplicate)
          need = r2(need - take);
        }
        const r = await applyCustomerPayment(ctx, { invoiceId: al.invoiceId, splits: part, paymentDate: date, notes: label }, { tenantWide: true });
        results.push({ invoiceNo: inv.invoiceNo, amount: r.amount, outstanding: r.outstanding, receiptNo: r.receiptNo });
      }
      await logAudit(ctx, user, { action: "customer_repayment", module: "sales", referenceId: String(a.clientId), referenceType: "client", details: `${client!.name}; jumla ${total}; tarehe ${date}; ${results.map((r) => `${r.invoiceNo}:${r.amount}`).join(", ")}` });
      return { total, clientName: client!.name, date, results };
    } catch (e) { throw surfaceError(e); }
  },
});
