import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { UserLike } from "./access";
import { canAccessBusinessRecord, canAccessRecord, canUseAccount, filterScoped, logAudit, requireActiveUser, resolveWriteScope, requireManagerOrPermission, scopedRows, requirePermission, visibleAccounts } from "./access";
import { roundMoney, isMoneyAccount } from "./ledger";
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
export const listAccounts=query({args:{},handler:async(ctx)=>{const u=await requirePermission(ctx, "accounts.view", "accounts");return (await visibleAccounts(ctx, u));}});
export const listJournals=query({args:{},handler:async(ctx)=>{const u=await requirePermission(ctx, "accounts.view", "accounts");return (await scopedRows(ctx, u, "journalEntries")).sort((a,b)=>b.entryDate.localeCompare(a.entryDate));}});
export const postJournal=mutation({args:{entryDate:v.string(),reference:v.string(),description:v.string(),lines:v.array(line)},handler:async(ctx,a)=>{const u=await requireManagerOrPermission(ctx, "accounts.manage", "accounts");const scope=await resolveWriteScope(ctx, u);if(a.lines.length<2)throw new ConvexError("Journal lazima iwe na angalau mistari miwili.");const duplicate=(await ctx.db.query("journalEntries").withIndex("by_tenant_ref",q=>q.eq("tenantId",scope.tenantId).eq("reference",a.reference)).collect()).find(e=>e.branchId===scope.branchId);if(duplicate)throw new ConvexError("Reference hii imeshatumika.");let debit=0,credit=0;for(const l of a.lines){if(!Number.isFinite(l.debit)||!Number.isFinite(l.credit)||l.debit<0||l.credit<0||(l.debit>0&&l.credit>0)||(l.debit===0&&l.credit===0))throw new ConvexError("Kila mstari uwe debit au credit halali pekee.");const account=await ctx.db.get("accounts", l.accountId);if(!account||!account.isActive||!canUseAccount(u,account))throw new ConvexError("Account haipatikani au huna ruhusa.");debit+=l.debit;credit+=l.credit;}debit=Math.round(debit*100)/100;credit=Math.round(credit*100)/100;if(Math.abs(debit-credit)>0.009)throw new ConvexError(`Journal haijabalance: debit ${debit}, credit ${credit}.`);const id=await ctx.db.insert("journalEntries",{...scope,entryDate:a.entryDate,reference:a.reference,description:a.description,status:"posted",sourceType:"manual",totalDebit:debit,totalCredit:credit,createdBy:u._id,postedAt:new Date().toISOString()});for(const l of a.lines)await ctx.db.insert("journalLines",{...scope,entryId:id,...l});await ctx.db.insert("auditLogs",{userId:u._id,userName:u.name??u.email??"user",action:"post_journal",module:"accounting",referenceId:String(id),referenceType:"journalEntry",details:`${a.reference}; debit=${debit}; credit=${credit}`,timestamp:new Date().toISOString(),result:"success"});return id;}});
export const trialBalance=query({args:{},handler:async(ctx)=>{const u=await requirePermission(ctx, "accounts.view", "accounts");const totals=new Map<string,{d:number;c:number}>();for(const l of await linesOf(ctx,await postedEntries(ctx,u))){const t=totals.get(String(l.accountId))??{d:0,c:0};t.d+=l.debit;t.c+=l.credit;totals.set(String(l.accountId),t);}return (await visibleAccounts(ctx, u)).map(account=>{const t=totals.get(String(account._id))??{d:0,c:0};return {accountId:account._id,code:account.code,name:account.name,type:account.type,debit:Math.round(t.d*100)/100,credit:Math.round(t.c*100)/100,balance:Math.round((t.d-t.c)*100)/100};});}});

