import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isManagerRole, logAudit, normalizeRole, requirePermission, requireSellingPointOrSales, resolveWriteScope, roleHasPermission } from "./access";
import { normaliseSplits, splitValidator } from "./paymentMethods";
import { bumpStats } from "./stats";
import { assertDate, assertPeriodOpen, getSystemAccount, methodAccount, postSystemJournal } from "./ledger";
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
  const user = await requireSellingPointOrSales(ctx, "waiterOrders.manage"); // Selling Point alone is enough; Sales is not needed
  if (isWaiter(user.role)) throw new ConvexError("Cashier pekee ndiye anaelekeza deni kwa mteja au kupokea marejesho.");
  if (normalizeRole(user.role) !== "cashier" && !(await isManagerRole(ctx, user)) && !(await roleHasPermission(ctx, user, "waiterOrders.manage"))) throw new ConvexError("Forbidden: cashier permission required.");
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
 * SPLIT ONE DEBT AMONG MANY CUSTOMERS. The cashier shares what the waiter still owes for the chosen bills between 2, 3, 4 ... registered customers.
 * Each part may be paid on the spot (cash, Tigo Pesa, any methods); what a customer does not pay now stays HIS debt (a normal posted invoice on the day of the sale).
 * If the parts are less than the debt, the rest stays with the waiter. All or nothing: one refused part records nothing.
 * Bills are used oldest first, so a part can run over more than one bill (one invoice per customer per bill).
 */
