import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { canAccessRecord, filterScoped, isOwnDataOnly, isManagerRole, normalizeRole, requireActiveUser, resolveWriteScope, scopedRows, getCompanySettings } from "./access";
import { bumpStats } from "./stats";
import { getSystemAccount, methodAccount, postSystemJournal, roundMoney } from "./ledger";
import { normaliseSplits, splitValidator } from "./paymentMethods";

const lineValidator = v.object({ productId: v.id("products"), qty: v.number(), unitPrice: v.number(), discount: v.optional(v.number()) });
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Staff mode (users.ownDataOnly): only invoices this user created. */
const mine = (user: any, rows: any[]) => (isOwnDataOnly(user) ? rows.filter((r) => r.createdBy === user._id) : rows);

/** Newest invoices first through an index (default 200, max 1000) - never the whole history. Returned oldest -> newest. */
export const listInvoices = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "sales");
    if (!user.tenantId) return [];
    const tenantId = user.tenantId;
    const limit = Math.min(Math.max(Math.floor(a.limit ?? 200), 1), 1000);
    const q = ctx.db.query("invoices");
    const rows = isOwnDataOnly(user)
      ? await q.withIndex("by_tenant_user_date", (i) => i.eq("tenantId", tenantId).eq("createdBy", user._id)).order("desc").take(limit)
      : user.branchId
        ? await q.withIndex("by_scope", (i) => i.eq("tenantId", tenantId).eq("branchId", user.branchId)).order("desc").take(limit)
        : await q.withIndex("by_tenant_date", (i) => i.eq("tenantId", tenantId)).order("desc").take(limit);
    return mine(user, filterScoped(user, rows)).reverse();
  },
});
export const invoiceDetails = query({ args: { id: v.id("invoices") }, handler: async (ctx, { id }) => { const user = await requireActiveUser(ctx, "sales"); const invoice = await ctx.db.get(id); if (!canAccessRecord(user, invoice) || (isOwnDataOnly(user) && invoice?.createdBy !== user._id)) return null; return { invoice, lines: await ctx.db.query("invoiceLines").withIndex("by_invoice", q => q.eq("invoiceId", id)).collect() }; } });