export const createAccount=mutation({args:{code:v.string(),name:v.string(),type:v.string(),subtype:v.optional(v.string()),description:v.optional(v.string()),location:v.optional(v.union(v.literal("all"),v.id("branches")))},handler:async(ctx,a)=>{
 const u=await requireManagerOrPermission(ctx, "accounts.manage", "accounts");
 const {location,...rest}=a;
 let scope=await resolveWriteScope(ctx, u, location?{tenantWide:true}:{});
 if(location){ // business-wide user picks where the account lives: every department ("all") or one department
  if(u.branchId)throw new ConvexError("Kuchagua eneo la account, chagua 'All departments' (si idara moja) kwenye menyu ya juu.");
  scope=location==="all"?{tenantId:scope.tenantId}:{tenantId:scope.tenantId,branchId:await departmentOf(ctx,scope.tenantId,location)};
 }
 const code=rest.code.trim(),name=rest.name.trim();
 if(!code||!name||!['asset','liability','equity','revenue','expense'].includes(rest.type))throw new ConvexError('Account code, jina na aina halali vinahitajika.');
 const clash=await accountCodeClash(ctx,scope.tenantId,code,scope.branchId,undefined);
 if(clash)throw new ConvexError(clash);
 const id=await ctx.db.insert('accounts',{...scope,...rest,code,name,balance:0,isActive:true,isSystem:false});
 await logAudit(ctx,u,{action:"create_account",module:"accounts",referenceId:String(id),details:`${code} ${name} (${scope.branchId?"department":"all locations"})`});
 return id;
}});

/** A department of this business that is active (an account can only be placed in a real department of the same business). */
async function departmentOf(ctx:MutationCtx,tenantId:Id<"tenants">|undefined,branchId:Id<"branches">){
 const b=await ctx.db.get("branches",branchId);
 if(!b||b.tenantId!==tenantId||!b.isActive)throw new ConvexError("Idara hiyo haipo kwenye biashara hii.");
 return b._id;
}

/** Why an account code cannot live in the target place (or null). A business-wide code is taken for every department; a department code only inside that department. */
async function accountCodeClash(ctx:MutationCtx,tenantId:Id<"tenants">|undefined,code:string,branchId:Id<"branches">|undefined,exceptId:Id<"accounts">|undefined){
 const same=(await ctx.db.query("accounts").withIndex("by_tenant_code",q=>q.eq("tenantId",tenantId).eq("code",code)).collect()).filter(x=>x._id!==exceptId);
 if(branchId){ if(same.some(x=>x.branchId===branchId||!x.branchId))return `Account code ${code} tayari ipo kwenye idara hiyo (au ni ya maeneo yote).`; return null; }
 if(same.length)return `Account code ${code} tayari inatumika (kwenye idara au kwa maeneo yote). Tumia code nyingine.`;
 return null;
}

/** An account the user may change: of his business, and reachable from where he works (his department or a business-wide one). */
async function editableAccount(ctx:MutationCtx,u:UserLike,accountId:Id<"accounts">){
 const acc=await ctx.db.get("accounts",accountId);
 if(!acc||!canAccessBusinessRecord(u,acc))throw new ConvexError("Account haipatikani.");
 if(!canUseAccount(u,acc))throw new ConvexError("Account hii iko kwenye idara nyingine. Chagua idara hiyo (au All departments) kwanza.");
 return acc;
}

/** Everything that still points at an account, so it is never deleted or moved from under it. */
async function accountUsage(ctx:MutationCtx,acc:Doc<"accounts">){
 const lines=await ctx.db.query("journalLines").withIndex("by_account",q=>q.eq("accountId",acc._id)).collect();
 const entryBranches=new Set<string>();
 for(const l of lines){const e=await ctx.db.get("journalEntries",l.entryId);entryBranches.add(String(e?.branchId??""));}
 const methods=(await ctx.db.query("paymentMethods").withIndex("by_scope",q=>q.eq("tenantId",acc.tenantId)).collect()).filter(m=>m.accountId===acc._id).length;
 const bills=(await ctx.db.query("bills").withIndex("by_scope",q=>q.eq("tenantId",acc.tenantId)).collect()).filter(b=>b.expenseAccountId===acc._id).length;
 const children=(await ctx.db.query("accounts").withIndex("by_scope",q=>q.eq("tenantId",acc.tenantId)).collect()).filter(x=>x.parentId===acc._id).length;
 return {lineCount:lines.length,entryBranches,methods,bills,children};
}

/**
 * Edit an account of the Chart of Accounts: name, description, code, active, and WHERE it lives:
 *  - "all": every department can use it (each department still keeps its own figures, because every posting belongs to its department);
 *  - one department: only that department. Not possible while the account holds postings of another department.
 * The location can only be changed by a business-wide user (no single department selected).
 */