export const splitDebtToCustomers = mutation({
  args: {
    orderIds: v.array(v.id("waiterOrders")),
    parts: v.array(v.object({ clientId: v.id("clients"), amount: v.number(), paid: v.optional(v.array(splitValidator)) })),
    paymentDate: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    try {
      const { user, tenantId, branchId } = await cashierScope(ctx);
      await requirePermission(ctx, "waiterOrders.manage", "waiterOrders");
      if (!a.orderIds.length) throw new ConvexError("Chagua bili za kugawanya.");
      if (a.orderIds.length > 50) throw new ConvexError("Bili nyingi mno kwa mara moja (kikomo 50).");
      if (new Set(a.orderIds.map(String)).size !== a.orderIds.length) throw new ConvexError("Bili moja imechaguliwa mara mbili.");
      if (!a.parts.length) throw new ConvexError("Weka angalau mteja mmoja.");
      if (a.parts.length > 20) throw new ConvexError("Wateja wengi mno kwa mara moja (kikomo 20).");
      if (new Set(a.parts.map((p) => String(p.clientId))).size !== a.parts.length) throw new ConvexError("Mteja mmoja amewekwa mara mbili.");
      if (a.parts.some((p) => !Number.isFinite(p.amount) || p.amount <= 0)) throw new ConvexError("Kila mteja lazima apewe kiasi kikubwa kuliko sifuri.");
      const today = eatDay(new Date().toISOString());
      const date = a.paymentDate === undefined ? today : assertDate(a.paymentDate, "Tarehe ya malipo");
      if (date > today) throw new ConvexError("Tarehe ya malipo haiwezi kuwa ya baadaye.");

      const orders: Doc<"waiterOrders">[] = [];
      for (const id of a.orderIds) {
        const o = await ctx.db.get("waiterOrders", id);
        if (!o || o.tenantId !== tenantId || (branchId && o.branchId !== branchId)) throw new ConvexError("Bili haipo kwenye biashara au tawi lako.");
        if (!collectable(o) || o.settledAt || waiterOwes(o) <= 0.005) throw new ConvexError("Bili hii haina deni la mhudumu la kugawanya.");
        orders.push(o);
      }
      orders.sort((x, y) => x.createdAt.localeCompare(y.createdAt) || String(x._id).localeCompare(String(y._id)));
      const due = r2(orders.reduce((n, o) => n + waiterOwes(o), 0));
      const partsTotal = r2(a.parts.reduce((n, p) => n + p.amount, 0));
      if (partsTotal > due + 0.01) throw new ConvexError(`Jumla ya sehemu za wateja (${partsTotal}) imezidi deni la bili (${due}).`);

      const clients: Doc<"clients">[] = [];
      const payNow: Array<{ splits: Array<{ method: string; methodId?: Id<"paymentMethods">; amount: number; reference?: string }>; total: number } | null> = [];
      for (const p of a.parts) {
        const client = await ctx.db.get("clients", p.clientId);
        for (const o of orders) if (!clientUsable(client, tenantId, o.branchId)) throw new ConvexError(`Mteja ${client?.name ?? ""} hayupo kwenye biashara au idara ya bili hizi.`);
        clients.push(client!);
        if (p.paid?.length) {
          const n = await normaliseSplits(ctx, user, p.paid);
          if (n.total > p.amount + 0.01) throw new ConvexError(`Malipo ya ${client!.name} (${n.total}) yamezidi sehemu yake (${p.amount}).`);
          payNow.push(n);
        } else payNow.push(null);
      }

      // Share the debt out: each customer takes his amount from the oldest bills first.
      const left = new Map(orders.map((o) => [String(o._id), r2(waiterOwes(o))]));
      const slices: Array<{ part: number; order: Doc<"waiterOrders">; amount: number }> = [];
      a.parts.forEach((p, pi) => {
        let need = r2(p.amount);
        for (const o of orders) {
          if (need <= 0.001) break;
          const have = left.get(String(o._id)) ?? 0;
          const take = r2(Math.min(need, have));
          if (take <= 0.001) continue;
          slices.push({ part: pi, order: o, amount: take });
          left.set(String(o._id), r2(have - take));
          need = r2(need - take);
        }
      });

      const now = new Date().toISOString();
      const receivable = new Map<string, Id<"accounts">>();
      const costOf = new Map<string, number>();
      const invoicesOfPart: Array<Array<{ invoiceId: Id<"invoices">; invoiceNo: string; amount: number }>> = a.parts.map(() => []);
      const perOrder = new Map<string, { sum: number; clientId: Id<"clients">; invoiceId: Id<"invoices"> }>();
      for (const sl of slices) {
        const o = sl.order, client = clients[sl.part];
        const day = eatDay(o.createdAt);
        const scope = { tenantId, branchId: o.branchId };
        await assertPeriodOpen(ctx, scope, day);
        const invoiceNo = await allocateSellingPointInvoiceNo(ctx, user, tenantId);
        const note = `Deni la bili ya ${o.waiterName}${o.invoiceNo ? ` (${o.invoiceNo})` : ""}${o.tableNumber ? ` meza ${o.tableNumber}` : ""} - limegawanywa kwa wateja na cashier`;
        const invoiceId = await ctx.db.insert("invoices", {
          ...scope, invoiceNo, invoiceDate: day, clientId: client._id, subtotal: sl.amount, discount: 0, taxAmount: 0, total: sl.amount,
          amountPaid: 0, outstanding: sl.amount, paymentStatus: "unpaid", status: "posted", salespersonId: o.waiterId, salesSource: "Selling Point",
          notes: note, createdBy: user._id, postedAt: now,
        });
        const rKey = `${o.branchId ?? "none"}`;
        if (!receivable.has(rKey)) receivable.set(rKey, await getSystemAccount(ctx, scope, "1100", "Accounts receivable", "asset"));
        const revenue = await getSystemAccount(ctx, scope, "4000", "Sales revenue", "revenue");
        const cogs = await getSystemAccount(ctx, scope, "5000", "Cost of goods sold", "expense");
        const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
        if (!costOf.has(String(o._id))) costOf.set(String(o._id), await orderCost(ctx, o._id));
        const cost = o.total > 0 ? r2((costOf.get(String(o._id)) ?? 0) * (sl.amount / o.total)) : 0;
        await postSystemJournal(ctx, {
          scope, userId: user._id, date: day, reference: `SALE-${invoiceNo}`, description: `Waiter bill moved to customer ${client.name} (${invoiceNo})`, sourceType: "sale", sourceId: String(invoiceId),
          lines: [
            { accountId: receivable.get(rKey)!, debit: sl.amount, credit: 0, description: "Customer receivable" },
            { accountId: revenue, debit: 0, credit: sl.amount, description: "Sales revenue" },
            { accountId: cogs, debit: cost, credit: 0, description: "Cost of goods sold" },
            { accountId: inventory, debit: 0, credit: cost, description: "Inventory relieved" },
          ],
        });
        await bumpStats(ctx, scope, { receivable: sl.amount, date: day, sales: sl.amount, invoices: 1 });
        invoicesOfPart[sl.part].push({ invoiceId, invoiceNo, amount: sl.amount });
        const cur = perOrder.get(String(o._id));
        perOrder.set(String(o._id), { sum: r2((cur?.sum ?? 0) + sl.amount), clientId: client._id, invoiceId });
      }
      // What the waiter still owes for each bill after this split (nothing, when the parts cover it all).
      for (const o of orders) {
        const used = perOrder.get(String(o._id));
        if (!used) continue;
        const remaining = r2(waiterOwes(o) - used.sum);
        await ctx.db.patch("waiterOrders", o._id, {
          assignedAmount: r2((o.assignedAmount ?? 0) + used.sum), assignedClientId: used.clientId, assignedInvoiceId: used.invoiceId,
          paidAmount: o.paidAmount ?? 0, updatedAt: now, ...(remaining <= 0.005 ? { settledAt: now } : {}),
        });
      }

      // Parts paid on the spot: the money shared over that customer's invoices, oldest first (a normal customer payment of the chosen day).
      const summary: Array<{ clientName: string; amount: number; paid: number; owes: number; invoices: string[] }> = [];
      for (let pi = 0; pi < a.parts.length; pi++) {
        const np = payNow[pi];
        let paid = 0;
        if (np) {
          const pool = np.splits.map((s) => ({ ...s, left: s.amount }));
          for (const inv of invoicesOfPart[pi]) {
            let need = r2(inv.amount);
            const part: Array<{ method: string; methodId?: Id<"paymentMethods">; amount: number; reference?: string }> = [];
            for (const p of pool) {
              if (need <= 0.001) break;
              const take = r2(Math.min(need, p.left));
              if (take <= 0) continue;
              part.push({ method: p.method, methodId: p.methodId, amount: take, reference: p.reference });
              p.left = r2(p.left - take); p.reference = undefined; // a reference is attached once only
              need = r2(need - take);
            }
            if (!part.length) continue;
            const r = await applyCustomerPayment(ctx, { invoiceId: inv.invoiceId, splits: part, paymentDate: date, notes: `Malipo ya papo hapo - ${clients[pi].name}` }, { tenantWide: true });
            paid = r2(paid + r.amount);
          }
        }
        summary.push({ clientName: clients[pi].name, amount: r2(a.parts[pi].amount), paid, owes: r2(a.parts[pi].amount - paid), invoices: invoicesOfPart[pi].map((i) => i.invoiceNo) });
      }
      const waiterLeft = r2(due - partsTotal);
      await logAudit(ctx, user, { action: "split_waiter_debt_to_customers", module: "sales", referenceId: String(orders[0]._id), referenceType: "waiterOrder", details: `bili ${orders.length}; deni ${due}; ${summary.map((x) => `${x.clientName}:${x.amount} (alilipa ${x.paid})`).join(", ")}; amebaki kwa mhudumu ${waiterLeft}` });
      return { total: partsTotal, waiterLeft, parts: summary };
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

// ───────────── EDIT what was received / where it was directed ─────────────

const isAssignedDebt = (i: Doc<"invoices">) => i.salesSource === "Selling Point" && !i.customerBillId && (i.notes ?? "").startsWith("Deni la bili ya");

/** Customer payments the cashier recorded lately (one row per receipt of one invoice), so a wrong method or amount can be corrected. */
export const recentCustomerPayments = query({
  args: {},
  handler: async (ctx) => {
    const { tenantId, branchId } = await cashierScope(ctx);
    const rows = (await ctx.db.query("customerPayments").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId)).order("desc").take(300))
      .filter((p) => !p.voided && !!p.invoiceId && (!branchId || p.branchId === branchId));
    const groups = new Map<string, { invoiceId: Id<"invoices">; receiptNo?: string; date: string; clientId: Id<"clients">; total: number; splits: Array<{ method: string; methodId?: Id<"paymentMethods">; amount: number; reference?: string }> }>();
    for (const p of rows) {
      const key = `${p.invoiceId}|${p.receiptNo ?? p._id}`;
      const g = groups.get(key) ?? { invoiceId: p.invoiceId!, receiptNo: p.receiptNo, date: p.paymentDate, clientId: p.clientId, total: 0, splits: [] };
      g.total = r2(g.total + p.amount);
      g.splits.push({ method: p.paymentMethod, methodId: p.paymentMethodId, amount: p.amount, reference: p.reference });
      groups.set(key, g);
    }
    const out = [];
    for (const g of [...groups.values()].slice(0, 40)) {
      const invoice = await ctx.db.get("invoices", g.invoiceId);
      if (!invoice || invoice.status !== "posted") continue;
      const client = await ctx.db.get("clients", g.clientId);
      out.push({ ...g, invoiceNo: invoice.invoiceNo, clientName: client?.name ?? "—", invoiceTotal: invoice.total, outstanding: invoice.outstanding, editable: !!g.receiptNo });
    }
    return out;
  },
});

/** Debts directed to customers (a waiter's bill moved to a customer, or split among customers): the invoices the cashier created that way. */
export const assignedDebts = query({
  args: {},
  handler: async (ctx) => {
    const { tenantId, branchId } = await cashierScope(ctx);
    const rows = (await ctx.db.query("invoices").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId)).order("desc").take(600))
      .filter((i) => i.status === "posted" && isAssignedDebt(i) && (!branchId || i.branchId === branchId)).slice(0, 60);
    const out = [];
    for (const i of rows) {
      const client = await ctx.db.get("clients", i.clientId);
      out.push({ _id: i._id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, clientId: i.clientId, clientName: client?.name ?? "—", total: i.total, amountPaid: i.amountPaid, outstanding: i.outstanding, note: i.notes ?? "" });
    }
    return out;
  },
});

