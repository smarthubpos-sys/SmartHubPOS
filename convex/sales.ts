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
export const invoiceDetails = query({ args: { id: v.id("invoices") }, handler: async (ctx, { id }) => { const user = await requireActiveUser(ctx, "sales"); const invoice = await ctx.db.get("invoices", id); if (!canAccessRecord(user, invoice) || (isOwnDataOnly(user) && invoice?.createdBy !== user._id)) return null; return { invoice, lines: await ctx.db.query("invoiceLines").withIndex("by_invoice", q => q.eq("invoiceId", id)).collect() }; } });

export const createInvoice = mutation({
  args: { clientId: v.id("clients"), invoiceDate: v.string(), lines: v.array(lineValidator), discount: v.optional(v.number()), taxRate: v.optional(v.number()), paymentAmount: v.optional(v.number()), paymentMethod: v.optional(v.string()), paymentMethodId: v.optional(v.id("paymentMethods")), notes: v.optional(v.string()), salesSource: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireActiveUser(ctx, "sales"); const scope = await resolveWriteScope(ctx, user);
    if (!args.lines.length) throw new Error("Invoice lazima iwe na angalau bidhaa moja.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.invoiceDate)) throw new Error("Tarehe ya invoice si sahihi.");
    const client = await ctx.db.get("clients", args.clientId); if (!canAccessRecord(user, client)) throw new Error("Mteja hayupo kwenye ofisi/branch yako.");
    const company = await getCompanySettings(ctx, user);
    const allowNegativeStock = !!company?.allowNegativeStock;
    const invoicePrefix = (company?.invoicePrefix ?? "INV-") || "INV-";
    const requested = new Map<string, number>(); // same product on several lines must be checked together
    for (const line of args.lines) requested.set(String(line.productId), (requested.get(String(line.productId)) ?? 0) + (Number.isFinite(line.qty) ? line.qty : 0));
    const prepared: Array<{ productId: Id<"products">; qty: number; unitPrice: number; discount: number; lineTotal: number; cost: number }> = [];
    let subtotal = 0;
    for (const line of args.lines) {
      if (!Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) throw new Error("Kiasi au bei si sahihi.");
      const product = await ctx.db.get("products", line.productId); if (!product || !canAccessRecord(user, product) || !product.isActive) throw new Error("Bidhaa haipatikani kwenye branch hii.");
      if (!allowNegativeStock && product.currentQty + 1e-8 < (requested.get(String(line.productId)) ?? line.qty)) throw new Error(`Stock haitoshi kwa ${product.name}. Iliyopo: ${product.currentQty}, unayouza: ${requested.get(String(line.productId))}`);
      const discount = money(line.discount ?? 0); const gross = money(line.qty * line.unitPrice); if (discount < 0 || discount > gross) throw new Error("Discount si sahihi.");
      const lineTotal = money(gross - discount); subtotal += lineTotal; prepared.push({ productId: line.productId, qty: line.qty, unitPrice: line.unitPrice, discount, lineTotal, cost: product.weightedAvgCost ?? product.lastPurchaseCost ?? 0 });
    }
    subtotal = money(subtotal); const discount = money(args.discount ?? 0); if (discount < 0 || discount > subtotal) throw new Error("Discount ya invoice si sahihi.");
    const taxable = money(subtotal - discount); const taxRate = args.taxRate ?? 0; if (taxRate < 0 || taxRate > 100) throw new Error("Tax rate lazima iwe kati ya 0 na 100.");
    const taxAmount = money(taxable * taxRate / 100); const total = money(taxable + taxAmount); const paid = money(args.paymentAmount ?? 0); if (paid !== 0 && normalizeRole(user.role) !== "cashier" && !(await isManagerRole(ctx, user))) throw new Error("Malipo ya invoice yafanywe na cashier kupitia Cashier — Pokea Malipo."); if (paid < 0 || paid > total) throw new Error("Kiasi kilicholipwa si sahihi.");
    // Credit limit of the customer (Sales > Clients): what he already owes + this invoice's unpaid part must stay inside it.
    const newDebt = money(total - paid);
    let creditWarning = false;
    if (client && newDebt > 0 && client.creditPolicy !== "allow") {
      const limit = client.creditLimit ?? (client.creditPolicy === "block" ? 0 : null); // "block" with no limit = no credit at all
      if (limit !== null) {
        const open = (await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", args.clientId)).collect()).filter((i) => i.status === "posted" && i.outstanding > 0).reduce((n, i) => n + i.outstanding, 0);
        const exposure = money((client.openingBalance ?? 0) + open + newDebt);
        if (exposure > limit + 1e-8) {
          const info = `Deni la mteja lingekuwa ${exposure}, kikomo cha mkopo ni ${limit}.`;
          if (client.creditPolicy === "block") throw new Error(`Mteja amefikia kikomo cha mkopo. ${info} Lipa sehemu ya deni kwanza.`);
          if (client.creditPolicy === "require_approval" && !(await isManagerRole(ctx, user))) throw new Error(`Invoice hii inahitaji idhini ya meneja. ${info}`);
          creditWarning = true;
        }
      }
    }
    const initialPay = paid > 0 ? (await normaliseSplits(ctx, user, [{ method: args.paymentMethod ?? "cash", methodId: args.paymentMethodId, amount: paid }])).splits[0] : null;
    const seqRows = await ctx.db.query("salesSequences").withIndex("by_scope", q => scope.branchId ? q.eq("tenantId", scope.tenantId).eq("branchId", scope.branchId) : q.eq("tenantId", scope.tenantId)).collect();
    const sequence = seqRows.find(x => x.tenantId === scope.tenantId && x.branchId === scope.branchId);
    let nextNo = sequence?.nextNumber ?? 1;
    let invoiceNo = `${invoicePrefix}${String(nextNo).padStart(5, "0")}`;
    for (;;) { // never reuse a number that already exists in this office/branch
      const clash = (await ctx.db.query("invoices").withIndex("by_tenant_no", q => q.eq("tenantId", scope.tenantId).eq("invoiceNo", invoiceNo)).collect()).some(x => x.branchId === scope.branchId);
      if (!clash) break; nextNo++; invoiceNo = `${invoicePrefix}${String(nextNo).padStart(5, "0")}`;
    }
    if (sequence) await ctx.db.patch("salesSequences", sequence._id, { nextNumber: nextNo + 1 }); else await ctx.db.insert("salesSequences", { ...scope, nextNumber: nextNo + 1 });
    const invoiceId = await ctx.db.insert("invoices", { ...scope, invoiceNo, invoiceDate: args.invoiceDate, clientId: args.clientId, subtotal, discount, taxAmount, total, amountPaid: paid, outstanding: money(total-paid), paymentStatus: paid === total ? "paid" : paid > 0 ? "partial" : "unpaid", status: "posted", salespersonId: user._id, salesSource: args.salesSource, notes: args.notes, createdBy: user._id, postedAt: new Date().toISOString() });
    await bumpStats(ctx, scope, { receivable: money(total - paid), date: args.invoiceDate, sales: total, collected: paid, invoices: 1 });
    for (const line of prepared) {
      await ctx.db.insert("invoiceLines", { invoiceId, productId: line.productId, qty: line.qty, qtyStr: String(line.qty), unitPrice: line.unitPrice, unitPriceStr: String(line.unitPrice), lineTotal: line.lineTotal, lineTotalStr: String(line.lineTotal), costAtSale: line.cost, discount: line.discount });
      const product = await ctx.db.get("products", line.productId); if (!product) throw new Error("Bidhaa haipatikani."); const balance = product.currentQty - line.qty;
      await ctx.db.patch("products", line.productId, { currentQty: balance });
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
    return { invoiceId, invoiceNo, subtotal, taxAmount, total, amountPaid: paid, outstanding: money(total-paid), creditWarning };
  }
});

/**
 * Cancel a posted invoice made by mistake (managers only). Stock goes back, the sale and its cost are reversed in the ledger,
 * and any money already received on it is refunded from the SAME account(s) it was paid into. The invoice record is kept with status "cancelled"
 * (never deleted) and drops out of every Sales list, report, balance and total.
 */
export const voidInvoice = mutation({
  args: { invoiceId: v.id("invoices"), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "sales");
    if (!(await isManagerRole(ctx, user))) throw new Error("Forbidden: ni meneja pekee anayeweza kubatilisha invoice.");
    const invoice = await ctx.db.get("invoices", a.invoiceId);
    if (!invoice || !canAccessRecord(user, invoice)) throw new Error("Invoice haipatikani.");
    if (invoice.status !== "posted") throw new Error("Invoice hii tayari imebatilishwa.");
    if (invoice.total <= 0) throw new Error("Invoice hii imerudishwa yote kupitia marejesho; haihitaji kubatilishwa.");
    const scope = { tenantId: invoice.tenantId, branchId: invoice.branchId };
    const lines = await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", a.invoiceId)).collect();
    const payments = (await ctx.db.query("customerPayments").withIndex("by_invoice", (q) => q.eq("invoiceId", a.invoiceId)).collect()).filter((p) => !p.voided);
    const refunded = money(payments.reduce((n, p) => n + p.amount, 0));
    const today = new Date().toISOString().slice(0, 10);

    // 1. Stock back on the shelf, with a movement for the history.
    // Quantities already taken back by partial returns (returnItems) are already on the shelf: only the rest goes back now.
    const stillSold = (l: { qty: number; returnedQty?: number }) => Math.max(0, l.qty - (l.returnedQty ?? 0));
    for (const l of lines) {
      const qty = stillSold(l); if (qty <= 1e-8) continue;
      const product = await ctx.db.get("products", l.productId); if (!product) continue;
      const balance = product.currentQty + qty;
      await ctx.db.patch("products", l.productId, { currentQty: balance });
      await ctx.db.insert("stockMovements", { ...scope, movementDate: today, productId: l.productId, movementType: "sale_return", referenceId: String(a.invoiceId), referenceType: "invoice_void", qtyIn: qty, qtyOut: 0, runningBalance: balance, unitCost: l.costAtSale, clientId: invoice.clientId, notes: a.reason, createdBy: user._id });
    }

    // 2. Ledger: reverse revenue, tax and cost of goods; clear what was still owed; refund each payment to its own account.
    const receivable = await getSystemAccount(ctx, scope, "1100", "Accounts receivable", "asset");
    const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
    const taxPayable = await getSystemAccount(ctx, scope, "2150", "Tax payable", "liability");
    const revenue = await getSystemAccount(ctx, scope, "4000", "Sales revenue", "revenue");
    const cogs = await getSystemAccount(ctx, scope, "5000", "Cost of goods sold", "expense");
    const costTotal = roundMoney(lines.reduce((n, l) => n + stillSold(l) * l.costAtSale, 0));
    const stillOwed = money(invoice.total - refunded);
    const journalLines: Array<{ accountId: any; debit: number; credit: number; description: string }> = [
      { accountId: revenue, debit: money(invoice.total - invoice.taxAmount), credit: 0, description: "Sales revenue reversed" },
      { accountId: taxPayable, debit: invoice.taxAmount, credit: 0, description: "Tax reversed" },
      { accountId: inventory, debit: costTotal, credit: 0, description: "Inventory restored" },
      { accountId: cogs, debit: 0, credit: costTotal, description: "Cost of goods sold reversed" },
      { accountId: receivable, debit: 0, credit: stillOwed, description: "Customer receivable cleared" },
    ];
    // A payment row can be negative (a refund paid out by a partial return); it is put back on the account it left.
    for (const p of payments) journalLines.push({ accountId: await methodAccount(ctx, scope, { methodId: p.paymentMethodId, method: p.paymentMethod }), debit: p.amount < 0 ? -p.amount : 0, credit: p.amount > 0 ? p.amount : 0, description: `Refund to customer - ${p.paymentMethod}` });
    await postSystemJournal(ctx, { scope, userId: user._id, date: today, reference: `SALEVOID-${invoice.invoiceNo}`, description: `Cancelled invoice ${invoice.invoiceNo}${a.reason ? ` - ${a.reason}` : ""}`, sourceType: "sale_void", sourceId: String(a.invoiceId), lines: journalLines });

    // 3. Mark everything cancelled and keep the dashboard totals in step.
    for (const p of payments) await ctx.db.patch("customerPayments", p._id, { voided: true });
    await ctx.db.patch("invoices", a.invoiceId, { status: "cancelled", amountPaid: 0, outstanding: 0, paymentStatus: "cancelled", notes: [invoice.notes, `Imebatilishwa ${today}${a.reason ? `: ${a.reason}` : ""}`].filter(Boolean).join(" | ") });
    await bumpStats(ctx, scope, { receivable: -money(invoice.outstanding), date: invoice.invoiceDate, sales: -invoice.total, collected: -refunded, invoices: -1 });
    await ctx.db.insert("auditLogs", { userId: user._id, userName: user.name ?? user.email ?? "user", action: "void_invoice", module: "sales", referenceId: String(a.invoiceId), referenceType: "invoice", details: `Invoice ${invoice.invoiceNo} cancelled; total ${invoice.total}; refunded ${refunded}${a.reason ? `; ${a.reason}` : ""}`, timestamp: new Date().toISOString(), result: "success" });
    return { invoiceNo: invoice.invoiceNo, refunded };
  },
});

/**
 * Lines of one invoice with what can still be returned (sold - already returned), the net unit value and the invoice's money position.
 * Feeds the partial-return screen (Sales > Invoicing > "Rejesha bidhaa").
 */
export const returnableLines = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "sales");
    const invoice = await ctx.db.get("invoices", a.invoiceId);
    if (!invoice || !canAccessRecord(user, invoice) || (isOwnDataOnly(user) && invoice.createdBy !== user._id)) return null;
    const lines = await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", a.invoiceId)).collect();
    const factor = invoice.subtotal > 0 ? (invoice.subtotal - invoice.discount) / invoice.subtotal : 1;
    const out = [];
    for (const l of lines) {
      const p = await ctx.db.get("products", l.productId);
      const returned = l.returnedQty ?? 0;
      out.push({ _id: l._id, productName: p?.name ?? "Bidhaa", itemCode: p?.itemCode ?? "", qty: l.qty, returned, remaining: Math.max(0, l.qty - returned), unitNet: l.qty > 0 ? money((l.lineTotal / l.qty) * factor) : 0 });
    }
    const taxRate = invoice.subtotal - invoice.discount > 0 ? invoice.taxAmount / (invoice.subtotal - invoice.discount) : 0;
    return { invoiceNo: invoice.invoiceNo, status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid, outstanding: invoice.outstanding, taxRate, lines: out };
  },
});