export const updateAccount=mutation({args:{accountId:v.id("accounts"),name:v.optional(v.string()),description:v.optional(v.string()),code:v.optional(v.string()),isActive:v.optional(v.boolean()),location:v.optional(v.union(v.literal("all"),v.id("branches")))},handler:async(ctx,a)=>{
 const u=await requireManagerOrPermission(ctx,"accounts.manage","accounts");
 const acc=await editableAccount(ctx,u,a.accountId);
 const patch:Partial<Doc<"accounts">>={};
 const usage=await accountUsage(ctx,acc);
 const name=a.name?.trim();
 if(name!==undefined){if(name.length<2||name.length>80)throw new ConvexError("Jina la account liwe herufi 2 hadi 80.");patch.name=name;}
 if(a.description!==undefined)patch.description=a.description.trim()||undefined;
 let targetBranch=acc.branchId;
 if(a.location!==undefined){
  if(u.branchId)throw new ConvexError("Kubadilisha eneo la account, chagua 'All departments' (si idara moja) kwenye menyu ya juu.");
  targetBranch=a.location==="all"?undefined:await departmentOf(ctx,acc.tenantId,a.location);
  if(targetBranch!==acc.branchId){
   if(targetBranch&&[...usage.entryBranches].some(b=>b!==String(targetBranch)))throw new ConvexError("Account hii ina miamala ya idara nyingine, kwa hiyo haiwezi kuhamishiwa idara moja. Iweke 'All locations' badala yake.");
   patch.branchId=targetBranch;
  }
 }
 const code=a.code===undefined?acc.code:a.code.trim();
 if(a.code!==undefined&&code!==acc.code){
  if(acc.isSystem)throw new ConvexError("Code ya account ya mfumo haibadilishwi.");
  if(!code)throw new ConvexError("Account code inahitajika.");
  patch.code=code;
 }
 if((patch.code!==undefined||patch.branchId!==undefined||(a.location!==undefined&&targetBranch!==acc.branchId))){
  const clash=await accountCodeClash(ctx,acc.tenantId,code,targetBranch,acc._id);
  if(clash)throw new ConvexError(clash);
 }
 if(a.isActive!==undefined&&a.isActive!==acc.isActive){
  if(!a.isActive&&(acc.isSystem||usage.methods>0))throw new ConvexError("Account hii inatumiwa na mfumo au njia ya malipo; haiwezi kuzimwa.");
  patch.isActive=a.isActive;
 }
 if(!Object.keys(patch).length)return acc._id;
 await ctx.db.patch("accounts",acc._id,patch);
 await logAudit(ctx,u,{action:"update_account",module:"accounts",referenceId:String(acc._id),details:`${acc.code} ${acc.name} -> ${patch.code??acc.code} ${patch.name??acc.name}${a.location!==undefined?`; location ${a.location==="all"?"all":"department"}`:""}${patch.isActive!==undefined?`; active ${patch.isActive}`:""}`});
 return acc._id;
}});

/** Delete an account nobody has used yet. One with postings (or used by a payment method, a bill, a sub-account, or by the system) cannot be deleted: switch it off instead. */
export const deleteAccount=mutation({args:{accountId:v.id("accounts")},handler:async(ctx,a)=>{
 const u=await requireManagerOrPermission(ctx,"accounts.manage","accounts");
 const acc=await editableAccount(ctx,u,a.accountId);
 if(acc.isSystem)throw new ConvexError("Account ya mfumo haifutwi.");
 const usage=await accountUsage(ctx,acc);
 if(usage.lineCount>0)throw new ConvexError(`Account hii ina miamala (${usage.lineCount}), kwa hiyo haiwezi kufutwa. Izime (Deactivate) badala yake.`);
 if(usage.methods>0||usage.bills>0||usage.children>0)throw new ConvexError("Account hii inatumiwa na njia ya malipo, bili au account nyingine; haiwezi kufutwa.");
 await ctx.db.delete("accounts",acc._id);
 await logAudit(ctx,u,{action:"delete_account",module:"accounts",referenceId:String(acc._id),details:`${acc.code} ${acc.name}`});
 return {ok:true};
}});


