import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { waiterOwes } from "./waiterMath";
import { activeDepartments, allowedBranchIds, isSuperAdmin, logAudit, requireActiveUser, requirePermission, roleHasPermission } from "./access";
import type { UserLike } from "./access";
import { accRows, addDays, channelOfKind, entryRows, isDate, round2, statementOf, summarize, type DebtRow, type ExpenseItem, type JEntry, type RepaidRow, type Row, type WaiterSalesRow } from "./reportCore";

/**
 * PERIOD REPORT (Accounts > Ripoti ya Siku / Mwezi / Mwaka)
 *
 * `chunk` reads the posted journal entries of a SHORT date range (through the tenant+date index) and returns small additive rows,
 * one section per department. The screen asks for the range in pieces (a week at a time, halving a piece when it is too big)
 * and adds the pieces up, so a whole year never has to be read by one call.
 * `save` keeps a snapshot of a generated report (history table); `history` / `getRun` list and reopen them.
 */

const MAX_ENTRIES = 1200; // entries per call (each has ~6 lines): keeps one call far below Convex read limits
const MAX_SNAPSHOT = 900_000; // bytes of JSON kept per saved report (a document may not exceed 1 MiB)
const bkey = (branchId: unknown) => (branchId ? String(branchId) : "none");

/** Departments the user may report on: a user tied to one department sees only that one; others see all (or one they choose). */
async function reportScope(ctx: QueryCtx, user: UserLike, requested: string | undefined) {
  if (!user.tenantId) return { tenantId: null, departments: [] as Array<{ id: string; name: string }>, only: null as string | null, hasDepartments: false };
  const departments = (await activeDepartments(ctx, user.tenantId)).map((b) => ({ id: String(b._id), name: b.name }));
  // Same rule as the top-bar department switch (tenants.current): a user tied to one department cannot look at the others.
  // A user given several departments reports on the one he is working in now (switch in the top bar to report on another).
  const canSwitch = (isSuperAdmin(user) || !user.branchId || !!user.branchPicked) && !allowedBranchIds(user);
  const fixed = canSwitch ? null : String(user.branchId);
  const only = fixed ?? (requested && requested !== "all" ? requested : null);
  if (only && !departments.some((d) => d.id === only)) throw new ConvexError("Idara hiyo haipo kwenye biashara yako.");
  return { tenantId: user.tenantId, departments, only, hasDepartments: departments.length > 0 };
}

export const options = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    const scope = await reportScope(ctx, user, undefined);
    return { departments: scope.departments, fixedDepartment: scope.only, hasDepartments: scope.hasDepartments };
  },
});

