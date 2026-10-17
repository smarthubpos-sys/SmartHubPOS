import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { canAccessRecord, filterScoped, logAudit, requireActiveUser, requireManager, resolveWriteScope, scopedRows, requirePermission } from "./access";
import { getSystemAccount, methodAccount, postSystemJournal, roundMoney } from "./ledger";
import { normaliseSplits } from "./paymentMethods";

const EXPENSE: Record<string, { code: string; name: string }> = {
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
    const exp = EXPENSE[a.category];
    if (!exp) throw new Error("Aina ya bili si sahihi.");
    if (!a.vendor.trim()) throw new Error("Jina la mtoa huduma linahitajika.");
    if (!Number.isFinite(a.amount) || a.amount <= 0) throw new Error("Kiasi lazima kiwe zaidi ya sifuri.");
    if (a.dueDate < a.billDate) throw new Error("Tarehe ya mwisho lazima iwe baada ya tarehe ya bili.");
    const existing = (await scopedRows(ctx, user, "bills"));
    const next = existing.reduce((m, b) => { const x = /^BILL-(\d+)$/.exec(b.billNumber); return x ? Math.max(m, Number(x[1])) : m; }, 0) + 1;
    const billNumber = a.billNumber?.trim() || `BILL-${String(next).padStart(4, "0")}`;
    if (existing.some((b) => b.billNumber === billNumber && b.status !== "void")) throw new Error("Namba ya bili imeshatumika.");
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
    if (!bill || !canAccessRecord(user, bill)) throw new Error("Bili haipatikani.");
    if (bill.status === "void") throw new Error("Bili hii imebatilishwa.");
    if (!a.methodId && !PAY[a.method]) throw new Error("Njia ya malipo si sahihi.");
    const chosen = a.methodId ? (await normaliseSplits(ctx, user, [{ method: a.method, methodId: a.methodId, amount: 1 }])).splits[0] : null; // validates the method belongs to this business and is active
    const outstanding = roundMoney(bill.amount - bill.paidAmount);
    const amount = roundMoney(a.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) throw new Error("Malipo lazima yawe zaidi ya sifuri na yasizidi deni.");
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
    if (!bill || !canAccessRecord(user, bill)) throw new Error("Bili haipatikani.");
    if (bill.paidAmount > 0) throw new Error("Bili iliyolipwa kiasi haiwezi kubatilishwa.");
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