/**
 * EDIT a customer payment (one receipt of one invoice): the wrong method was chosen, the split was typed wrongly, the amount or the day was wrong.
 * Nothing is erased: the old payment lines are voided and reversed in the ledger on their own day, and the corrected lines are booked like a
 * normal payment (each method into its own account). The invoice balance, the customer's debt, the dashboard and every payment report follow.
 */
export const editCustomerPayment = mutation({
  args: { invoiceId: v.id("invoices"), receiptNo: v.string(), splits: v.array(splitValidator), paymentDate: v.optional(v.string()) },
  handler: async (ctx, a) => {
    try {
      const { user, tenantId, branchId } = await cashierScope(ctx);
      const invoice = await ctx.db.get("invoices", a.invoiceId);
      if (!invoice || invoice.tenantId !== tenantId || (branchId && invoice.branchId !== branchId) || invoice.status !== "posted") throw new ConvexError("Invoice haipatikani au imeshafutwa.");
      const live = (await ctx.db.query("customerPayments").withIndex("by_invoice", (q) => q.eq("invoiceId", a.invoiceId)).collect()).filter((p) => !p.voided);
      const old = live.filter((p) => p.receiptNo === a.receiptNo);
      if (!old.length) throw new ConvexError("Malipo hayo hayapatikani (huenda yameshabadilishwa au kufutwa). Fungua orodha upya.");
      const oldTotal = r2(old.reduce((n, p) => n + p.amount, 0));
      const { splits, total } = await normaliseSplits(ctx, user, a.splits);
      const maxTotal = r2(invoice.outstanding + oldTotal);
      if (total <= 0.005 || total > maxTotal + 0.005) throw new ConvexError(`Jumla mpya (${total}) lazima iwe zaidi ya sifuri na isizidi deni la invoice (${maxTotal}).`);
      const refs = splits.map((s) => s.reference).filter((r): r is string => !!r);
      if (new Set(refs).size !== refs.length) throw new ConvexError("Reference moja imetumika mara mbili kwenye risiti hii.");
      if (refs.length) {
        const oldIds = new Set(old.map((p) => String(p._id)));
        const prior = await ctx.db.query("customerPayments").withIndex("by_client", (q) => q.eq("clientId", invoice.clientId)).collect();
        if (prior.some((p) => !oldIds.has(String(p._id)) && !p.voided && p.reference && refs.includes(p.reference) && p.tenantId === invoice.tenantId && p.branchId === invoice.branchId)) throw new ConvexError("Reference ya malipo imeshatumika; ombi linalofanana limezuiwa.");
      }
      const today = eatDay(new Date().toISOString());
      const oldDate = old[0].paymentDate;
      const date = a.paymentDate === undefined ? oldDate : assertDate(a.paymentDate, "Tarehe ya malipo");
      if (date > today) throw new ConvexError("Tarehe ya malipo haiwezi kuwa ya baadaye.");
      if (date < invoice.invoiceDate) throw new ConvexError(`Tarehe ya malipo haiwezi kuwa kabla ya tarehe ya invoice (${invoice.invoiceDate}).`);
      const scope = { tenantId: invoice.tenantId, branchId: invoice.branchId };
      const receivable = await getSystemAccount(ctx, scope, "1100", "Accounts receivable", "asset");
      for (const p of old) {
        const accountId = await methodAccount(ctx, scope, { methodId: p.paymentMethodId, method: p.paymentMethod });
        await postSystemJournal(ctx, { scope, userId: user._id, date: p.paymentDate, reference: `PAYEDIT-${String(p._id)}`, description: `Customer payment corrected for ${invoice.invoiceNo} (${p.paymentMethod} reversed)`, sourceType: "payment_edit", sourceId: String(p._id), lines: [
          { accountId: receivable, debit: p.amount, credit: 0, description: "Customer payment reversed - receivable restored" },
          { accountId, debit: 0, credit: p.amount, description: `Payment reversed - ${p.paymentMethod}` },
        ] });
        await ctx.db.patch("customerPayments", p._id, { voided: true });
        await bumpStats(ctx, scope, { receivable: p.amount, date: p.paymentDate, collected: -p.amount });
      }
      for (const s of splits) {
        const accountId = await methodAccount(ctx, scope, { methodId: s.methodId, method: s.method });
        const paymentId = await ctx.db.insert("customerPayments", { ...scope, paymentDate: date, clientId: invoice.clientId, invoiceId: a.invoiceId, amount: s.amount, paymentMethod: s.method, paymentMethodId: s.methodId, receiptNo: a.receiptNo, reference: s.reference, notes: old[0].notes, createdBy: user._id });
        await postSystemJournal(ctx, { scope, userId: user._id, date, reference: `PAY-${String(paymentId)}`, description: `Customer payment for ${invoice.invoiceNo} (${s.method})`, sourceType: "payment", sourceId: String(paymentId), lines: [
          { accountId, debit: s.amount, credit: 0, description: `Customer payment received - ${s.method}` },
          { accountId: receivable, debit: 0, credit: s.amount, description: "Reduce customer receivable" },
        ] });
      }
      await bumpStats(ctx, scope, { receivable: -total, date, collected: total });
      const paid = r2(invoice.amountPaid - oldTotal + total);
      const outstanding = r2(invoice.total - paid);
      await ctx.db.patch("invoices", a.invoiceId, { amountPaid: paid, outstanding, paymentStatus: outstanding <= 0.004 ? "paid" : paid > 0.004 ? "partial" : "unpaid" });
      await logAudit(ctx, user, { action: "edit_customer_payment", module: "sales", referenceId: String(a.invoiceId), referenceType: "invoice", details: `${invoice.invoiceNo}; ${old.map((p) => `${p.paymentMethod} ${p.amount}`).join(" + ")} (${oldDate}) -> ${splits.map((s) => `${s.method} ${s.amount}`).join(" + ")} (${date})` });
      return { invoiceNo: invoice.invoiceNo, total, outstanding, date };
    } catch (e) { throw surfaceError(e); }
  },
});