/** Income statement from posted ledger entries only. */
export const profitAndLoss = query({ args: { startDate: v.string(), endDate: v.string() }, handler: async (ctx, a) => {
 const u = await requirePermission(ctx, "accounts.reports.view", "accounts"); if (a.endDate < a.startDate) throw new ConvexError("Date range si sahihi.");
 // Stock adjustments / stock-take corrections are not a business expense: kept out of the income statement.
 const entries = (await postedEntries(ctx, u, a.startDate, a.endDate)).filter((e) => e.sourceType !== "stock_adjustment");
 const accounts = (await visibleAccounts(ctx, u)); const accountMap = new Map(accounts.map(x => [String(x._id), x]));
 const totals = new Map<string, {accountId:string;code:string;name:string;type:string;amount:number}>();
 for (const l of await linesOf(ctx, entries)) { const ac = accountMap.get(String(l.accountId)); if (!ac || !["revenue","expense"].includes(ac.type)) continue; const sign = ac.type === "revenue" ? l.credit-l.debit : l.debit-l.credit; const row=totals.get(String(ac._id)) ?? {accountId:String(ac._id),code:ac.code,name:ac.name,type:ac.type,amount:0}; row.amount=roundMoney(row.amount+sign); totals.set(String(ac._id),row); }
 const rows=[...totals.values()].sort((x,y)=>x.code.localeCompare(y.code)); const revenue=roundMoney(rows.filter(x=>x.type==="revenue").reduce((n,x)=>n+x.amount,0)); const expenses=roundMoney(rows.filter(x=>x.type==="expense").reduce((n,x)=>n+x.amount,0)); return {startDate:a.startDate,endDate:a.endDate,rows,totalRevenue:revenue,totalExpenses:expenses,netProfit:roundMoney(revenue-expenses)};
}});

/** Balance sheet from all posted entries through the requested date. */
export const balanceSheet = query({ args: { asOfDate: v.string() }, handler: async (ctx, a) => {
 const u=await requirePermission(ctx, "accounts.reports.view", "accounts"); const entries=await postedEntries(ctx,u,undefined,a.asOfDate); const accounts=(await visibleAccounts(ctx, u)); const map=new Map(accounts.map(x=>[String(x._id),x])); const totals=new Map<string,{accountId:string;code:string;name:string;type:string;balance:number}>();
 let earnings=0;for(const l of await linesOf(ctx,entries)){const ac=map.get(String(l.accountId));if(ac&&["revenue","expense"].includes(ac.type))earnings=roundMoney(earnings+l.credit-l.debit);if(!ac||!["asset","liability","equity"].includes(ac.type))continue;const amount=ac.type==="asset"?l.debit-l.credit:l.credit-l.debit;const row=totals.get(String(ac._id))??{accountId:String(ac._id),code:ac.code,name:ac.name,type:ac.type,balance:0};row.balance=roundMoney(row.balance+amount);totals.set(String(ac._id),row);}
 if(earnings!==0)totals.set("current-earnings",{accountId:"current-earnings",code:"3999",name:"Current period earnings (net profit)",type:"equity",balance:earnings});
 const rows=[...totals.values()].sort((x,y)=>x.code.localeCompare(y.code)); const sum=(type:string)=>roundMoney(rows.filter(x=>x.type===type).reduce((n,x)=>n+x.balance,0)); return {asOfDate:a.asOfDate,rows,totalAssets:sum("asset"),totalLiabilities:sum("liability"),totalEquity:sum("equity"),liabilitiesAndEquity:roundMoney(sum("liability")+sum("equity"))};
}});


/** Cash movement report: posted journal movements on cash, bank and mobile-money accounts. */
export const cashFlow = query({ args: { startDate: v.string(), endDate: v.string() }, handler: async (ctx, a) => {
 const u=await requirePermission(ctx,"accounts.reports.view","accounts"); if(a.endDate<a.startDate) throw new ConvexError("Date range si sahihi.");
 const accounts=await visibleAccounts(ctx, u); const map=new Map(accounts.map(x=>[String(x._id),x]));
 const movements=new Map<string,{code:string;name:string;inflow:number;outflow:number}>();
 for(const line of await linesOf(ctx,await postedEntries(ctx,u,a.startDate,a.endDate))){const account=map.get(String(line.accountId));if(!isMoneyAccount(account))continue;const row=movements.get(String(line.accountId))??{code:account.code,name:account.name,inflow:0,outflow:0};row.inflow=roundMoney(row.inflow+line.debit);row.outflow=roundMoney(row.outflow+line.credit);movements.set(String(line.accountId),row);}
 const rows=[...movements.values()].sort((x,y)=>x.code.localeCompare(y.code));return {startDate:a.startDate,endDate:a.endDate,rows,totalInflow:roundMoney(rows.reduce((n,x)=>n+x.inflow,0)),totalOutflow:roundMoney(rows.reduce((n,x)=>n+x.outflow,0)),netMovement:roundMoney(rows.reduce((n,x)=>n+x.inflow-x.outflow,0))};
}});