export const createInvoice = mutation({
  args: { clientId: v.id("clients"), invoiceDate: v.string(), lines: v.array(lineValidator), discount: v.optional(v.number()), taxRate: v.optional(v.number()), paymentAmount: v.optional(v.number()), paymentMethod: v.optional(v.string()), paymentMethodId: v.optional(v.id("paymentMethods")), notes: v.optional(v.string()), salesSource: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireActiveUser(ctx, "sales"); const scope = await resolveWriteScope(ctx, user);
    if (!args.lines.length) throw new Error("Invoice lazima iwe na angalau bidhaa moja.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.invoiceDate)) throw new Error("Tarehe ya invoice si sahihi.");
    const client = await ctx.db.get(args.clientId); if (!canAccessRecord(user, client)) throw new Error("Mteja hayupo kwenye ofisi/branch yako.");
    const company = await getCompanySettings(ctx, user);
    const allowNegativeStock = !!company?.allowNegativeStock;
    const invoicePrefix = (company?.invoicePrefix ?? "INV-") || "INV-";
    const requested = new Map<string, number>(); // same product on several lines must be checked together
    for (const line of args.lines) requested.set(String(line.productId), (requested.get(String(line.productId)) ?? 0) + (Number.isFinite(line.qty) ? line.qty : 0));
    const prepared: Array<{ productId: Id<"products">; qty: number; unitPrice: number; discount: number; lineTotal: number; cost: number }> = [];
    let subtotal = 0;
    for (const line of args.lines) {
      if (!Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) throw new Error("Kiasi au bei si sahihi.");
      const product = await ctx.db.get(line.productId); if (!product || !canAccessRecord(user, product) || !product.isActive) throw new Error("Bidhaa haipatikani kwenye branch hii.");
      if (!allowNegativeStock && product.currentQty + 1e-8 < (requested.get(String(line.productId)) ?? line.qty)) throw new Error(`Stock haitoshi kwa ${product.name}. Iliyopo: ${product.currentQty}, unayouza: ${requested.get(String(line.productId))}`);
      const discount = money(line.discount ?? 0); const gross = money(line.qty * line.unitPrice); if (discount < 0 || discount > gross) throw new Error("Discount si sahihi.");
      const lineTotal = money(gross - discount); subtotal += lineTotal; prepared.push({ productId: line.productId, qty: line.qty, unitPrice: line.unitPrice, discount, lineTotal, cost: product.weightedAvgCost ?? product.lastPurchaseCost ?? 0 });
    }
    subtotal = money(subtotal); const discount = money(args.discount ?? 0); if (discount < 0 || discount > subtotal) throw new Error("Discount ya invoice si sahihi.");
    const taxable = money(subtotal - discount); const taxRate = args.taxRate ?? 0; if (taxRate < 0 || taxRate > 100) throw new Error("Tax rate lazima iwe kati ya 0 na 100.");
    const taxAmount = money(taxable * taxRate / 100); const total = money(taxable + taxAmount); const paid = money(args.paymentAmount ?? 0); if (paid !== 0 && normalizeRole(user.role) !== "cashier" && !(await isManagerRole(ctx, user))) throw new Error("Malipo ya invoice yafanywe na cashier kupitia Cashier — Pokea Malipo."); if (paid < 0 || paid > total) throw new Error("Kiasi kilicholipwa si sahihi.");
    const initialPay = paid > 0 ? (await normaliseSplits(ctx, user, [{ method: args.paymentMethod ?? "cash", methodId: args.paymentMethodId, amount: paid }])).splits[0] : null;
    const seqRows = await ctx.db.query("salesSequences").withIndex("by_scope", q => scope.branchId ? q.eq("tenantId", scope.tenantId).eq("branchId", scope.branchId) : q.eq("tenantId", scope.tenantId)).collect();
    const sequence = seqRows.find(x => x.tenantId === scope.tenantId && x.branchId === scope.branchId);
    let nextNo = sequence?.nextNumber ?? 1;
    let invoiceNo = `${invoicePrefix}${String(nextNo).padStart(5, "0")}`;
    for (;;) { // never reuse a number that already exists in this office/branch
      const clash = (await ctx.db.query("invoices").withIndex("by_tenant_no", q => q.eq("tenantId", scope.tenantId).eq("invoiceNo", invoiceNo)).collect()).some(x => x.branchId === scope.branchId);
      if (!clash) break; nextNo++; invoiceNo = `${invoicePrefix}${String(nextNo).padStart(5, "0")}`;
    }
    if (sequence) await ctx.db.patch(sequence._id, { nextNumber: nextNo + 1 }); else await ctx.db.insert("salesSequences", { ...scope, nextNumber: nextNo + 1 });
    const invoiceId = await ctx.db.insert("invoices", { ...scope, invoiceNo, invoiceDate: args.invoiceDate, clientId: args.clientId, subtotal, discount, taxAmount, total, amountPaid: paid, outstanding: money(total-paid), paymentStatus: paid === total ? "paid" : paid > 0 ? "partial" : "unpaid", status: "posted", salespersonId: user._id, salesSource: args.salesSource, notes: args.notes, createdBy: user._id, postedAt: new Date().toISOString() });
    await bumpStats(ctx, scope, { receivable: money(total - paid), date: args.invoiceDate, sales: total, collected: paid, invoices: 1 });
    for (const line of prepared) {
      await ctx.db.insert("invoiceLines", { invoiceId, productId: line.productId, qty: line.qty, qtyStr: String(line.qty), unitPrice: line.unitPrice, unitPriceStr: String(line.unitPrice), lineTotal: line.lineTotal, lineTotalStr: String(line.lineTotal), costAtSale: line.cost, discount: line.discount });
      const product = await ctx.db.get(line.productId); if (!product) throw new Error("Bidhaa haipatikani."); const balance = product.currentQty - line.qty;
      await ctx.db.patch(line.productId, { currentQty: balance });
      await ctx.db.insert("stockMovements", { ...scope, movementDate: args.invoiceDate, productId: line.productId, movementType: "sale", referenceId: String(invoiceId), referenceType: "invoice", qtyIn: 0, qtyOut: line.qty, runningBalance: balance, unitCost: line.cost, clientId: args.clientId, createdBy: user._id });
    }
    if (paid > 0) await ctx.db.insert("customerPayments", { ...scope, paymentDate: args.invoiceDate, clientId: args.clientId, invoiceId, amount: paid, paymentMethod: initialPay?.method ?? "cash", paymentMethodId: initialPay?.methodId, createdBy: user._id, notes: "Malipo ya awali ya invoice" });
    // Post revenue, receivable/cash, tax and cost of goods sold atomically with invoice and stock.
    const cash = initialPay ? await methodAccount(ctx, scope, { methodId: initialPay.methodId, method: initialPay.method }) : await getSystemAccount(ctx, scope, "1000", "Cash and equivalents", "asset"); // money goes to the account of the method it was paid with
    const receivable = await getSystemAccount(ctx, scope, "1100", "Accounts receivable", "asset");
    const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
    const taxPayable = await getSystemAccount(ctx, scope, "2150", "Tax payable", "liability");
    const revenue = await getSystemAccount(ctx, scope, "4000", "Sales revenue", "revenue");
    const cogs = await getSystemAccount(ctx, scope, "5000", "Cost of goods sold", "expense");
    const costTotal = roundMoney(prepared.reduce((n, l) => n + l.qty * l.cost, 0));
    const journalLines: Array<{accountId:any;debit:number;credit:number;description:string}> = [
      { accountId: cash, debit: paid, credit: 0, description: `Payment received for sale${initialPay ? ` - ${initialPay.method}` : ""}` },
      { accountId: receivable, debit: money(total-paid), credit: 0, description: "Customer receivable" },
      { accountId: revenue, debit: 0, credit: money(total-taxAmount), description: "Sales revenue" },
      { accountId: taxPayable, debit: 0, credit: taxAmount, description: "Tax collected" },
      { accountId: cogs, debit: costTotal, credit: 0, description: "Cost of goods sold" },
      { accountId: inventory, debit: 0, credit: costTotal, description: "Inventory relieved" },
    ];
    await postSystemJournal(ctx, { scope, userId: user._id, date: args.invoiceDate, reference: `SALE-${invoiceNo}`, description: `Automatic posting for ${invoiceNo}`, sourceType: "sale", sourceId: String(invoiceId), lines: journalLines });
    await ctx.db.insert("auditLogs", { userId: user._id, userName: user.name ?? user.email ?? "user", action: "create_and_post", module: "sales", referenceId: String(invoiceId), referenceType: "invoice", details: `Invoice ${invoiceNo}; total ${total}`, timestamp: new Date().toISOString(), result: "success" });
    return { invoiceId, invoiceNo, subtotal, taxAmount, total, amountPaid: paid, outstanding: money(total-paid) };
  }
});

/**
 * Receive a customer payment on one invoice. One receipt may be split over several methods, e.g. a customer who owes
 * 30,000 pays 10,000 by phone + 10,000 by bank + 10,000 cash: pass `splits`. (`amount` + `paymentMethod` still work for a single method.)
 */
export const recordPayment = mutation({ args: { invoiceId: v.id("invoices"), amount: v.optional(v.number()), paymentMethod: v.optional(v.string()), splits: v.optional(v.array(splitValidator)), paymentDate: v.string(), reference: v.optional(v.string()), notes: v.optional(v.string()) }, handler: async (ctx, args) => {
  const user = await requireActiveUser(ctx, "sales");
  const role = normalizeRole(user.role);
  if (role !== "cashier" && !(await isManagerRole(ctx, user))) throw new Error("Forbidden: cashier permission required to receive customer payments");
  const scope = await resolveWriteScope(ctx, user); const invoice = await ctx.db.get(args.invoiceId);
  if (!canAccessRecord(user, invoice) || !invoice || invoice.status !== "posted") throw new Error("Invoice haipatikani au haijapostiwa.");
  if (isOwnDataOnly(user) && invoice.createdBy !== user._id) throw new Error("Invoice haipatikani au haijapostiwa.");
  const { splits, total: amount } = await normaliseSplits(ctx, user, args.splits ?? [{ method: args.paymentMethod ?? "cash", amount: args.amount ?? NaN, reference: args.reference }]);
  if (amount <= 0 || amount > invoice.outstanding + 1e-8) throw new Error("Malipo lazima yawe zaidi ya sifuri na yasizidi deni.");
  const client = await ctx.db.get(invoice.clientId); if (!canAccessRecord(user, client)) throw new Error("Mteja hayupo kwenye branch yako.");
  const refs = splits.map((s) => s.reference).filter((r): r is string => !!r);
  if (new Set(refs).size !== refs.length) throw new Error("Reference moja imetumika mara mbili kwenye risiti hii.");
  if (refs.length) { const prior = await ctx.db.query("customerPayments").withIndex("by_client", q => q.eq("clientId", invoice.clientId)).collect(); if (prior.some(p => p.reference && refs.includes(p.reference) && p.tenantId === scope.tenantId && p.branchId === scope.branchId)) throw new Error("Reference ya malipo imeshatumika; ombi linalofanana limezuiwa."); }
  const receiptNo = `RC-${Date.now().toString(36).toUpperCase()}`;
  const receivable = await getSystemAccount(ctx, scope, "1100", "Accounts receivable", "asset");
  for (const s of splits) {
    const cash = await methodAccount(ctx, scope, { methodId: s.methodId, method: s.method }); // each method -> its own account
    const paymentId = await ctx.db.insert("customerPayments", { ...scope, paymentDate: args.paymentDate, clientId: invoice.clientId, invoiceId: args.invoiceId, amount: s.amount, paymentMethod: s.method, paymentMethodId: s.methodId, receiptNo, reference: s.reference, notes: args.notes, createdBy: user._id });
    await postSystemJournal(ctx, { scope, userId: user._id, date: args.paymentDate, reference: `PAY-${String(paymentId)}`, description: `Customer payment for ${invoice.invoiceNo} (${s.method})`, sourceType: "payment", sourceId: String(paymentId), lines: [{ accountId: cash, debit: s.amount, credit: 0, description: `Customer payment received - ${s.method}` }, { accountId: receivable, debit: 0, credit: s.amount, description: "Reduce customer receivable" }] });
  }
  const paid = money(invoice.amountPaid + amount), outstanding = money(invoice.total - paid);
  await ctx.db.patch(args.invoiceId, { amountPaid: paid, outstanding, paymentStatus: outstanding === 0 ? "paid" : "partial" });
  await bumpStats(ctx, { tenantId: invoice.tenantId, branchId: invoice.branchId }, { receivable: -amount, date: invoice.invoiceDate, collected: amount });
  return { amountPaid: paid, outstanding, receiptNo, amount, splits: splits.map((s) => ({ method: s.method, amount: s.amount })) };
} });


/**
 * One query that feeds every Sales screen/report (same pattern as purchasing.purchasingRegisters).
 * Revenue lines already carry the invoice-level discount share, so product/client/staff reports add up to the invoice totals.
 *
 * Scales with the SELECTED PERIOD, not with the age of the business:
 *  - invoices / payments are read through (tenant, date) indexes for the period only (at most REG_CAP of each; `truncated` tells the screen);
 *  - products, groups, units and suppliers are looked up only for the products that actually appear on the period's lines
 *    (so a stock change no longer re-runs this query for every open Sales screen);
 *  - customer balances = opening balance + still-unpaid invoices (index by outstanding), corrected for anything dated after the period.
 */
const REG_CAP = 1500;
const OPEN_CAP = 5000;
export const salesRegisters = query({
  args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "sales");
    const tenantId = user.tenantId;
    const inRange = (d: string) => (!a.startDate || d >= a.startDate) && (!a.endDate || d <= a.endDate);
    const between = (q: any, field: string) => { let r = q; if (a.startDate) r = r.gte(field, a.startDate); if (a.endDate) r = r.lte(field, a.endDate); return r; };

    const clients = tenantId ? filterScoped(user, await scopedRows(ctx, user, "clients")) : [];
    const invRaw: any[] = tenantId ? await ctx.db.query("invoices").withIndex("by_tenant_date", (q: any) => between(q.eq("tenantId", tenantId), "invoiceDate")).order("desc").take(REG_CAP + 1) : [];
    const payRaw: any[] = tenantId ? await ctx.db.query("customerPayments").withIndex("by_tenant_date", (q: any) => between(q.eq("tenantId", tenantId), "paymentDate")).order("desc").take(REG_CAP + 1) : [];
    const openRaw: any[] = tenantId ? await ctx.db.query("invoices").withIndex("by_tenant_outstanding", (q: any) => q.eq("tenantId", tenantId).gt("outstanding", 0)).take(OPEN_CAP + 1) : [];
    const afterInvRaw: any[] = tenantId && a.endDate ? await ctx.db.query("invoices").withIndex("by_tenant_date", (q: any) => q.eq("tenantId", tenantId).gt("invoiceDate", a.endDate)).take(REG_CAP + 1) : [];
    const afterPayRaw: any[] = tenantId && a.endDate ? await ctx.db.query("customerPayments").withIndex("by_tenant_date", (q: any) => q.eq("tenantId", tenantId).gt("paymentDate", a.endDate)).take(REG_CAP + 1) : [];
    const truncated = invRaw.length > REG_CAP || payRaw.length > REG_CAP || openRaw.length > OPEN_CAP || afterInvRaw.length > REG_CAP || afterPayRaw.length > REG_CAP;

    const posted = (rows: any[], cap: number) => mine(user, filterScoped(user, rows.slice(0, cap))).filter((i) => i.status === "posted");
    const invoices = posted(invRaw, REG_CAP).sort((x, y) => y.invoiceDate.localeCompare(x.invoiceDate) || y._creationTime - x._creationTime);
    const openInvoicesRaw = posted(openRaw, OPEN_CAP).filter((i) => i.outstanding > 0);
    const afterInvoices = posted(afterInvRaw, REG_CAP);
    const periodPayments = mine(user, filterScoped(user, payRaw.slice(0, REG_CAP)));
    const afterPayments = mine(user, filterScoped(user, afterPayRaw.slice(0, REG_CAP)));
    const clientName = new Map(clients.map((c) => [String(c._id), c.name]));

    // Small lookup cache: only the documents that really appear on the screen are read.
    const docs = new Map<string, any>();
    const getDoc = async (id: any) => { if (!id) return null; const k = String(id); if (!docs.has(k)) docs.set(k, await ctx.db.get(id)); return docs.get(k); };
    const staffCache = new Map<string, string>();
    const staffOf = async (id: any) => {
      if (!id) return "—"; const key = String(id); if (staffCache.has(key)) return staffCache.get(key)!;
      const u: any = await getDoc(id); const name = u?.name ?? u?.username ?? u?.email ?? "Mtumiaji"; staffCache.set(key, name); return name;
    };

    const invoiceRows = [] as Array<{ _id: any; invoiceNo: string; date: string; clientId: any; clientName: string; subtotal: number; discount: number; taxAmount: number; total: number; amountPaid: number; outstanding: number; paymentStatus: string; staff: string; source: string; notes: string }>;
    const lines = [] as Array<{ invoiceId: any; invoiceNo: string; date: string; clientId: any; clientName: string; staff: string; source: string; productId: any; itemCode: string; productName: string; groupName: string; unit: string; supplierName: string; qty: number; unitPrice: number; discount: number; net: number; cost: number; profit: number }>;
    for (const inv of invoices) {
      const staff = await staffOf(inv.salespersonId ?? inv.createdBy);
      invoiceRows.push({ _id: inv._id, invoiceNo: inv.invoiceNo, date: inv.invoiceDate, clientId: inv.clientId, clientName: clientName.get(String(inv.clientId)) ?? "Mteja", subtotal: inv.subtotal, discount: inv.discount, taxAmount: inv.taxAmount, total: inv.total, amountPaid: inv.amountPaid, outstanding: inv.outstanding, paymentStatus: inv.paymentStatus, staff, source: inv.salesSource ?? "—", notes: inv.notes ?? "" });
      const factor = inv.subtotal > 0 ? (inv.subtotal - inv.discount) / inv.subtotal : 1;
      for (const l of await ctx.db.query("invoiceLines").withIndex("by_invoice", q => q.eq("invoiceId", inv._id)).collect()) {
        const p = await getDoc(l.productId); const net = money(l.lineTotal * factor); const cost = money(l.qty * l.costAtSale);
        const group = p?.groupId ? await getDoc(p.groupId) : null; const unit = p?.unitId ? await getDoc(p.unitId) : null; const supplier = p?.lastSupplierId ? await getDoc(p.lastSupplierId) : null;
        lines.push({ invoiceId: inv._id, invoiceNo: inv.invoiceNo, date: inv.invoiceDate, clientId: inv.clientId, clientName: clientName.get(String(inv.clientId)) ?? "Mteja", staff, source: inv.salesSource ?? "—", productId: l.productId, itemCode: p?.itemCode ?? "—", productName: p?.name ?? "Bidhaa", groupName: p?.groupId ? group?.name ?? "—" : "—", unit: p?.unitId ? unit?.name ?? "Unit" : "Unit", supplierName: p?.lastSupplierId ? supplier?.name ?? "—" : "—", qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, net, cost, profit: money(net - cost) });
      }
    }

    const invNoCache = new Map<string, string>();
    for (const i of [...invoices, ...openInvoicesRaw]) invNoCache.set(String(i._id), i.invoiceNo);
    const payments = [] as Array<{ _id: any; date: string; clientId: any; clientName: string; invoiceNo: string; amount: number; method: string; reference: string; notes: string }>;
    for (const p of periodPayments.filter((x) => inRange(x.paymentDate)).sort((x, y) => y.paymentDate.localeCompare(x.paymentDate) || y._creationTime - x._creationTime)) {
      let invoiceNo = "—";
      if (p.invoiceId) { const k = String(p.invoiceId); if (!invNoCache.has(k)) invNoCache.set(k, ((await getDoc(p.invoiceId)) as { invoiceNo?: string } | null)?.invoiceNo ?? "—"); invoiceNo = invNoCache.get(k)!; }
      payments.push({ _id: p._id, date: p.paymentDate, clientId: p.clientId, clientName: clientName.get(String(p.clientId)) ?? "Mteja", invoiceNo, amount: p.amount, method: p.paymentMethod, reference: p.reference ?? "", notes: p.notes ?? "" });
    }

    // Client balances: opening balance + invoices - payments, split into before / inside the selected period.
    // Today's balance = opening + what is still unpaid; the period's closing = today's balance minus anything dated after the period.
    const sumBy = (rows: any[], f: (r: any) => number) => { const m = new Map<string, number>(); for (const r of rows) m.set(String(r.clientId), (m.get(String(r.clientId)) ?? 0) + f(r)); return m; };
    const unpaidBy = sumBy(openInvoicesRaw, (i) => i.outstanding);
    const afterBilledBy = sumBy(afterInvoices, (i) => i.total);
    const afterPaidBy = sumBy(afterPayments, (p) => p.amount);
    const billedBy = sumBy(invoices, (i) => i.total);
    const paidBy = sumBy(periodPayments.filter((p) => inRange(p.paymentDate)), (p) => p.amount);
    const balances = clients.map(c => {
      const k = String(c._id);
      const today = (c.openingBalance ?? 0) + (unpaidBy.get(k) ?? 0);
      const closing = money(today - (afterBilledBy.get(k) ?? 0) + (afterPaidBy.get(k) ?? 0));
      const billed = money(billedBy.get(k) ?? 0); const paid = money(paidBy.get(k) ?? 0);
      return { clientId: c._id, before: money(closing - billed + paid), billed, paid, closing };
    });

    return {
      clients: clients.map(c => ({ _id: c._id, code: c.code, name: c.name, phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", contactPerson: c.contactPerson ?? "", openingBalance: c.openingBalance, creditLimit: c.creditLimit ?? null, creditPolicy: c.creditPolicy, isActive: c.isActive })),
      invoices: invoiceRows, lines, payments, balances,
      openInvoices: openInvoicesRaw.sort((x, y) => x.invoiceDate.localeCompare(y.invoiceDate)).map(i => ({ _id: i._id, invoiceNo: i.invoiceNo, clientId: i.clientId, clientName: clientName.get(String(i.clientId)) ?? "Mteja", total: i.total, outstanding: i.outstanding, date: i.invoiceDate })),
      truncated,
      totals: { sales: money(invoices.reduce((n, i) => n + i.total, 0)), tax: money(invoices.reduce((n, i) => n + i.taxAmount, 0)), paid: money(invoices.reduce((n, i) => n + i.amountPaid, 0)), outstanding: money(invoices.reduce((n, i) => n + i.outstanding, 0)), payments: money(payments.reduce((n, p) => n + p.amount, 0)), invoices: invoices.length },
    };
  },
});