/**
 * PARTIAL SALES RETURN (managers only): the customer brings back some of the goods of a posted invoice.
 *  - stock goes back for the returned quantities only (movement "sale_return");
 *  - the invoice shrinks by the value returned: what the customer still owed is reduced first, and only the rest is paid back
 *    (a negative customerPayments row, taken from the chosen payment method's own account);
 *  - ledger: Dr Sales returns (4100) + Dr Tax payable, Cr Receivable / Cr money account; Dr Inventory, Cr Cost of goods sold;
 *  - the sold quantity of every line is kept and `returnedQty` records what came back, so Sales reports count only what stayed sold.
 * A fully returned invoice stays in the records with total 0 (status "returned"); cancel it instead when the whole sale was a mistake.
 */
export const returnItems = mutation({
  args: {
    invoiceId: v.id("invoices"),
    lines: v.array(v.object({ invoiceLineId: v.id("invoiceLines"), qty: v.number() })),
    reason: v.optional(v.string()),
    returnDate: v.optional(v.string()),
    refundMethod: v.optional(v.string()),
    refundMethodId: v.optional(v.id("paymentMethods")),
  },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "sales");
    if (!(await isManagerRole(ctx, user))) throw new Error("Forbidden: ni meneja pekee anayeweza kupokea marejesho ya bidhaa.");
    const invoice = await ctx.db.get("invoices", a.invoiceId);
    if (!invoice || !canAccessRecord(user, invoice)) throw new Error("Invoice haipatikani.");
    if (invoice.status !== "posted") throw new Error("Invoice hii imebatilishwa; haiwezi kupokea marejesho.");
    const today = new Date().toISOString().slice(0, 10);
    const returnDate = a.returnDate ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) throw new Error("Tarehe ya marejesho si sahihi.");
    const wanted = a.lines.filter((l) => l.qty !== 0);
    if (!wanted.length) throw new Error("Weka kiasi cha angalau bidhaa moja inayorudishwa.");
    if (new Set(wanted.map((l) => String(l.invoiceLineId))).size !== wanted.length) throw new Error("Mstari mmoja umejirudia.");
    const scope = { tenantId: invoice.tenantId, branchId: invoice.branchId };
    const allLines = await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", a.invoiceId)).collect();
    const byId = new Map(allLines.map((l) => [String(l._id), l]));

    // 1. Validate quantities and price each returned line at what the customer really paid (line discount and invoice discount share removed).
    const factor = invoice.subtotal > 0 ? (invoice.subtotal - invoice.discount) / invoice.subtotal : 1;
    const picked: Array<{ line: typeof allLines[number]; qty: number; gross: number; net: number; cost: number }> = [];
    for (const w of wanted) {
      const line = byId.get(String(w.invoiceLineId));
      if (!line) throw new Error("Mstari huo si wa invoice hii.");
      if (!Number.isFinite(w.qty) || w.qty <= 0) throw new Error("Kiasi cha kurudisha lazima kiwe zaidi ya sifuri.");
      const remaining = line.qty - (line.returnedQty ?? 0);
      if (w.qty > remaining + 1e-8) throw new Error(`Huwezi kurudisha ${w.qty}; kilichobaki kurudishwa ni ${Math.max(0, remaining)}.`);
      const gross = money((w.qty / line.qty) * line.lineTotal);
      const net = money(gross * factor);
      picked.push({ line, qty: w.qty, gross, net, cost: roundMoney(w.qty * line.costAtSale) });
    }
    const fully = allLines.every((l) => { const p = picked.find((x) => x.line._id === l._id); return l.qty - (l.returnedQty ?? 0) - (p?.qty ?? 0) <= 1e-8; });
    // The last return clears the invoice exactly (no cent left behind by rounding).
    const grossReturned = fully ? invoice.subtotal : money(picked.reduce((n, x) => n + x.gross, 0));
    const discountReturned = fully ? invoice.discount : money(picked.reduce((n, x) => n + (x.gross - x.net), 0));
    const netReturned = money(grossReturned - discountReturned);
    const base = money(invoice.subtotal - invoice.discount);
    const taxReturned = fully ? invoice.taxAmount : base > 0 ? money(netReturned * invoice.taxAmount / base) : 0;
    const total = money(netReturned + taxReturned);
    const costReturned = roundMoney(picked.reduce((n, x) => n + x.cost, 0));
    if (total <= 0 && costReturned <= 0) throw new Error("Thamani ya marejesho ni sifuri.");

    // 2. What the customer still owes is reduced first; only the rest is paid back, from the method chosen for the refund.
    const credit = money(Math.min(invoice.outstanding, total));
    const refund = money(total - credit);
    if (refund > invoice.amountPaid + 1e-8) throw new Error("Kiasi cha kurudisha kimezidi kilichowahi kulipwa kwenye invoice hii.");
    const payout = refund > 0 ? (await normaliseSplits(ctx, user, [{ method: a.refundMethod ?? "cash", methodId: a.refundMethodId, amount: refund }])).splits[0] : null;

    // 3. Return record + number.
    const prior = (await ctx.db.query("salesReturns").withIndex("by_scope", (q) => q.eq("tenantId", scope.tenantId)).collect()).filter((r) => r.branchId === scope.branchId);
    const used = new Set(prior.map((r) => r.returnRef));
    let n = prior.length + 1; while (used.has(`SR-${String(n).padStart(5, "0")}`)) n++;
    const returnRef = `SR-${String(n).padStart(5, "0")}`;
    const returnId = await ctx.db.insert("salesReturns", { ...scope, returnDate, clientId: invoice.clientId, invoiceId: a.invoiceId, returnRef, total, subtotal: netReturned, taxAmount: taxReturned, creditedToDebt: credit, refunded: refund, refundMethod: payout?.method, reason: a.reason?.trim() || undefined, status: "posted", createdBy: user._id });

    // 4. Stock back on the shelf, line by line.
    for (const x of picked) {
      await ctx.db.insert("salesReturnLines", { returnId, invoiceLineId: x.line._id, productId: x.line.productId, qty: x.qty, value: x.net, cost: x.cost });
      await ctx.db.patch("invoiceLines", x.line._id, { returnedQty: (x.line.returnedQty ?? 0) + x.qty });
      const product = await ctx.db.get("products", x.line.productId); if (!product) continue;
      const balance = product.currentQty + x.qty;
      await ctx.db.patch("products", x.line.productId, { currentQty: balance });
      await ctx.db.insert("stockMovements", { ...scope, movementDate: returnDate, productId: x.line.productId, movementType: "sale_return", referenceId: String(returnId), referenceType: "sales_return", qtyIn: x.qty, qtyOut: 0, runningBalance: balance, unitCost: x.line.costAtSale, clientId: invoice.clientId, notes: a.reason, createdBy: user._id });
    }

    // 5. Ledger (rejects a closed period before anything is committed - the whole mutation rolls back).
    const receivable = await getSystemAccount(ctx, scope, "1100", "Accounts receivable", "asset");
    const inventory = await getSystemAccount(ctx, scope, "1200", "Inventory", "asset");
    const taxPayable = await getSystemAccount(ctx, scope, "2150", "Tax payable", "liability");
    const salesReturns = await getSystemAccount(ctx, scope, "4100", "Sales returns and allowances", "revenue");
    const cogs = await getSystemAccount(ctx, scope, "5000", "Cost of goods sold", "expense");
    const journalLines: Array<{ accountId: any; debit: number; credit: number; description: string }> = [
      { accountId: salesReturns, debit: netReturned, credit: 0, description: "Sales returned by customer" },
      { accountId: taxPayable, debit: taxReturned, credit: 0, description: "Tax on returned goods" },
      { accountId: receivable, debit: 0, credit: credit, description: "Customer receivable reduced" },
      { accountId: inventory, debit: costReturned, credit: 0, description: "Returned goods back in stock" },
      { accountId: cogs, debit: 0, credit: costReturned, description: "Cost of goods sold reversed" },
    ];
    if (payout) journalLines.push({ accountId: await methodAccount(ctx, scope, { methodId: payout.methodId, method: payout.method }), debit: 0, credit: refund, description: `Refund to customer - ${payout.method}` });
    await postSystemJournal(ctx, { scope, userId: user._id, date: returnDate, reference: `SALERET-${returnRef}`, description: `Partial return ${returnRef} of ${invoice.invoiceNo}${a.reason ? ` - ${a.reason}` : ""}`, sourceType: "sale_return", sourceId: String(returnId), lines: journalLines });

    // 6. The invoice shrinks by what came back; the refund is recorded as a negative payment so the customer statement stays right.
    if (payout) await ctx.db.insert("customerPayments", { ...scope, paymentDate: returnDate, clientId: invoice.clientId, invoiceId: a.invoiceId, amount: -refund, paymentMethod: payout.method, paymentMethodId: payout.methodId, receiptNo: returnRef, notes: `Refund - ${returnRef}`, createdBy: user._id });
    const subtotal = money(invoice.subtotal - grossReturned), discount = money(invoice.discount - discountReturned), taxAmount = money(invoice.taxAmount - taxReturned);
    const newTotal = money(subtotal - discount + taxAmount), amountPaid = money(invoice.amountPaid - refund), outstanding = money(invoice.outstanding - credit);
    await ctx.db.patch("invoices", a.invoiceId, { subtotal, discount, taxAmount, total: newTotal, amountPaid, outstanding, paymentStatus: newTotal <= 0 ? "returned" : outstanding <= 0 ? "paid" : amountPaid > 0 ? "partial" : "unpaid", notes: [invoice.notes, `Marejesho ${returnRef} ${returnDate}${a.reason ? `: ${a.reason}` : ""}`].filter(Boolean).join(" | ") });
    await bumpStats(ctx, scope, { receivable: -credit, date: invoice.invoiceDate, sales: -total, collected: -refund });
    await ctx.db.insert("auditLogs", { userId: user._id, userName: user.name ?? user.email ?? "user", action: "sales_return", module: "sales", referenceId: String(returnId), referenceType: "salesReturn", details: `${returnRef} on ${invoice.invoiceNo}; value ${total}; debt reduced ${credit}; refunded ${refund}`, timestamp: new Date().toISOString(), result: "success" });
    return { returnRef, total, creditedToDebt: credit, refunded: refund, invoiceTotal: newTotal, fullyReturned: newTotal <= 0 };
  },
});