/** Customer receivables report, restricted to the current business/branch. */
export const receivablesReport = query({ args: { startDate: v.string(), endDate: v.string() }, handler: async (ctx,a) => {
 const u=await requirePermission(ctx,"accounts.reports.view","accounts");
 const invoices=(await scopedRows(ctx,u,"invoices")).filter(x=>x.status==="posted"&&x.invoiceDate>=a.startDate&&x.invoiceDate<=a.endDate&&x.outstanding>0);
 const grouped=new Map<string,{customerId:string;customerName:string;invoiceCount:number;total:number;outstanding:number}>();
 for(const inv of invoices){const client=await ctx.db.get("clients",inv.clientId);const key=String(inv.clientId);const row=grouped.get(key)??{customerId:key,customerName:client?.name??"Customer",invoiceCount:0,total:0,outstanding:0};row.invoiceCount++;row.total=roundMoney(row.total+inv.total);row.outstanding=roundMoney(row.outstanding+inv.outstanding);grouped.set(key,row);}
 return [...grouped.values()].sort((x,y)=>y.outstanding-x.outstanding);
}});

/** Supplier payables report, restricted to the current business/branch. */
export const payablesReport = query({ args: { startDate: v.string(), endDate: v.string() }, handler: async (ctx,a) => {
 const u=await requirePermission(ctx,"accounts.reports.view","accounts");
 const purchases=(await scopedRows(ctx,u,"purchases")).filter(x=>x.status==="posted"&&x.purchaseDate>=a.startDate&&x.purchaseDate<=a.endDate&&x.outstanding>0);
 const grouped=new Map<string,{supplierId:string;supplierName:string;invoiceCount:number;total:number;outstanding:number}>();
 for(const purchase of purchases){const supplier=await ctx.db.get("suppliers",purchase.supplierId);const key=String(purchase.supplierId);const row=grouped.get(key)??{supplierId:key,supplierName:supplier?.name??"Supplier",invoiceCount:0,total:0,outstanding:0};row.invoiceCount++;row.total=roundMoney(row.total+purchase.total);row.outstanding=roundMoney(row.outstanding+purchase.outstanding);grouped.set(key,row);}
 return [...grouped.values()].sort((x,y)=>y.outstanding-x.outstanding);
}});

/** General ledger detail: one row per posted journal line with its account and journal reference. */
export const generalLedger = query({ args: { startDate: v.string(), endDate: v.string() }, handler: async (ctx,a) => {
 const u=await requirePermission(ctx,"accounts.reports.view","accounts");
 const entries=await postedEntries(ctx,u,a.startDate,a.endDate); const accounts=await visibleAccounts(ctx, u); const accountMap=new Map(accounts.map(x=>[String(x._id),x]));
 const result=[] as Array<{date:string;reference:string;description:string;code:string;account:string;debit:number;credit:number}>;
 for(const entry of entries){const lines=await ctx.db.query("journalLines").withIndex("by_entry",q=>q.eq("entryId",entry._id)).collect();for(const line of lines){const account=accountMap.get(String(line.accountId));if(account)result.push({date:entry.entryDate,reference:entry.reference,description:line.description??entry.description,code:account.code,account:account.name,debit:line.debit,credit:line.credit});}}
 return result.sort((x,y)=>x.date.localeCompare(y.date)||x.code.localeCompare(y.code));
}});

/**
 * Money-account report (Tigo Pesa, cash, bank ...): for the chosen period, per account, what it opened with, how much came IN,
 * how much went OUT and what each outgoing amount paid for, and what is left. Read from posted journal lines only, so it always agrees
 * with the ledger. Cash-kind payment methods share the one Cash account.
 */