/**
 * UNPAY a customer payment (one receipt of one invoice): the money was not really received / was saved by mistake.
 * The payment lines are voided and reversed in the ledger on their own day; the invoice owes that amount again. Nothing is erased.
 */
export const unpayCustomerPayment = mutation({
  args: { invoiceId: v.id("invoices"), receiptNo: v.string() },
  handler: async (ctx, a) => {
    try {
      const { user, tenantId, branchId } = await cashierScope(ctx);
      const invoice = await ctx.db.get("invoices", a.invoiceId);
      if (!invoice || invoice.tenantId !== tenantId || (branchId && invoice.branchId !== branchId) || invoice.status !== "posted") throw new ConvexError("Invoice haipatikani au imeshafutwa.");
      const old = (await ctx.db.query("customerPayments").withIndex("by_invoice", (q) => q.eq("invoiceId", a.invoiceId)).collect()).filter((p) => !p.voided && p.receiptNo === a.receiptNo);
      if (!old.length) throw new ConvexError("Malipo hayo hayapatikani (huenda yameshabadilishwa au kufutwa). Fungua orodha upya.");
      const total = r2(old.reduce((n, p) => n + p.amount, 0));
      const scope = { tenantId: invoice.tenantId, branchId: invoice.branchId };
      const receivable = await getSystemAccount(ctx, scope, "1100", "Accounts receivable", "asset");
      for (const p of old) {
        const accountId = await methodAccount(ctx, scope, { methodId: p.paymentMethodId, method: p.paymentMethod });
        await postSystemJournal(ctx, { scope, userId: user._id, date: p.paymentDate, reference: `PAYUNDO-${String(p._id)}`, description: `Customer payment taken back for ${invoice.invoiceNo} (${p.paymentMethod})`, sourceType: "payment_void", sourceId: String(p._id), lines: [
          { accountId: receivable, debit: p.amount, credit: 0, description: "Customer payment taken back - receivable restored" },
          { accountId, debit: 0, credit: p.amount, description: `Payment taken back - ${p.paymentMethod}` },
        ] });
        await ctx.db.patch("customerPayments", p._id, { voided: true });
        await bumpStats(ctx, scope, { receivable: p.amount, date: p.paymentDate, collected: -p.amount });
      }
      const paid = r2(Math.max(0, invoice.amountPaid - total));
      const outstanding = r2(invoice.total - paid);
      await ctx.db.patch("invoices", a.invoiceId, { amountPaid: paid, outstanding, paymentStatus: outstanding <= 0.004 ? "paid" : paid > 0.004 ? "partial" : "unpaid" });
      await logAudit(ctx, user, { action: "unpay_customer_payment", module: "sales", referenceId: String(a.invoiceId), referenceType: "invoice", details: `${invoice.invoiceNo}; ${old.map((p) => `${p.paymentMethod} ${p.amount}`).join(" + ")} (${old[0].paymentDate}) taken back` });
      return { invoiceNo: invoice.invoiceNo, total, outstanding };
    } catch (e) { throw surfaceError(e); }
  },
});