/**
 * Receive a customer payment on one invoice. One receipt may be split over several methods, e.g. a customer who owes
 * 30,000 pays 10,000 by phone + 10,000 by bank + 10,000 cash: pass `splits`. (`amount` + `paymentMethod` still work for a single method.)
 */
export const recordPayment = mutation({ args: { invoiceId: v.id("invoices"), amount: v.optional(v.number()), paymentMethod: v.optional(v.string()), splits: v.optional(v.array(splitValidator)), paymentDate: v.string(), reference: v.optional(v.string()), notes: v.optional(v.string()) }, handler: async (ctx, args) => {
  const user = await requireActiveUser(ctx, "sales");
  const role = normalizeRole(user.role);
  if (role !== "cashier" && !(await isManagerRole(ctx, user))) throw new Error("Forbidden: cashier permission required to receive customer payments");
  const scope = await resolveWriteScope(ctx, user); const invoice = await ctx.db.get("invoices", args.invoiceId);
  if (!canAccessRecord(user, invoice) || !invoice || invoice.status !== "posted") throw new Error("Invoice haipatikani au haijapostiwa.");
  if (isOwnDataOnly(user) && invoice.createdBy !== user._id) throw new Error("Invoice haipatikani au haijapostiwa.");
  const { splits, total: amount } = await normaliseSplits(ctx, user, args.splits ?? [{ method: args.paymentMethod ?? "cash", amount: args.amount ?? NaN, reference: args.reference }]);
  if (amount <= 0 || amount > invoice.outstanding + 1e-8) throw new Error("Malipo lazima yawe zaidi ya sifuri na yasizidi deni.");
  const client = await ctx.db.get("clients", invoice.clientId); if (!canAccessRecord(user, client)) throw new Error("Mteja hayupo kwenye branch yako.");
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
  await ctx.db.patch("invoices", args.invoiceId, { amountPaid: paid, outstanding, paymentStatus: outstanding === 0 ? "paid" : "partial" });
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
  args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()), withLines: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const user = await requireActiveUser(ctx, "sales");
    const tenantId = user.tenantId;
    // Only product-level reports need the invoice lines; every other screen skips reading them (much faster).
    const wantLines = a.withLines !== false;
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
    const periodPayments = mine(user, filterScoped(user, payRaw.slice(0, REG_CAP))).filter((p) => !p.voided);
    const afterPayments = mine(user, filterScoped(user, afterPayRaw.slice(0, REG_CAP))).filter((p) => !p.voided);
    const clientName = new Map(clients.map((c) => [String(c._id), c.name]));

    // Small lookup cache: only the documents that really appear on the screen are read.
    const docs = new Map<string, unknown>();
    const memo = async <D,>(key: string, load: () => Promise<D | null>): Promise<D | null> => { if (!docs.has(key)) docs.set(key, await load()); return docs.get(key) as D | null; };
    const getUser = async (id: Id<"users"> | null | undefined) => (id ? memo(`users:${id}`, () => ctx.db.get("users", id)) : null);
    const getProduct = async (id: Id<"products"> | null | undefined) => (id ? memo(`products:${id}`, () => ctx.db.get("products", id)) : null);
    const getGroup = async (id: Id<"productGroups"> | null | undefined) => (id ? memo(`productGroups:${id}`, () => ctx.db.get("productGroups", id)) : null);
    const getUnit = async (id: Id<"unitsOfMeasure"> | null | undefined) => (id ? memo(`unitsOfMeasure:${id}`, () => ctx.db.get("unitsOfMeasure", id)) : null);
    const getSupplier = async (id: Id<"suppliers"> | null | undefined) => (id ? memo(`suppliers:${id}`, () => ctx.db.get("suppliers", id)) : null);
    const getInvoice = async (id: Id<"invoices"> | null | undefined) => (id ? memo(`invoices:${id}`, () => ctx.db.get("invoices", id)) : null);
    const staffCache = new Map<string, string>();
    const staffOf = async (id: Id<"users"> | null | undefined) => {
      if (!id) return "—"; const key = String(id); if (staffCache.has(key)) return staffCache.get(key)!;
      const u = await getUser(id); const name = u?.name ?? u?.username ?? u?.email ?? "Mtumiaji"; staffCache.set(key, name); return name;
    };

    const invoiceRows = [] as Array<{ _id: any; invoiceNo: string; date: string; clientId: any; clientName: string; subtotal: number; discount: number; taxAmount: number; total: number; amountPaid: number; outstanding: number; paymentStatus: string; staff: string; source: string; notes: string }>;
    const lines = [] as Array<{ invoiceId: any; invoiceNo: string; date: string; clientId: any; clientName: string; staff: string; source: string; productId: any; itemCode: string; productName: string; groupName: string; unit: string; supplierName: string; qty: number; unitPrice: number; discount: number; net: number; cost: number; profit: number }>;
    for (const inv of invoices) {
      const staff = await staffOf(inv.salespersonId ?? inv.createdBy);
      invoiceRows.push({ _id: inv._id, invoiceNo: inv.invoiceNo, date: inv.invoiceDate, clientId: inv.clientId, clientName: clientName.get(String(inv.clientId)) ?? "Mteja", subtotal: inv.subtotal, discount: inv.discount, taxAmount: inv.taxAmount, total: inv.total, amountPaid: inv.amountPaid, outstanding: inv.outstanding, paymentStatus: inv.paymentStatus, staff, source: inv.salesSource ?? "—", notes: inv.notes ?? "" });
      if (!wantLines) continue;
      const factor = inv.subtotal > 0 ? (inv.subtotal - inv.discount) / inv.subtotal : 1;
      for (const l of await ctx.db.query("invoiceLines").withIndex("by_invoice", q => q.eq("invoiceId", inv._id)).collect()) {
        // Partial returns keep the sold quantity on the line; reports see only what stayed sold.
        const keptQty = Math.max(0, l.qty - (l.returnedQty ?? 0)); if (keptQty <= 1e-8) continue;
        const keep = l.qty > 0 ? keptQty / l.qty : 1;
        const p = await getProduct(l.productId); const net = money(l.lineTotal * keep * factor); const cost = money(keptQty * l.costAtSale);
        const group = await getGroup(p?.groupId); const unit = await getUnit(p?.unitId); const supplier = await getSupplier(p?.lastSupplierId);
        lines.push({ invoiceId: inv._id, invoiceNo: inv.invoiceNo, date: inv.invoiceDate, clientId: inv.clientId, clientName: clientName.get(String(inv.clientId)) ?? "Mteja", staff, source: inv.salesSource ?? "—", productId: l.productId, itemCode: p?.itemCode ?? "—", productName: p?.name ?? "Bidhaa", groupName: p?.groupId ? group?.name ?? "—" : "—", unit: p?.unitId ? unit?.name ?? "Unit" : "Unit", supplierName: p?.lastSupplierId ? supplier?.name ?? "—" : "—", qty: keptQty, unitPrice: l.unitPrice, discount: money(l.discount * keep), net, cost, profit: money(net - cost) });
      }
    }

    const invNoCache = new Map<string, string>();
    for (const i of [...invoices, ...openInvoicesRaw]) invNoCache.set(String(i._id), i.invoiceNo);
    const payments = [] as Array<{ _id: any; date: string; clientId: any; clientName: string; invoiceNo: string; amount: number; method: string; reference: string; notes: string }>;
    for (const p of periodPayments.filter((x) => inRange(x.paymentDate)).sort((x, y) => y.paymentDate.localeCompare(x.paymentDate) || y._creationTime - x._creationTime)) {
      let invoiceNo = "—";
      if (p.invoiceId) { const k = String(p.invoiceId); if (!invNoCache.has(k)) invNoCache.set(k, (await getInvoice(p.invoiceId))?.invoiceNo ?? "—"); invoiceNo = invNoCache.get(k)!; }
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

    const companyRow = await getCompanySettings(ctx, user);
    return {
      company: { name: companyRow?.companyName ?? "", address: companyRow?.address ?? "", phone: companyRow?.phone ?? "", currencySymbol: companyRow?.currencySymbol ?? "TSh", decimalPlaces: companyRow?.decimalPlaces ?? 0 },
      clients: clients.map(c => ({ _id: c._id, code: c.code, name: c.name, phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", contactPerson: c.contactPerson ?? "", openingBalance: c.openingBalance, creditLimit: c.creditLimit ?? null, creditPolicy: c.creditPolicy, isActive: c.isActive })),
      invoices: invoiceRows, lines, payments, balances,
      openInvoices: openInvoicesRaw.sort((x, y) => x.invoiceDate.localeCompare(y.invoiceDate)).map(i => ({ _id: i._id, invoiceNo: i.invoiceNo, clientId: i.clientId, clientName: clientName.get(String(i.clientId)) ?? "Mteja", total: i.total, outstanding: i.outstanding, date: i.invoiceDate })),
      truncated,
      totals: { sales: money(invoices.reduce((n, i) => n + i.total, 0)), tax: money(invoices.reduce((n, i) => n + i.taxAmount, 0)), paid: money(invoices.reduce((n, i) => n + i.amountPaid, 0)), outstanding: money(invoices.reduce((n, i) => n + i.outstanding, 0)), payments: money(payments.reduce((n, p) => n + p.amount, 0)), invoices: invoices.length },
    };
  },
});
