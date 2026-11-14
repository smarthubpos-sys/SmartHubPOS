import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { canAccessRecord, filterScoped, logAudit, requireActiveUser, requireManager, resolveWriteScope, scopedRows, requirePermission } from "./access";
import { getSystemAccount, methodAccount, postSystemJournal, roundMoney } from "./ledger";
import { normaliseSplits } from "./paymentMethods";

export const EXPENSE: Record<string, { code: string; name: string }> = {
  rent: { code: "6100", name: "Rent expense" },
  electricity: { code: "6110", name: "Utilities expense" },
  water: { code: "6110", name: "Utilities expense" },
  internet: { code: "6110", name: "Utilities expense" },
  tax: { code: "6120", name: "Taxes and licenses" },
  transport: { code: "6130", name: "Transport expense" },
  other: { code: "6190", name: "Other bills expense" },
};
const PAY: Record<string, { code: string; name: string }> = {
  cash: { code: "1000", name: "Cash and equivalents" },
  bank: { code: "1010", name: "Bank" },
  mobile: { code: "1020", name: "Mobile money" },
};
const today = () => new Date().toISOString().slice(0, 10);

const cleanName = (s: string) => s.trim().replace(/\s+/g, " ");

/** The expense account a category posts to: a built-in type uses its own account; a type the business wrote itself posts to "Other bills expense" and keeps its own name on every bill. */
async function expenseAccountFor(ctx: QueryCtx, tenantId: Id<"tenants"> | undefined, category: string) {
  if (EXPENSE[category]) return EXPENSE[category];
  const mine = await ctx.db.query("expenseCategories").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
  if (mine.some((c) => c.name.toLowerCase() === category.toLowerCase())) return EXPENSE.other;
  throw new ConvexError("Aina ya bili si sahihi.");
}

/** The business's own expense types (the built-in ones are fixed in the app). */
export const categories = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "accounts.view", "accounts");
    if (!user.tenantId) return [];
    const rows = await ctx.db.query("expenseCategories").withIndex("by_tenant", (q) => q.eq("tenantId", user.tenantId)).collect();
    return rows.map((r) => ({ _id: r._id, name: r.name })).sort((x, y) => x.name.localeCompare(y.name));
  },
});

export const addCategory = mutation({
  args: { name: v.string() },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "accounts");
    const scope = await resolveWriteScope(ctx, user);
    if (!scope.tenantId) throw new ConvexError("Chagua biashara kwanza.");
    const name = cleanName(a.name);
    if (name.length < 2 || name.length > 40) throw new ConvexError("Jina la aina liwe herufi 2 hadi 40.");
    if (EXPENSE[name.toLowerCase()]) throw new ConvexError("Aina hii tayari ipo kwenye orodha ya kawaida.");
    const mine = await ctx.db.query("expenseCategories").withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId)).collect();
    const same = mine.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (same) return same.name;
    const id = await ctx.db.insert("expenseCategories", { tenantId: scope.tenantId, name, createdBy: user._id });
    await logAudit(ctx, user, { action: "add_expense_category", module: "accounts", referenceId: String(id), details: name });
    return name;
  },
});

/** Removes a type from the dropdown. Bills already saved keep their text, so nothing in the books changes. */
export const removeCategory = mutation({
  args: { categoryId: v.id("expenseCategories") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "accounts");
    const row = await ctx.db.get("expenseCategories", a.categoryId);
    if (!row || row.tenantId !== user.tenantId) throw new ConvexError("Aina haipatikani.");
    await ctx.db.delete("expenseCategories", a.categoryId);
    await logAudit(ctx, user, { action: "remove_expense_category", module: "accounts", referenceId: String(a.categoryId), details: row.name });
    return a.categoryId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requirePermission(ctx, "accounts.view", "accounts");
    return (await scopedRows(ctx, user, "bills")).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  },
});

export const payments = query({
  args: { billId: v.id("bills") },
  handler: async (ctx, a) => {
    const user = await requirePermission(ctx, "accounts.view", "accounts");
    const bill = await ctx.db.get("bills", a.billId);
    if (!bill || !canAccessRecord(user, bill)) return [];
    return (await ctx.db.query("billPayments").withIndex("by_bill", (q) => q.eq("billId", a.billId)).collect()).sort((x, y) => y.paymentDate.localeCompare(x.paymentDate));
  },
});

