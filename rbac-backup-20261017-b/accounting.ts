import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { UserLike } from "./access";
import { canAccessRecord, filterScoped, requireActiveUser, resolveWriteScope, requireManager, scopedRows, requirePermission } from "./access";
import { roundMoney } from "./ledger";
/**
 * Posted journal entries of the user's scope inside a date range, read through the date indexes (never the whole table),
 * and the lines of exactly those entries. Reports therefore scale with the period asked for.
 */
async function postedEntries(ctx: QueryCtx, u: UserLike, from?: string, to?: string): Promise<Doc<"journalEntries">[]> {
  let rows: Doc<"journalEntries">[];
  if (u.tenantId) {
    const t = u.tenantId;
    rows = u.branchId
      ? await ctx.db.query("journalEntries").withIndex("by_scope_date", (q) => { const b = q.eq("tenantId", t).eq("branchId", u.branchId); return from && to ? b.gte("entryDate", from).lte("entryDate", to) : to ? b.lte("entryDate", to) : from ? b.gte("entryDate", from) : b; }).collect()
      : await ctx.db.query("journalEntries").withIndex("by_tenant_date", (q) => { const b = q.eq("tenantId", t); return from && to ? b.gte("entryDate", from).lte("entryDate", to) : to ? b.lte("entryDate", to) : from ? b.gte("entryDate", from) : b; }).collect();
  } else if (u.role && ["super_admin", "superadmin"].includes(String(u.role).toLowerCase().replace(/[\s-]+/g, "_"))) {
    rows = await ctx.db.query("journalEntries").withIndex("by_date", (q) => (from && to ? q.gte("entryDate", from).lte("entryDate", to) : to ? q.lte("entryDate", to) : from ? q.gte("entryDate", from) : q)).collect();
  } else rows = [];
  return rows.filter((e) => e.status === "posted");
}
async function linesOf(ctx: QueryCtx, entries: Doc<"journalEntries">[]): Promise<Doc<"journalLines">[]> {
  const out: Doc<"journalLines">[] = [];
  for (const e of entries) out.push(...(await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect()));
  return out;
}
const line=v.object({accountId:v.id("accounts"),debit:v.number(),credit:v.number(),description:v.optional(v.string())});
export const listAccounts=query({args:{},handler:async(ctx)=>{const u=await requireActiveUser(ctx, "accounts");return (await scopedRows(ctx, u, "accounts"));}});
export const listJournals=query({args:{},handler:async(ctx)=>{const u=await requireActiveUser(ctx, "accounts");return (await scopedRows(ctx, u, "journalEntries")).sort((a,b)=>b.entryDate.localeCompare(a.entryDate));}});
export const postJournal=mutation({args:{entryDate:v.string(),reference:v.string(),description:v.string(),lines:v.array(line)},handler:async(ctx,a)=>{const u=await requireManager(ctx, "accounts");const scope=await resolveWriteScope(ctx, u);if(a.lines.length<2)throw new Error("Journal lazima iwe na angalau mistari miwili.");const duplicate=(await ctx.db.query("journalEntries").withIndex("by_tenant_ref",q=>q.eq("tenantId",scope.tenantId).eq("reference",a.reference)).collect()).find(e=>e.branchId===scope.branchId);if(duplicate)throw new Error("Reference hii imeshatumika.");let debit=0,credit=0;for(const l of a.lines){if(!Number.isFinite(l.debit)||!Number.isFinite(l.credit)||l.debit<0||l.credit<0||(l.debit>0&&l.credit>0)||(l.debit===0&&l.credit===0))throw new Error("Kila mstari uwe debit au credit halali pekee.");const account=await ctx.db.get("accounts", l.accountId);if(!account||!account.isActive||!canAccessRecord(u,account))throw new Error("Account haipatikani au huna ruhusa.");debit+=l.debit;credit+=l.credit;}debit=Math.round(debit*100)/100;credit=Math.round(credit*100)/100;if(Math.abs(debit-credit)>0.009)throw new Error(`Journal haijabalance: debit ${debit}, credit ${credit}.`);const id=await ctx.db.insert("journalEntries",{...scope,entryDate:a.entryDate,reference:a.reference,description:a.description,status:"posted",sourceType:"manual",totalDebit:debit,totalCredit:credit,createdBy:u._id,postedAt:new Date().toISOString()});for(const l of a.lines)await ctx.db.insert("journalLines",{...scope,entryId:id,...l});await ctx.db.insert("auditLogs",{userId:u._id,userName:u.name??u.email??"user",action:"post_journal",module:"accounting",referenceId:String(id),referenceType:"journalEntry",details:`${a.reference}; debit=${debit}; credit=${credit}`,timestamp:new Date().toISOString(),result:"success"});return id;}});
export const trialBalance=query({args:{},handler:async(ctx)=>{const u=await requireActiveUser(ctx, "accounts");const totals=new Map<string,{d:number;c:number}>();for(const l of await linesOf(ctx,await postedEntries(ctx,u))){const t=totals.get(String(l.accountId))??{d:0,c:0};t.d+=l.debit;t.c+=l.credit;totals.set(String(l.accountId),t);}return (await scopedRows(ctx,u,"accounts")).map(account=>{const t=totals.get(String(account._id))??{d:0,c:0};return {accountId:account._id,code:account.code,name:account.name,type:account.type,debit:Math.round(t.d*100)/100,credit:Math.round(t.c*100)/100,balance:Math.round((t.d-t.c)*100)/100};});}});

