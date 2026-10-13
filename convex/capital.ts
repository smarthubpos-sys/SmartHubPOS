import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { filterScoped, logAudit, requireActiveUser, requireManager, resolveWriteScope, scopedRows } from "./access";
import { getSystemAccount, methodAccount, postSystemJournal, roundMoney } from "./ledger";
import { normaliseSplits } from "./paymentMethods";

/**
 * Where did the money come from? Each source maps to the right ledger account:
 * owner / director / shareholder money and grants are EQUITY; bank, director and other loans are LIABILITIES.
 */
export const SOURCES: Record<string, { code: string; name: string; type: "equity" | "liability" }> = {
  owner_capital: { code: "3100", name: "Owner's capital", type: "equity" },
  director_capital: { code: "3200", name: "Directors' capital", type: "equity" },
  shareholder: { code: "3300", name: "Shareholders' capital", type: "equity" },
  grant: { code: "3400", name: "Grants and donations", type: "equity" },
  other: { code: "3500", name: "Other capital contributions", type: "equity" },
  bank_loan: { code: "2500", name: "Bank loans", type: "liability" },
  director_loan: { code: "2510", name: "Director loans", type: "liability" },
  other_loan: { code: "2520", name: "Other loans", type: "liability" },
};
const DEPOSIT: Record<string, { code: string; name: string }> = {
  cash: { code: "1000", name: "Cash and equivalents" },
  bank: { code: "1010", name: "Bank" },
  mobile: { code: "1020", name: "Mobile money" },
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx, "accounts");
    return (await scopedRows(ctx, user, "capitalReceipts")).sort((a, b) => b.receiptDate.localeCompare(a.receiptDate) || b._creationTime - a._creationTime);
  },
});

export const receive = mutation({
  args: {
    receiptDate: v.string(),
    amount: v.number(),
    sourceType: v.string(),
    sourceName: v.string(),
    depositMethod: v.string(),
    depositMethodId: v.optional(v.id("paymentMethods")),
    reference: v.optional(v.string()),
    interestRate: v.optional(v.number()),
    termMonths: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const user = await requireManager(ctx, "accounts");
    const scope = await resolveWriteScope(ctx, user);
    const source = SOURCES[a.sourceType];
    if (!source) throw new Error("Chanzo cha mtaji si sahihi.");
    if (!a.depositMethodId && !DEPOSIT[a.depositMethod]) throw new Error("Njia ya kuweka fedha si sahihi.");
    const chosen = a.depositMethodId ? (await normaliseSplits(ctx, user, [{ method: a.depositMethod, methodId: a.depositMethodId, amount: 1 }])).splits[0] : null;
    if (!Number.isFinite(a.amount) || a.amount <= 0) throw new Error("Kiasi lazima kiwe zaidi ya sifuri.");
    if (!a.sourceName.trim()) throw new Error("Andika mtaji umetoka kwa nani au wapi.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.receiptDate)) throw new Error("Tarehe si sahihi.");
    for (const n of [a.interestRate, a.termMonths]) if (n !== undefined && (!Number.isFinite(n) || n < 0)) throw new Error("Riba au muda si sahihi.");
    const amount = roundMoney(a.amount);
    const id = await ctx.db.insert("capitalReceipts", { ...scope, ...a, depositMethod: chosen?.method ?? a.depositMethod, sourceName: a.sourceName.trim(), amount, createdBy: user._id });
    const dep = await methodAccount(ctx, scope, { methodId: chosen?.methodId, method: a.depositMethod }); // funds go into the chosen method's own account
    const src = await getSystemAccount(ctx, scope, source.code, source.name, source.type);
    const journalId = await postSystemJournal(ctx, {
      scope, userId: user._id, date: a.receiptDate, reference: `CAP-${String(id)}`,
      description: `Capital received: ${source.name} - ${a.sourceName.trim()}`, sourceType: "capital", sourceId: String(id),
      lines: [{ accountId: dep, debit: amount, credit: 0, description: "Funds received" }, { accountId: src, debit: 0, credit: amount, description: a.sourceName.trim() }],
    });
    await ctx.db.patch(id, { journalId });
    await logAudit(ctx, user, { action: "receive_capital", module: "accounts", referenceId: String(id), details: `${a.sourceType} ${amount} (${a.sourceName.trim()})` });
    return id;
  },
});