export const methodReport = query({ args: { startDate: v.string(), endDate: v.string() }, handler: async (ctx, a) => {
 const u = await requirePermission(ctx, "accounts.reports.view", "accounts");
 if (a.endDate < a.startDate) throw new ConvexError("Date range si sahihi.");
 const accounts = (await visibleAccounts(ctx, u)).filter((x) => x.isActive && isMoneyAccount(x));
 const byId = new Map(accounts.map((x) => [String(x._id), x]));
 const branchNames = new Map<string, string>();
 for (const x of accounts) if (x.branchId && !branchNames.has(String(x.branchId))) branchNames.set(String(x.branchId), (await ctx.db.get("branches", x.branchId))?.name ?? "");
 const dayBefore = new Date(Date.parse(`${a.startDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
 type Detail = { date: string; reference: string; description: string; sourceType: string; amount: number };
 type Group = { sourceType: string; amount: number; count: number };
 const rows = new Map<string, { opening: number; totalIn: number; totalOut: number; inBy: Map<string, Group>; outBy: Map<string, Group>; ins: Detail[]; outs: Detail[]; truncated: boolean }>();
 const rowOf = (id: string) => { let r = rows.get(id); if (!r) { r = { opening: 0, totalIn: 0, totalOut: 0, inBy: new Map(), outBy: new Map(), ins: [], outs: [], truncated: false }; rows.set(id, r); } return r; };
 const DETAIL_CAP = 400;
 for (const e of await postedEntries(ctx, u, undefined, dayBefore)) {
  for (const l of await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect()) if (byId.has(String(l.accountId))) rowOf(String(l.accountId)).opening = roundMoney(rowOf(String(l.accountId)).opening + l.debit - l.credit);
 }
 for (const e of await postedEntries(ctx, u, a.startDate, a.endDate)) {
  const sourceType = e.sourceType ?? "manual";
  for (const l of await ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect()) {
   if (!byId.has(String(l.accountId))) continue;
   const r = rowOf(String(l.accountId));
   const detail: Detail = { date: e.entryDate, reference: e.reference, description: l.description ?? e.description, sourceType, amount: roundMoney(l.debit > 0 ? l.debit : l.credit) };
   const put = (map: Map<string, Group>, list: Detail[]) => { const g = map.get(sourceType) ?? { sourceType, amount: 0, count: 0 }; g.amount = roundMoney(g.amount + detail.amount); g.count++; map.set(sourceType, g); if (list.length < DETAIL_CAP) list.push({ ...detail, description: e.description }); else r.truncated = true; };
   if (l.debit > 0) { r.totalIn = roundMoney(r.totalIn + l.debit); put(r.inBy, r.ins); }
   if (l.credit > 0) { r.totalOut = roundMoney(r.totalOut + l.credit); put(r.outBy, r.outs); }
  }
 }
 const out = [] as Array<{ accountId: string; code: string; name: string; branchName: string; opening: number; totalIn: number; totalOut: number; closing: number; inBy: Group[]; outBy: Group[]; ins: Detail[]; outs: Detail[]; truncated: boolean }>;
 for (const [id, r] of rows) {
  const ac = byId.get(id)!;
  const closing = roundMoney(r.opening + r.totalIn - r.totalOut);
  if (r.opening === 0 && r.totalIn === 0 && r.totalOut === 0) continue;
  const sortGroups = (m: Map<string, Group>) => [...m.values()].sort((x, y) => y.amount - x.amount);
  out.push({ accountId: id, code: ac.code, name: ac.name, branchName: ac.branchId ? (branchNames.get(String(ac.branchId)) ?? "") : "", opening: r.opening, totalIn: r.totalIn, totalOut: r.totalOut, closing, inBy: sortGroups(r.inBy), outBy: sortGroups(r.outBy), ins: r.ins.sort((x, y) => x.date.localeCompare(y.date)), outs: r.outs.sort((x, y) => x.date.localeCompare(y.date)), truncated: r.truncated });
 }
 out.sort((x, y) => x.code.localeCompare(y.code) || x.name.localeCompare(y.name));
 return { startDate: a.startDate, endDate: a.endDate, rows: out, totalIn: roundMoney(out.reduce((n, x) => n + x.totalIn, 0)), totalOut: roundMoney(out.reduce((n, x) => n + x.totalOut, 0)), totalClosing: roundMoney(out.reduce((n, x) => n + x.closing, 0)) };
}});