export const create = mutation({
  args: { vendor: v.string(), category: v.string(), billNumber: v.optional(v.string()), billDate: v.string(), dueDate: v.string(), amount: v.number(), notes: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "accounts");
    const scope = await resolveWriteScope(ctx, user);
    const exp = await expenseAccountFor(ctx, scope.tenantId, a.category);
    if (!a.vendor.trim()) throw new ConvexError("Jina la mtoa huduma linahitajika.");
    if (!Number.isFinite(a.amount) || a.amount <= 0) throw new ConvexError("Kiasi lazima kiwe zaidi ya sifuri.");
    if (a.dueDate < a.billDate) throw new ConvexError("Tarehe ya mwisho lazima iwe baada ya tarehe ya bili.");
    const existing = (await scopedRows(ctx, user, "bills"));
    const next = existing.reduce((m, b) => { const x = /^BILL-(\d+)$/.exec(b.billNumber); return x ? Math.max(m, Number(x[1])) : m; }, 0) + 1;
    const billNumber = a.billNumber?.trim() || `BILL-${String(next).padStart(4, "0")}`;
    if (existing.some((b) => b.billNumber === billNumber && b.status !== "void")) throw new ConvexError("Namba ya bili imeshatumika.");
    const amount = roundMoney(a.amount);
    const id = await ctx.db.insert("bills", { ...scope, billNumber, vendor: a.vendor.trim(), category: a.category, billDate: a.billDate, dueDate: a.dueDate, amount, paidAmount: 0, status: "unpaid", notes: a.notes, createdBy: user._id });
    const expense = await getSystemAccount(ctx, scope, exp.code, exp.name, "expense");
    const payable = await getSystemAccount(ctx, scope, "2100", "Accounts payable - bills", "liability");
    await postSystemJournal(ctx, { scope, userId: user._id, date: a.billDate, reference: `BILL-${String(id)}`, description: `Bill ${billNumber}: ${a.vendor.trim()}`, sourceType: "bill", sourceId: String(id), lines: [{ accountId: expense, debit: amount, credit: 0, description: a.category }, { accountId: payable, debit: 0, credit: amount, description: a.vendor.trim() }] });
    await logAudit(ctx, user, { action: "create_bill", module: "bills", referenceId: String(id), details: `${billNumber} ${amount}` });
    return id;
  },
});

export const pay = mutation({
  args: { billId: v.id("bills"), amount: v.number(), method: v.string(), methodId: v.optional(v.id("paymentMethods")), paymentDate: v.string(), reference: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "accounts");
    const bill = await ctx.db.get("bills", a.billId);
    if (!bill || !canAccessRecord(user, bill)) throw new ConvexError("Bili haipatikani.");
    if (bill.status === "void") throw new ConvexError("Bili hii imebatilishwa.");
    if (!a.methodId && !PAY[a.method]) throw new ConvexError("Njia ya malipo si sahihi.");
    const chosen = a.methodId ? (await normaliseSplits(ctx, user, [{ method: a.method, methodId: a.methodId, amount: 1 }])).splits[0] : null; // validates the method belongs to this business and is active
    const outstanding = roundMoney(bill.amount - bill.paidAmount);
    const amount = roundMoney(a.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) throw new ConvexError("Malipo lazima yawe zaidi ya sifuri na yasizidi deni.");
    const scope = { tenantId: bill.tenantId, branchId: bill.branchId };
    const paymentId = await ctx.db.insert("billPayments", { ...scope, billId: a.billId, paymentDate: a.paymentDate, amount, method: chosen?.method ?? a.method, methodId: chosen?.methodId, reference: a.reference, createdBy: user._id });
    const paid = roundMoney(bill.paidAmount + amount);
    await ctx.db.patch("bills", a.billId, { paidAmount: paid, status: paid >= bill.amount ? "paid" : "partial" });
    const payable = await getSystemAccount(ctx, scope, "2100", "Accounts payable - bills", "liability");
    const cash = await methodAccount(ctx, scope, { methodId: chosen?.methodId, method: a.method }); // paid out of the chosen method's own account
    await postSystemJournal(ctx, { scope, userId: user._id, date: a.paymentDate, reference: `BILLPAY-${String(paymentId)}`, description: `Bill payment ${bill.billNumber}`, sourceType: "bill_payment", sourceId: String(paymentId), lines: [{ accountId: payable, debit: amount, credit: 0 }, { accountId: cash, debit: 0, credit: amount }] });
    await logAudit(ctx, user, { action: "pay_bill", module: "bills", referenceId: String(a.billId), details: `${bill.billNumber} ${amount}` });
    return paymentId;
  },
});