export const chunk = query({
  args: { from: v.string(), to: v.string(), scope: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    if (!isDate(a.from) || !isDate(a.to) || a.to < a.from) throw new ConvexError("Tarehe za ripoti si sahihi.");
    const sc = await reportScope(ctx, user, a.scope);
    if (!sc.tenantId) return { tooBig: false, sections: [] as Array<{ bk: string; rows: Row[]; items: ExpenseItem[] }> };
    // One department chosen/locked: read only its entries, so a big department cannot make a small one "too big".
    const tenantId = sc.tenantId;
    const onlyBranch = sc.only ? ctx.db.normalizeId("branches", sc.only) : null;
    const entries = onlyBranch
      ? await ctx.db.query("journalEntries").withIndex("by_scope_date", (q) => q.eq("tenantId", tenantId).eq("branchId", onlyBranch).gte("entryDate", a.from).lte("entryDate", a.to)).take(MAX_ENTRIES + 1)
      : await ctx.db.query("journalEntries").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).gte("entryDate", a.from).lte("entryDate", a.to)).take(MAX_ENTRIES + 1);
    if (entries.length > MAX_ENTRIES) return { tooBig: true, sections: [] as Array<{ bk: string; rows: Row[]; items: ExpenseItem[] }> };

    const accounts = new Map<string, Doc<"accounts"> | null>();
    const byBranch = new Map<string, Map<string, Row>>();
    const itemsBy = new Map<string, ExpenseItem[]>();
    // Which channel (CASH / LIPA / BANK) each payment-method account belongs to.
    const kindOf = new Map<string, string>();
    for (const m of await ctx.db.query("paymentMethods").withIndex("by_scope", (q) => q.eq("tenantId", tenantId)).collect()) if (m.accountId) kindOf.set(String(m.accountId), m.kind);
    for (const e of entries) {
      if (e.status !== "posted") continue;
      const bk = bkey(e.branchId);
      if (sc.only && bk !== sc.only) continue;
      const lines: JEntry["lines"] = [];
      for (const l of await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect()) {
        const k = String(l.accountId);
        if (!accounts.has(k)) accounts.set(k, await ctx.db.get("accounts", l.accountId));
        const ac = accounts.get(k);
        if (ac) {
          lines.push({ code: ac.code, name: ac.name, type: ac.type, subtype: ac.subtype, debit: l.debit, credit: l.credit, channel: ac.subtype === "payment_method" && kindOf.has(k) ? channelOfKind(kindOf.get(k)) : undefined });
          // Every operating expense exactly as it was entered (date, who/what, category, amount); cost of goods is not an expense line.
          if (ac.type === "expense" && ac.code !== "5000") {
            const amount = round2((l.debit || 0) - (l.credit || 0));
            if (amount !== 0) { const list = itemsBy.get(bk) ?? []; list.push({ bk, d: e.entryDate, t: (e.description || "").slice(0, 160), c: ac.name, a: amount }); itemsBy.set(bk, list); }
          }
        }
      }
      let acc = byBranch.get(bk); if (!acc) { acc = new Map(); byBranch.set(bk, acc); }
      entryRows({ entryDate: e.entryDate, sourceType: e.sourceType, lines }, acc);
    }
    const keys = new Set([...byBranch.keys(), ...itemsBy.keys()]);
    return { tooBig: false, sections: [...keys].map((bk) => ({ bk, rows: accRows(byBranch.get(bk) ?? new Map()), items: itemsBy.get(bk) ?? [] })) };
  },
});

/**
 * SELLING POINT (waiter) SALES and DEBTS of the period - read from the ORDERS, by the day they were sold (East Africa Time), exactly like the Sales report:
 *  (1) `waiterSales`: every bill a waiter sent / printed in the period, paid or not (a sale is a sale), with its cost of goods (capital);
 *  (2) `waiters`: the part of those bills that waiters have not handed over yet (listed by name);
 *  (3) `repaid`: money the cashier received in the period for bills of days that were already CLOSED (repayments, counted on the day received);
 *  (4) `customers`: customers who took goods on credit (invoices of the period with an outstanding balance).
 * The screen asks for short pieces of the range (a week at a time, halving a piece when `truncated`) and adds them up.
 * `cost` of a waiter row = what the unpaid goods cost (from the stock movements of the order), so the report can split sales into capital and profit.
 */