export const createAccount=mutation({args:{code:v.string(),name:v.string(),type:v.string(),subtype:v.optional(v.string()),description:v.optional(v.string())},handler:async(ctx,a)=>{const u=await requireManager(ctx, "accounts");const scope=await resolveWriteScope(ctx, u);if(!a.code.trim()||!a.name.trim()||!['asset','liability','equity','revenue','expense'].includes(a.type))throw new Error('Account code, jina na aina halali vinahitajika.');const existing=(await ctx.db.query('accounts').withIndex('by_tenant_code',q=>q.eq('tenantId',scope.tenantId).eq('code',a.code)).collect()).find(x=>x.branchId===scope.branchId);if(existing)throw new Error('Account code hii tayari ipo kwenye scope yako.');return await ctx.db.insert('accounts',{...scope,...a,balance:0,isActive:true,isSystem:false});}});


/** Income statement from posted ledger entries only. */
export const profitAndLoss = query({ args: { startDate: v.string(), endDate: v.string() }, handler: async (ctx, a) => {
 const u = await requirePermission(ctx, "accounts.reports.view", "accounts"); if (a.endDate < a.startDate) throw new Error("Date range si sahihi.");
 const entries = await postedEntries(ctx, u, a.startDate, a.endDate);
 const accounts = (await scopedRows(ctx, u, "accounts")); const accountMap = new Map(accounts.map(x => [String(x._id), x]));
 const totals = new Map<string, {accountId:string;code:string;name:string;type:string;amount:number}>();
 for (const l of await linesOf(ctx, entries)) { const ac = accountMap.get(String(l.accountId)); if (!ac || !["revenue","expense"].includes(ac.type)) continue; const sign = ac.type === "revenue" ? l.credit-l.debit : l.debit-l.credit; const row=totals.get(String(ac._id)) ?? {accountId:String(ac._id),code:ac.code,name:ac.name,type:ac.type,amount:0}; row.amount=roundMoney(row.amount+sign); totals.set(String(ac._id),row); }
 const rows=[...totals.values()].sort((x,y)=>x.code.localeCompare(y.code)); const revenue=roundMoney(rows.filter(x=>x.type==="revenue").reduce((n,x)=>n+x.amount,0)); const expenses=roundMoney(rows.filter(x=>x.type==="expense").reduce((n,x)=>n+x.amount,0)); return {startDate:a.startDate,endDate:a.endDate,rows,totalRevenue:revenue,totalExpenses:expenses,netProfit:roundMoney(revenue-expenses)};
}});

/** Balance sheet from all posted entries through the requested date. */
export const balanceSheet = query({ args: { asOfDate: v.string() }, handler: async (ctx, a) => {
 const u=await requirePermission(ctx, "accounts.reports.view", "accounts"); const entries=await postedEntries(ctx,u,undefined,a.asOfDate); const accounts=(await scopedRows(ctx, u, "accounts")); const map=new Map(accounts.map(x=>[String(x._id),x])); const totals=new Map<string,{accountId:string;code:string;name:string;type:string;balance:number}>();
 let earnings=0;for(const l of await linesOf(ctx,entries)){const ac=map.get(String(l.accountId));if(ac&&["revenue","expense"].includes(ac.type))earnings=roundMoney(earnings+l.credit-l.debit);if(!ac||!["asset","liability","equity"].includes(ac.type))continue;const amount=ac.type==="asset"?l.debit-l.credit:l.credit-l.debit;const row=totals.get(String(ac._id))??{accountId:String(ac._id),code:ac.code,name:ac.name,type:ac.type,balance:0};row.balance=roundMoney(row.balance+amount);totals.set(String(ac._id),row);}
 if(earnings!==0)totals.set("current-earnings",{accountId:"current-earnings",code:"3999",name:"Current period earnings (net profit)",type:"equity",balance:earnings});
 const rows=[...totals.values()].sort((x,y)=>x.code.localeCompare(y.code)); const sum=(type:string)=>roundMoney(rows.filter(x=>x.type===type).reduce((n,x)=>n+x.balance,0)); return {asOfDate:a.asOfDate,rows,totalAssets:sum("asset"),totalLiabilities:sum("liability"),totalEquity:sum("equity"),liabilitiesAndEquity:roundMoney(sum("liability")+sum("equity"))};
}});