export const voidBill = mutation({
  args: { billId: v.id("bills") },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "accounts");
    const bill = await ctx.db.get("bills", a.billId);
    if (!bill || !canAccessRecord(user, bill)) throw new ConvexError("Bili haipatikani.");
    if (bill.paidAmount > 0) throw new ConvexError("Bili iliyolipwa kiasi haiwezi kubatilishwa.");
    if (bill.status === "void") return a.billId;
    const scope = { tenantId: bill.tenantId, branchId: bill.branchId };
    const exp = EXPENSE[bill.category] ?? EXPENSE.other;
    const expense = await getSystemAccount(ctx, scope, exp.code, exp.name, "expense");
    const payable = await getSystemAccount(ctx, scope, "2100", "Accounts payable - bills", "liability");
    await postSystemJournal(ctx, { scope, userId: user._id, date: today(), reference: `BILLVOID-${String(a.billId)}`, description: `Void bill ${bill.billNumber}`, sourceType: "bill_void", sourceId: String(a.billId), lines: [{ accountId: payable, debit: bill.amount, credit: 0 }, { accountId: expense, debit: 0, credit: bill.amount }] });
    await ctx.db.patch("bills", a.billId, { status: "void" });
    await logAudit(ctx, user, { action: "void_bill", module: "bills", referenceId: String(a.billId), details: bill.billNumber });
    return a.billId;
  },
});

/** Edit a bill. Money rules: the amount can never go below what is already paid; when the amount or the expense account changes, one correcting journal is posted (old entry reversed, new one booked), dated today like a void. */
export const update = mutation({
  args: { billId: v.id("bills"), vendor: v.string(), category: v.string(), billNumber: v.optional(v.string()), billDate: v.string(), dueDate: v.string(), amount: v.number(), notes: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "accounts");
    const bill = await ctx.db.get("bills", a.billId);
    if (!bill || !canAccessRecord(user, bill)) throw new ConvexError("Bili haipatikani.");
    if (bill.status === "void") throw new ConvexError("Bili iliyobatilishwa haiwezi kuhaririwa.");
    const scope = { tenantId: bill.tenantId, branchId: bill.branchId };
    const oldExp = EXPENSE[bill.category] ?? EXPENSE.other;
    const exp = a.category === bill.category ? oldExp : await expenseAccountFor(ctx, bill.tenantId, a.category);
    if (!a.vendor.trim()) throw new ConvexError("Jina la mtoa huduma linahitajika.");
    if (!Number.isFinite(a.amount) || a.amount <= 0) throw new ConvexError("Kiasi lazima kiwe zaidi ya sifuri.");
    if (a.dueDate < a.billDate) throw new ConvexError("Tarehe ya mwisho lazima iwe baada ya tarehe ya bili.");
    const amount = roundMoney(a.amount);
    if (amount < bill.paidAmount) throw new ConvexError(`Kiasi hakiwezi kuwa chini ya kilicholipwa tayari (${bill.paidAmount}).`);
    const billNumber = a.billNumber?.trim() || bill.billNumber;
    const others = await scopedRows(ctx, user, "bills");
    if (others.some((b) => b._id !== bill._id && b.billNumber === billNumber && b.status !== "void")) throw new ConvexError("Namba ya bili imeshatumika.");
    const paid = bill.paidAmount;
    await ctx.db.patch("bills", bill._id, { vendor: a.vendor.trim(), category: a.category, billNumber, billDate: a.billDate, dueDate: a.dueDate, amount, notes: a.notes, status: paid >= amount ? "paid" : paid > 0 ? "partial" : "unpaid" });
    if (amount !== bill.amount || exp.code !== oldExp.code) {
      const payable = await getSystemAccount(ctx, scope, "2100", "Accounts payable - bills", "liability");
      const oldAcc = await getSystemAccount(ctx, scope, oldExp.code, oldExp.name, "expense");
      const newAcc = await getSystemAccount(ctx, scope, exp.code, exp.name, "expense");
      await postSystemJournal(ctx, {
        scope, userId: user._id, date: today(), reference: `BILLEDIT-${String(bill._id)}-${Date.now().toString(36)}`, description: `Edit bill ${billNumber}`, sourceType: "bill_edit", sourceId: `${String(bill._id)}-${Date.now()}`,
        lines: [
          { accountId: payable, debit: bill.amount, credit: 0, description: "Reverse old amount" }, { accountId: oldAcc, debit: 0, credit: bill.amount, description: "Reverse old amount" },
          { accountId: newAcc, debit: amount, credit: 0, description: "New amount" }, { accountId: payable, debit: 0, credit: amount, description: "New amount" },
        ],
      });
    }
    await logAudit(ctx, user, { action: "edit_bill", module: "bills", referenceId: String(bill._id), details: `${billNumber} ${bill.amount} -> ${amount}` });
    return bill._id;
  },
});