const MAX_DEBT_ORDERS = 700;
const eatDay = (iso: string) => new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 10); // East Africa Time business day
const dayStartIso = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 3 * 3600000).toISOString(); // 00:00 EAT of that day, as UTC
export const debts = query({
  args: { from: v.string(), to: v.string(), scope: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    if (!isDate(a.from) || !isDate(a.to) || a.to < a.from) throw new ConvexError("Tarehe za ripoti si sahihi.");
    const sc = await reportScope(ctx, user, a.scope);
    const waiters: DebtRow[] = [], customers: DebtRow[] = [], waiterSales: WaiterSalesRow[] = [], repaid: RepaidRow[] = [];
    if (!sc.tenantId) return { waiters, customers, waiterSales, repaid, truncated: false };
    const tenantId = sc.tenantId;
    let truncated = false;
    const byWaiter = new Map<string, DebtRow>();
    const salesBy = new Map<string, WaiterSalesRow>();
    const orders = await ctx.db.query("waiterOrders").withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId).gte("createdAt", dayStartIso(a.from)).lt("createdAt", dayStartIso(addDays(a.to, 1)))).take(MAX_DEBT_ORDERS + 1);
    if (orders.length > MAX_DEBT_ORDERS) truncated = true;
    for (const o of orders.slice(0, MAX_DEBT_ORDERS)) {
      if (o.cancelledAt || !(o.status === "pending" || o.status === "accepted" || o.status === "printed")) continue; // drafts and cancelled bills are not sales
      const bk = bkey(o.branchId);
      if (sc.only && bk !== sc.only) continue;
      // The part moved to a registered customer is that customer's invoice (booked with the invoices), so it is not counted twice here.
      const sale = round2(o.total - (o.assignedAmount ?? 0));
      if (sale <= 0) continue;
      const moves = await ctx.db.query("stockMovements").withIndex("by_reference", (q) => q.eq("referenceType", "waiterOrder").eq("referenceId", String(o._id))).collect();
      const full = moves.reduce((n, m) => n + (m.qtyOut - m.qtyIn) * (m.unitCost ?? 0), 0);
      const sRow = salesBy.get(bk) ?? { bk, orders: 0, sales: 0, cost: 0 };
      sRow.orders += 1; sRow.sales = round2(sRow.sales + sale); sRow.cost = round2(sRow.cost + (o.total > 0 ? full * Math.min(1, sale / o.total) : 0));
      salesBy.set(bk, sRow);
      const left = waiterOwes(o);
      if (o.settledAt || left <= 0) continue;
      const cost = o.total > 0 ? round2(full * Math.min(1, left / o.total)) : 0;
      const key = `${bk}|${o.waiterId}`;
      const cur = byWaiter.get(key) ?? { bk, name: o.waiterName, orders: 0, amount: 0, cost: 0 };
      cur.orders += 1; cur.amount = round2(cur.amount + left); cur.cost = round2(cur.cost + cost);
      byWaiter.set(key, cur);
    }
    waiters.push(...[...byWaiter.values()].sort((x, y) => y.amount - x.amount));
    waiterSales.push(...salesBy.values());

    // Repayments: money received in the period for bills whose day was already closed (they were reported as debts on their own day).
    const byRepaid = new Map<string, number>();
    const cols = await ctx.db.query("waiterCollections").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).gte("date", a.from).lte("date", a.to)).take(MAX_DEBT_ORDERS + 1);
    if (cols.length > MAX_DEBT_ORDERS) truncated = true;
    for (const c of cols.slice(0, MAX_DEBT_ORDERS)) {
      for (const orderId of c.orderIds) {
        const o = await ctx.db.get("waiterOrders", orderId);
        if (!o || o.tenantId !== tenantId || !o.closedAt || eatDay(o.createdAt) >= c.date) continue;
        const bk = bkey(o.branchId);
        if (sc.only && bk !== sc.only) continue;
        const part = c.allocations?.find((x) => x.orderId === orderId)?.amount ?? round2(o.total - (o.assignedAmount ?? 0));
        byRepaid.set(bk, round2((byRepaid.get(bk) ?? 0) + part));
      }
    }
    repaid.push(...[...byRepaid.entries()].map(([bk, amount]) => ({ bk, amount })));

    // Customers' credit sales: the invoice is already booked as sales (and its cost), so cost stays 0 here; shown only as a debt list.
    const invoices = await ctx.db.query("invoices").withIndex("by_tenant_date", (q) => q.eq("tenantId", tenantId).gte("invoiceDate", a.from).lte("invoiceDate", a.to)).take(MAX_DEBT_ORDERS + 1);
    if (invoices.length > MAX_DEBT_ORDERS) truncated = true;
    const byClient = new Map<string, DebtRow>();
    const names = new Map<string, string>();
    for (const inv of invoices.slice(0, MAX_DEBT_ORDERS)) {
      if (inv.status !== "posted" || inv.outstanding <= 0) continue;
      const bk = bkey(inv.branchId);
      if (sc.only && bk !== sc.only) continue;
      const ck = String(inv.clientId);
      if (!names.has(ck)) names.set(ck, (await ctx.db.get("clients", inv.clientId))?.name ?? "—");
      const key = `${bk}|${ck}`;
      const cur = byClient.get(key) ?? { bk, name: names.get(ck) ?? "—", orders: 0, amount: 0, cost: 0 };
      cur.orders += 1; cur.amount = round2(cur.amount + inv.outstanding);
      byClient.set(key, cur);
    }
    customers.push(...[...byClient.values()].sort((x, y) => y.amount - x.amount));
    return { waiters, customers, waiterSales, repaid, truncated };
  },
});