/**
 * Change WHICH customer a debt was directed to (the cashier picked the wrong customer). Only invoices made by "Elekeza deni kwa mteja" /
 * "Gawanya deni" can be moved. The invoice and its payments follow the right customer, so his statement, debt and reports are correct.
 * The amount and the ledger do not change (the receivable account is the business's, not the customer's).
 */
export const reassignDebt = mutation({
  args: { invoiceId: v.id("invoices"), clientId: v.id("clients") },
  handler: async (ctx, a) => {
    try {
      const { user, tenantId, branchId } = await cashierScope(ctx);
      const invoice = await ctx.db.get("invoices", a.invoiceId);
      if (!invoice || invoice.tenantId !== tenantId || (branchId && invoice.branchId !== branchId) || invoice.status !== "posted") throw new ConvexError("Deni halipatikani au limeshafutwa.");
      if (!isAssignedDebt(invoice)) throw new ConvexError("Hili si deni lililoelekezwa kwa mteja na cashier; haliwezi kuhamishwa hapa.");
      if (invoice.clientId === a.clientId) throw new ConvexError("Mteja huyo ndiye aliyepo tayari.");
      const next = await ctx.db.get("clients", a.clientId);
      if (!clientUsable(next, tenantId, invoice.branchId)) throw new ConvexError("Mteja huyu hayupo kwenye biashara au idara ya deni hili.");
      const prev = await ctx.db.get("clients", invoice.clientId);
      for (const p of await ctx.db.query("customerPayments").withIndex("by_invoice", (q) => q.eq("invoiceId", a.invoiceId)).collect()) await ctx.db.patch("customerPayments", p._id, { clientId: a.clientId });
      await ctx.db.patch("invoices", a.invoiceId, { clientId: a.clientId, notes: [invoice.notes, `Mteja amebadilishwa: ${prev?.name ?? "?"} -> ${next!.name} (${eatDay(new Date().toISOString())})`].filter(Boolean).join(" | ") });
      await logAudit(ctx, user, { action: "reassign_customer_debt", module: "sales", referenceId: String(a.invoiceId), referenceType: "invoice", details: `${invoice.invoiceNo}; ${prev?.name ?? "?"} -> ${next!.name}; deni ${invoice.outstanding}` });
      return { invoiceNo: invoice.invoiceNo, clientName: next!.name };
    } catch (e) { throw surfaceError(e); }
  },
});