/** Business header printed on the report (name, address, phone, currency). */
export const header = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    if (!user.tenantId) return null;
    const tenant = await ctx.db.get("tenants", user.tenantId);
    const rows = await ctx.db.query("companySettings").withIndex("by_tenant", (q) => q.eq("tenantId", user.tenantId)).collect();
    const c = rows.find((r) => !r.branchId) ?? rows[0] ?? null;
    return { businessName: c?.companyName || tenant?.name || "", address: c?.address ?? "", phone: c?.phone ?? "", email: c?.email ?? "", tin: c?.taxId ?? "", currencySymbol: c?.currencySymbol ?? "TSh", decimalPlaces: c?.decimalPlaces ?? 0, preparedBy: user.name ?? user.username ?? user.email ?? "" };
  },
});

const itemValidator = v.object({ bk: v.string(), d: v.string(), t: v.string(), c: v.string(), a: v.number() });
const debtValidator = v.object({ bk: v.string(), name: v.string(), orders: v.number(), amount: v.number(), cost: v.number() });
const sectionValidator = v.object({ bk: v.string(), name: v.string(), rows: v.array(v.object({ g: v.string(), k: v.string(), label: v.string(), a: v.number(), b: v.number(), c: v.number() })), items: v.optional(v.array(itemValidator)) });
const debtsValidator = v.object({ waiters: v.array(debtValidator), customers: v.array(debtValidator), waiterSales: v.optional(v.array(v.object({ bk: v.string(), orders: v.number(), sales: v.number(), cost: v.number() }))), repaid: v.optional(v.array(v.object({ bk: v.string(), amount: v.number() }))) });

export const save = mutation({
  args: { period: v.string(), startDate: v.string(), endDate: v.string(), scope: v.string(), scopeLabel: v.string(), title: v.string(), sections: v.array(sectionValidator), debts: v.optional(debtsValidator) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    if (!user.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    if (!["day", "month", "year"].includes(a.period)) throw new ConvexError("Aina ya ripoti si sahihi.");
    if (!isDate(a.startDate) || !isDate(a.endDate) || a.endDate < a.startDate) throw new ConvexError("Tarehe za ripoti si sahihi.");
    // The department scope of a saved report must be one this user may report on (a department-locked user: only his own).
    const sc = await reportScope(ctx, user, a.scope);
    if (sc.only ? a.scope !== sc.only : a.scope !== "all") throw new ConvexError("Idara ya ripoti hairuhusiwi kwa akaunti yako.");
    if (sc.only && a.sections.some((s) => s.bk !== sc.only)) throw new ConvexError("Ripoti ina data ya idara nyingine.");
    const sum = summarize(a.sections.flatMap((s) => s.rows));
    const all = statementOf(sum, a.debts);
    // The snapshot must stay under the document limit: drop the per-day rows first, then the itemised expense list (category totals stay).
    let sections = a.sections;
    const size = () => JSON.stringify({ sections, debts: a.debts }).length;
    if (size() > MAX_SNAPSHOT) sections = sections.map((s) => ({ ...s, rows: s.rows.filter((r) => r.g !== "day") }));
    if (size() > MAX_SNAPSHOT) sections = sections.map((s) => ({ ...s, items: [] }));
    const data = JSON.stringify({ sections, debts: a.debts });
    if (data.length > MAX_SNAPSHOT) throw new ConvexError("Ripoti ni kubwa mno kuhifadhiwa; chagua kipindi kifupi au idara moja.");
    const id = await ctx.db.insert("reportRuns", {
      tenantId: user.tenantId, period: a.period, startDate: a.startDate, endDate: a.endDate, scope: a.scope, scopeLabel: a.scopeLabel.slice(0, 120), title: a.title.slice(0, 160),
      netProfit: all.profitAfter, netSales: all.sales, totalExpenses: all.expenses, data,
      createdBy: user._id, createdByName: user.name ?? user.username ?? user.email ?? "user", createdAt: new Date().toISOString(),
    });
    // CLOSING THE DAY: the waiters' unpaid orders of this day report are listed in the report as debts, so they leave the cashier's normal
    // "Receive waiters' money" list and wait under "Closed debts", where the cashier can still receive them later. Nothing is deleted or settled.
    if (a.period === "day") await closeDayDebts(ctx, user.tenantId, sc, a.startDate, a.endDate, id);
    await logAudit(ctx, user, { action: "generate_period_report", module: "accounts", referenceId: String(id), referenceType: "reportRun", details: `${a.period} ${a.startDate}..${a.endDate} ${a.scopeLabel}` });
    return id;
  },
});

async function closeDayDebts(ctx: MutationCtx, tenantId: Doc<"users">["tenantId"] & {}, sc: { only?: string | null; departments: Array<{ id: string }> }, from: string, to: string, reportId: Doc<"reportRuns">["_id"]) {
  const now = new Date().toISOString();
  // Read the bills of the closed day(s) by their date (never by status: settled bills keep their status, so a status scan fills up with old bills).
  const orders = await ctx.db.query("waiterOrders").withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId).gte("createdAt", dayStartIso(from)).lt("createdAt", dayStartIso(addDays(to, 1)))).take(CLOSE_CAP + 1);
  if (orders.length > CLOSE_CAP) throw new ConvexError("Siku hii ina oda nyingi mno kufungwa kwa mara moja; wasiliana na msimamizi.");
  for (const o of orders) {
    if (!(o.status === "pending" || o.status === "accepted" || o.status === "printed")) continue;
    if (o.settledAt || o.cancelledAt || o.closedAt || waiterOwes(o) <= 0) continue;
    if (sc.only && bkey(o.branchId) !== sc.only) continue;
    await ctx.db.patch("waiterOrders", o._id, { closedAt: now, closedReportId: reportId });
  }
}
const CLOSE_CAP = 3000;

/** Newest saved reports first (a user tied to one department sees only that department's reports). */
export const history = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    const tenantId = user.tenantId;
    if (!tenantId) return [];
    const sc = await reportScope(ctx, user, undefined);
    const rows = await ctx.db.query("reportRuns").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).order("desc").take(Math.min(Math.max(Math.floor(a.limit ?? 30), 1), 100));
    return rows.filter((r) => !sc.only || r.scope === sc.only).map((r) => ({ _id: r._id, title: r.title, period: r.period, startDate: r.startDate, endDate: r.endDate, scopeLabel: r.scopeLabel, netSales: r.netSales, totalExpenses: r.totalExpenses, netProfit: r.netProfit, createdByName: r.createdByName, createdAt: r.createdAt }));
  },
});

export const getRun = query({
  args: { id: v.id("reportRuns") },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");
    const r = await ctx.db.get("reportRuns", a.id);
    if (!r || r.tenantId !== user.tenantId) return null;
    const sc = await reportScope(ctx, user, undefined);
    if (sc.only && r.scope !== sc.only) return null;
    return { _id: r._id, title: r.title, period: r.period, startDate: r.startDate, endDate: r.endDate, scope: r.scope, scopeLabel: r.scopeLabel, createdByName: r.createdByName, createdAt: r.createdAt, ...(() => { const d = JSON.parse(r.data) as { sections: Array<{ bk: string; name: string; rows: Row[]; items?: ExpenseItem[] }>; debts?: { waiters: DebtRow[]; customers: DebtRow[]; waiterSales?: WaiterSalesRow[]; repaid?: RepaidRow[] } }; return { sections: d.sections, debts: d.debts ?? null }; })() };
  },
});

/** Delete a saved report snapshot. Super Admin only; never deletes accounting transactions. */
export const deleteRun = mutation({
  args: { id: v.id("reportRuns") },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.reports.view", "accounts");

    if (!isSuperAdmin(user)) {
      throw new ConvexError("Super Admin pekee ndiye anayeruhusiwa kufuta ripoti.");
    }

    if (!user.tenantId) throw new ConvexError("Chagua biashara kwanza.");

    const report = await ctx.db.get("reportRuns", a.id);
    if (!report || report.tenantId !== user.tenantId) {
      throw new ConvexError("Ripoti haipo kwenye biashara yako.");
    }

    await logAudit(ctx, user, {
      action: "delete_period_report",
      module: "accounts",
      referenceId: String(report._id),
      referenceType: "reportRun",
      details: `${report.title} ${report.startDate}..${report.endDate}`,
    });

    // Debts that this report closed go back to the cashier's normal list (the report no longer exists to record them).
    const closed = await ctx.db.query("waiterOrders").withIndex("by_closed_report", (q) => q.eq("closedReportId", report._id)).collect();
    for (const o of closed) await ctx.db.patch("waiterOrders", o._id, { closedAt: undefined, closedReportId: undefined });
    await ctx.db.delete("reportRuns", report._id);
    return { success: true };
  },
});