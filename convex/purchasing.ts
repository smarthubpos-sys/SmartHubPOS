import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { canAccessRecord, filterScoped, requireActiveUser, resolveWriteScope, requireManager, scopedRows } from "./access";
import { getSystemAccount, methodAccount, postSystemJournal } from "./ledger";
import { bumpStats } from "./stats";
import { normaliseSplits, splitValidator } from "./paymentMethods";
const round = (n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export const listPurchases = query({args:{},handler:async(ctx)=>{const u=await requireActiveUser(ctx, "purchasing");return (await scopedRows(ctx, u, "purchases")).sort((a,b)=>b.purchaseDate.localeCompare(a.purchaseDate));}});
export const receivePurchase = mutation({args:{supplierId:v.id("suppliers"),purchaseDate:v.string(),supplierInvoiceNo:v.optional(v.string()),paymentAmount:v.optional(v.number()),paymentMethod:v.optional(v.string()),splits:v.optional(v.array(splitValidator)),notes:v.optional(v.string()),lines:v.array(v.object({productId:v.id("products"),qty:v.number(),unitCost:v.number()}))},handler:async(ctx,a)=>{
 const u=await requireManager(ctx, "purchasing"),scope=await resolveWriteScope(ctx, u); if(!a.lines.length)throw new Error("Ongeza angalau bidhaa moja."); const supplier=await ctx.db.get(a.supplierId);if(!canAccessRecord(u,supplier))throw new Error("Supplier hayupo kwenye branch yako.");
 let subtotal=0;const lines=[] as {productId:typeof a.lines[number]["productId"];qty:number;unitCost:number;total:number}[];
 for(const l of a.lines){if(!Number.isFinite(l.qty)||l.qty<=0||!Number.isFinite(l.unitCost)||l.unitCost<0)throw new Error("Kiasi au gharama si sahihi.");const p=await ctx.db.get(l.productId);if(!canAccessRecord(u,p)||!p?.isActive)throw new Error("Bidhaa haipatikani kwenye branch yako.");const total=round(l.qty*l.unitCost);subtotal+=total;lines.push({...l,total});}
 subtotal=round(subtotal);const norm=a.splits?.length?await normaliseSplits(ctx,u,a.splits):null;const paid=norm?norm.total:round(a.paymentAmount??0);if(paid<0||paid>subtotal)throw new Error("Malipo si sahihi.");const sequenceRows=await ctx.db.query("purchaseSequences").withIndex("by_scope",q=>scope.branchId?q.eq("tenantId",scope.tenantId).eq("branchId",scope.branchId):q.eq("tenantId",scope.tenantId)).collect();
 const sequence=sequenceRows.find(x=>x.tenantId===scope.tenantId&&x.branchId===scope.branchId); const invoiceNo=String(sequence?.nextNumber??1);
 if(sequence) await ctx.db.patch(sequence._id,{nextNumber:Number(invoiceNo)+1}); else await ctx.db.insert("purchaseSequences",{...scope,nextNumber:2});
 const internalRef=`PUR-${Date.now().toString(36).toUpperCase()}`;
 const id=await ctx.db.insert("purchases",{...scope,purchaseDate:a.purchaseDate,supplierId:a.supplierId,supplierInvoiceNo:a.supplierInvoiceNo?.trim() || invoiceNo,invoiceNo,internalRef,subtotal,discount:0,additionalCharges:0,taxAmount:0,total:subtotal,amountPaid:paid,outstanding:round(subtotal-paid),paymentStatus:paid===subtotal?"paid":paid>0?"partial":"unpaid",status:"posted",notes:a.notes,createdBy:u._id,postedAt:new Date().toISOString()});
 await bumpStats(ctx,scope,{payable:round(subtotal-paid),date:a.purchaseDate,purchases:subtotal});
 for(const l of lines){const p=await ctx.db.get(l.productId);if(!p)throw new Error("Bidhaa haipo.");const newQty=p.currentQty+l.qty;const oldQty=p.currentQty;const oldCost=p.weightedAvgCost??p.lastPurchaseCost??0;const avg=newQty>0?round((oldQty*oldCost+l.qty*l.unitCost)/newQty):l.unitCost;await ctx.db.patch(l.productId,{currentQty:newQty,lastPurchaseCost:l.unitCost,lastPurchaseDate:a.purchaseDate,lastSupplierId:a.supplierId,weightedAvgCost:avg});await ctx.db.insert("purchaseLines",{purchaseId:id,productId:l.productId,qty:l.qty,qtyStr:String(l.qty),unitCost:l.unitCost,unitCostStr:String(l.unitCost),lineTotal:l.total,lineTotalStr:String(l.total),discount:0,receivedQty:l.qty});await ctx.db.insert("stockMovements",{...scope,movementDate:a.purchaseDate,productId:l.productId,movementType:"purchase",referenceId:String(id),referenceType:"purchase",qtyIn:l.qty,qtyOut:0,runningBalance:newQty,unitCost:l.unitCost,supplierId:a.supplierId,createdBy:u._id});await ctx.db.insert("purchasePriceHistory",{productId:l.productId,purchaseId:id,supplierId:a.supplierId,cost:l.unitCost,date:a.purchaseDate,previousCost:oldCost});}
 if(paid>0){const receiptNo=`RC-${Date.now().toString(36).toUpperCase()}`;for(const sp of (norm?.splits??[{method:a.paymentMethod??"cash",amount:paid,methodId:undefined,reference:undefined}]))await ctx.db.insert("supplierPayments",{...scope,paymentDate:a.purchaseDate,supplierId:a.supplierId,purchaseId:id,amount:sp.amount,paymentMethod:sp.method,paymentMethodId:sp.methodId,receiptNo,reference:sp.reference,createdBy:u._id,notes:"Malipo wakati wa kupokea bidhaa"});}
 const inventory=await getSystemAccount(ctx,scope,"1200","Inventory","asset"),payable=await getSystemAccount(ctx,scope,"2000","Accounts payable","liability");
 const paidLines=[] as {accountId:any;debit:number;credit:number;description:string}[];for(const sp of (norm?.splits??(paid>0?[{method:a.paymentMethod??"cash",methodId:undefined,amount:paid}]:[])))paidLines.push({accountId:await methodAccount(ctx,scope,{methodId:sp.methodId,method:sp.method}),debit:0,credit:sp.amount,description:`Supplier paid - ${sp.method}`}); // each method is paid out of its own account
 await postSystemJournal(ctx,{scope,userId:u._id,date:a.purchaseDate,reference:`PUR-${internalRef}`,description:`Automatic posting for ${internalRef}`,sourceType:"purchase",sourceId:String(id),lines:[{accountId:inventory,debit:subtotal,credit:0,description:"Inventory received"},...paidLines,{accountId:payable,debit:0,credit:round(subtotal-paid),description:"Supplier payable"}]});
 await ctx.db.insert("auditLogs",{userId:u._id,userName:u.name??u.email??"user",action:"receive_purchase",module:"purchasing",referenceId:String(id),referenceType:"purchase",details:`${internalRef}; total ${subtotal}`,timestamp:new Date().toISOString(),result:"success"});return {purchaseId:id,invoiceNo,internalRef,total:subtotal,amountPaid:paid,outstanding:round(subtotal-paid)};
}});

/** Supplier ledger: purchases, payments and returns for a selected date range. */
export const supplierStatement = query({
  args: { supplierId: v.id("suppliers"), startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const u = await requireActiveUser(ctx, "purchasing");
    const supplier = await ctx.db.get(a.supplierId);
    if (!canAccessRecord(u, supplier)) throw new Error("Supplier hayupo kwenye scope yako.");
    const purchases = filterScoped(u, await ctx.db.query("purchases").withIndex("by_supplier", q => q.eq("supplierId", a.supplierId)).collect())
      .filter(x => x.status === "posted" && (!a.startDate || x.purchaseDate >= a.startDate) && (!a.endDate || x.purchaseDate <= a.endDate));
    const payments = filterScoped(u, await ctx.db.query("supplierPayments").withIndex("by_supplier", q => q.eq("supplierId", a.supplierId)).collect())
      .filter(x => (!a.startDate || x.paymentDate >= a.startDate) && (!a.endDate || x.paymentDate <= a.endDate));
    const returns = filterScoped(u, await ctx.db.query("purchaseReturns").withIndex("by_supplier", q => q.eq("supplierId", a.supplierId)).collect())
      .filter(x => x.status === "posted" && (!a.startDate || x.returnDate >= a.startDate) && (!a.endDate || x.returnDate <= a.endDate));
    const lines = [] as Array<{date:string;type:string;reference:string;description:string;debit:number;credit:number;amount:number;items?:Array<{name:string;qty:number;unit:string;unitCost:number;total:number}>}>;
    for (const p of purchases) {
      const pls = await ctx.db.query("purchaseLines").withIndex("by_purchase", q => q.eq("purchaseId", p._id)).collect();
      const items = await Promise.all(pls.map(async l => { const product = await ctx.db.get(l.productId); const unit = product?.unitId ? await ctx.db.get(product.unitId) : null; return {name:product?.name ?? "Bidhaa",qty:l.qty,unit:unit?.name ?? "Unit",unitCost:l.unitCost,total:l.lineTotal}; }));
      lines.push({date:p.purchaseDate,type:"PURCHASE",reference:p.internalRef,description:"Bidhaa zilizonunuliwa",debit:0,credit:p.total,amount:p.total,items});
    }
    for (const p of payments) lines.push({date:p.paymentDate,type:"PAYMENT",reference:p.reference ?? `PAY-${String(p._id).slice(-6)}`,description:p.notes ?? `Malipo ya supplier (${p.paymentMethod})`,debit:p.amount,credit:0,amount:p.amount});
    for (const r of returns) lines.push({date:r.returnDate,type:"RETURN",reference:r.returnRef,description:r.reason ?? "Bidhaa zilizorejeshwa",debit:0,credit:r.total,amount:r.total});
    lines.sort((x,y)=>x.date.localeCompare(y.date)||x.type.localeCompare(y.type));
    const allPurchases = filterScoped(u, await ctx.db.query("purchases").withIndex("by_supplier", q => q.eq("supplierId", a.supplierId)).collect()).filter(x=>x.status==="posted"&&(!a.startDate||x.purchaseDate>=a.startDate)&&(!a.endDate||x.purchaseDate<=a.endDate));
    const allPayments = payments.reduce((s,x)=>s+x.amount,0); const totalPurchases=allPurchases.reduce((s,x)=>s+x.total,0); const totalReturns=returns.reduce((s,x)=>s+x.total,0);
    const balance = Math.round(((supplier?.openingBalance ?? 0) + totalPurchases - allPayments - totalReturns)*100)/100;
    return {supplier,lines,totalPurchases:Math.round(totalPurchases*100)/100,totalPayments:Math.round(allPayments*100)/100,totalReturns:Math.round(totalReturns*100)/100,balance,credit:Math.max(0,-balance),outstanding:Math.max(0,balance)};
  }
});

/** Record supplier payment and allocate it to oldest outstanding purchases; any excess remains supplier credit. */
export const recordSupplierPayment = mutation({
  args: { supplierId:v.id("suppliers"), paymentDate:v.string(), amount:v.optional(v.number()), paymentMethod:v.optional(v.string()), splits:v.optional(v.array(splitValidator)), reference:v.optional(v.string()), notes:v.optional(v.string()) },
  handler: async (ctx,a) => {
    const u=await requireManager(ctx, "purchasing"), scope=await resolveWriteScope(ctx, u); const supplier=await ctx.db.get(a.supplierId);
    if(!canAccessRecord(u,supplier)) throw new Error("Supplier hayupo kwenye scope yako.");
    const {splits,total:amount}=await normaliseSplits(ctx,u,a.splits??[{method:a.paymentMethod??"cash",amount:a.amount??NaN,reference:a.reference}]);
    if(amount<=0) throw new Error("Kiasi cha malipo lazima kiwe zaidi ya sifuri.");
    const receiptNo=`RC-${Date.now().toString(36).toUpperCase()}`; const paymentIds=[] as any[];
    for(const sp of splits) paymentIds.push(await ctx.db.insert("supplierPayments",{...scope,supplierId:a.supplierId,paymentDate:a.paymentDate,amount:sp.amount,paymentMethod:sp.method,paymentMethodId:sp.methodId,receiptNo,reference:sp.reference,notes:a.notes,createdBy:u._id}));
    const paymentId=paymentIds[0];
    let remaining=amount;
    const bills=filterScoped(u,await ctx.db.query("purchases").withIndex("by_supplier",q=>q.eq("supplierId",a.supplierId)).collect()).filter(p=>p.status==="posted"&&p.outstanding>0).sort((x,y)=>x.purchaseDate.localeCompare(y.purchaseDate));
    for(const bill of bills){if(remaining<=0)break;const applied=Math.min(remaining,bill.outstanding);const paid=Math.round((bill.amountPaid+applied)*100)/100;const outstanding=Math.round((bill.outstanding-applied)*100)/100;await ctx.db.patch(bill._id,{amountPaid:paid,outstanding,paymentStatus:outstanding<=0?"paid":"partial"});await bumpStats(ctx,{tenantId:bill.tenantId,branchId:bill.branchId},{payable:-applied});remaining=Math.round((remaining-applied)*100)/100;}
    const payable=await getSystemAccount(ctx,scope,"2000","Accounts payable","liability");
    for(let i=0;i<splits.length;i++){const cash=await methodAccount(ctx,scope,{methodId:splits[i].methodId,method:splits[i].method});await postSystemJournal(ctx,{scope,userId:u._id,date:a.paymentDate,reference:`SUPPAY-${String(paymentIds[i])}`,description:`Supplier payment: ${supplier?.name ?? "Supplier"} (${splits[i].method})`,sourceType:"supplier_payment",sourceId:String(paymentIds[i]),lines:[{accountId:payable,debit:splits[i].amount,credit:0,description:"Settle supplier payable / advance"},{accountId:cash,debit:0,credit:splits[i].amount,description:`Supplier payment - ${splits[i].method}`}]});}
    await ctx.db.insert("auditLogs",{userId:u._id,userName:u.name??u.email??"user",action:"supplier_payment",module:"purchasing",referenceId:String(paymentId),referenceType:"supplierPayment",details:`supplier=${supplier?.name}; amount=${amount}; advance=${remaining}`,timestamp:new Date().toISOString(),result:"success"});
    return {paymentId,receiptNo,amount,splits:splits.map(x=>({method:x.method,amount:x.amount})),allocated:Math.round((amount-remaining)*100)/100,supplierCredit:remaining};
  }
});

export const purchaseReport = query({
 args:{startDate:v.optional(v.string()),endDate:v.optional(v.string()),supplierId:v.optional(v.id("suppliers"))},
 handler:async(ctx,a)=>{const u=await requireActiveUser(ctx, "purchasing");const purchases=(await scopedRows(ctx, u, "purchases")).filter(p=>p.status==="posted"&&(!a.startDate||p.purchaseDate>=a.startDate)&&(!a.endDate||p.purchaseDate<=a.endDate)&&(!a.supplierId||p.supplierId===a.supplierId));const supplierIds=[...new Set(purchases.map(p=>String(p.supplierId)))];const rows=await Promise.all(supplierIds.map(async id=>{const supplier=await ctx.db.get(id as any);const list=purchases.filter(p=>String(p.supplierId)===id);return {supplierId:id,supplierName:(supplier as any)?.name??"Supplier",invoiceCount:list.length,total:list.reduce((s,p)=>s+p.total,0),paid:list.reduce((s,p)=>s+p.amountPaid,0),outstanding:list.reduce((s,p)=>s+p.outstanding,0)};}));return {rows,total:purchases.reduce((s,p)=>s+p.total,0),paid:purchases.reduce((s,p)=>s+p.amountPaid,0),outstanding:purchases.reduce((s,p)=>s+p.outstanding,0),invoiceCount:purchases.length};}
});

/** Read-only registers used by the dedicated Purchasing menu screens. */
export const purchasingRegisters = query({
  args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const u = await requireActiveUser(ctx, "purchasing");
    const inRange = (date: string) => (!a.startDate || date >= a.startDate) && (!a.endDate || date <= a.endDate);
    const [purchasesRaw, ordersRaw, grnsRaw, returnsRaw, paymentsRaw, productsRaw, suppliersRaw] = await Promise.all([
      scopedRows(ctx, u, "purchases"), scopedRows(ctx, u, "purchaseOrders"),
      scopedRows(ctx, u, "goodsReceivedNotes"), scopedRows(ctx, u, "purchaseReturns"),
      scopedRows(ctx, u, "supplierPayments"), scopedRows(ctx, u, "products"), scopedRows(ctx, u, "suppliers"),
    ]);
    const purchases = filterScoped(u, purchasesRaw).filter(x => inRange(x.purchaseDate));
    const orders = filterScoped(u, ordersRaw).filter(x => inRange(x.orderDate));
    const grns = filterScoped(u, grnsRaw).filter(x => inRange(x.receiptDate));
    const returns = filterScoped(u, returnsRaw).filter(x => inRange(x.returnDate));
    const payments = filterScoped(u, paymentsRaw).filter(x => inRange(x.paymentDate));
    const products = filterScoped(u, productsRaw);
    const suppliers = filterScoped(u, suppliersRaw);
    const orderLines = (await Promise.all(orders.map(async order => {
      const orderRows = await ctx.db.query("purchaseOrderLines").withIndex("by_order", q => q.eq("orderId", order._id)).collect();
      return Promise.all(orderRows.map(async line => {
        const product = await ctx.db.get(line.productId);
        return { ...line, orderRef: order.orderRef, supplierId: order.supplierId, productName: product?.name ?? "Product", remaining: Math.max(0, line.qtyOrdered - line.qtyReceived) };
      }));
    }))).flat();
    const lines = await Promise.all(purchases.map(async purchase => {
      const purchaseLines = await ctx.db.query("purchaseLines").withIndex("by_purchase", q => q.eq("purchaseId", purchase._id)).collect();
      return Promise.all(purchaseLines.map(async line => {
        const product = await ctx.db.get(line.productId);
        const unit = product?.unitId ? await ctx.db.get(product.unitId) : null;
        const supplier = suppliers.find(s => s._id === purchase.supplierId);
        return { purchaseId: purchase._id, invoiceNo: purchase.invoiceNo ?? purchase.internalRef, date: purchase.purchaseDate, supplierId: purchase.supplierId, supplierName: supplier?.name ?? "Supplier", productId: line.productId, productName: product?.name ?? "Product", unit: unit?.name ?? "Unit", qty: line.qty, unitCost: line.unitCost, total: line.lineTotal };
      }));
    }));
    return {
      purchases, orders, grns, returns, payments, products, suppliers, orderLines, lines: lines.flat(),
      totals: { purchase: purchases.filter(p=>p.status==="posted").reduce((s,p)=>s+p.total,0), paid: purchases.reduce((s,p)=>s+p.amountPaid,0), outstanding: purchases.reduce((s,p)=>s+p.outstanding,0), returns: returns.filter(r=>r.status==="posted").reduce((s,r)=>s+r.total,0), paymentTotal: payments.reduce((s,p)=>s+p.amount,0) },
    };
  },
});

/** Create a purchase order. Orders do not change stock until a GRN is confirmed. */
export const createPurchaseOrder = mutation({
  args: { supplierId: v.id("suppliers"), orderDate: v.string(), expectedDelivery: v.optional(v.string()), notes: v.optional(v.string()), lines: v.array(v.object({ productId: v.id("products"), qty: v.number(), unitCost: v.number() })) },
  handler: async (ctx, a) => {
    const u = await requireManager(ctx, "purchasing"), scope = await resolveWriteScope(ctx, u);
    const supplier = await ctx.db.get(a.supplierId);
    if (!canAccessRecord(u, supplier)) throw new Error("Supplier hayupo kwenye branch yako.");
    if (!a.lines.length) throw new Error("Ongeza angalau bidhaa moja.");
    let subtotal = 0;
    const validated = [] as Array<{productId: typeof a.lines[number]["productId"]; qty:number; unitCost:number; lineTotal:number}>;
    for (const line of a.lines) {
      if (!Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.unitCost) || line.unitCost < 0) throw new Error("Kiasi au gharama si sahihi.");
      const product = await ctx.db.get(line.productId);
      if (!canAccessRecord(u, product) || !product?.isActive) throw new Error("Bidhaa haipatikani kwenye branch yako.");
      const lineTotal = round(line.qty * line.unitCost); subtotal = round(subtotal + lineTotal);
      validated.push({...line, lineTotal});
    }
    const scoped = await scopedRows(ctx, u, "purchaseOrders"); // this business only (by_scope index), not every business
    const orderRef = `PO-${scoped.length + 1}-${Date.now().toString(36).toUpperCase()}`;
    const orderId = await ctx.db.insert("purchaseOrders", {...scope, supplierId:a.supplierId, orderDate:a.orderDate, expectedDelivery:a.expectedDelivery, orderRef, subtotal, total:subtotal, status:"pending_approval", notes:a.notes, createdBy:u._id});
    for (const line of validated) await ctx.db.insert("purchaseOrderLines", {orderId, productId:line.productId, qtyOrdered:line.qty, unitCost:line.unitCost, lineTotal:line.lineTotal, qtyReceived:0});
    await ctx.db.insert("auditLogs", {userId:u._id,userName:u.name??u.email??"user",action:"create_purchase_order",module:"purchasing",referenceId:String(orderId),referenceType:"purchaseOrder",details:`${orderRef}; total ${subtotal}`,timestamp:new Date().toISOString(),result:"success"});
    return {orderId, orderRef, total:subtotal};
  }
});

export const approvePurchaseOrder = mutation({
  args: { orderId: v.id("purchaseOrders") },
  handler: async (ctx, a) => {
    const u = await requireManager(ctx, "purchasing"); const order = await ctx.db.get(a.orderId);
    if (!canAccessRecord(u, order) || !order) throw new Error("Purchase Order haipatikani.");
    if (order.status !== "pending_approval" && order.status !== "draft") throw new Error("Order hii haiwezi kuidhinishwa katika status yake ya sasa.");
    await ctx.db.patch(a.orderId,{status:"approved",approvedBy:u._id,approvedAt:new Date().toISOString()});
    return {success:true};
  }
});

/** Create a draft GRN against an approved PO. Confirming it is the only action that adds stock. */
export const createGoodsReceivedNote = mutation({
  args: { purchaseOrderId:v.id("purchaseOrders"), receiptDate:v.string(), notes:v.optional(v.string()), lines:v.array(v.object({productId:v.id("products"),qtyReceived:v.number(),qtyRejected:v.optional(v.number())})) },
  handler: async (ctx,a) => {
    const u=await requireManager(ctx, "purchasing"), scope=await resolveWriteScope(ctx, u); const order=await ctx.db.get(a.purchaseOrderId);
    if(!canAccessRecord(u,order)||!order) throw new Error("Purchase Order haipatikani.");
    if(!["approved","partially_received"].includes(order.status)) throw new Error("Purchase Order lazima iwe approved kabla ya kupokea bidhaa.");
    if(!a.lines.length) throw new Error("Ongeza bidhaa za kupokea.");
    const poLines=await ctx.db.query("purchaseOrderLines").withIndex("by_order",q=>q.eq("orderId",a.purchaseOrderId)).collect();
    const clean=[] as Array<{productId:typeof a.lines[number]["productId"];qtyReceived:number;qtyRejected:number;qtyOrdered:number;unitCost:number}>;
    for(const line of a.lines){
      const poLine=poLines.find(x=>x.productId===line.productId); if(!poLine) throw new Error("Bidhaa haipo kwenye Purchase Order.");
      const rejected=line.qtyRejected??0; if(!Number.isFinite(line.qtyReceived)||line.qtyReceived<0||!Number.isFinite(rejected)||rejected<0||line.qtyReceived+rejected<=0) throw new Error("Kiasi kilichopokelewa/kukataliwa si sahihi.");
      if(line.qtyReceived+rejected>poLine.qtyOrdered-poLine.qtyReceived+1e-8) throw new Error("Kiasi kinazidi salio la Purchase Order.");
      clean.push({productId:line.productId,qtyReceived:line.qtyReceived,qtyRejected:rejected,qtyOrdered:poLine.qtyOrdered,unitCost:poLine.unitCost});
    }
    const existing=await scopedRows(ctx,u,"goodsReceivedNotes"); const grnRef=`GRN-${existing.length+1}-${Date.now().toString(36).toUpperCase()}`;
    const grnId=await ctx.db.insert("goodsReceivedNotes",{...scope,grnRef,receiptDate:a.receiptDate,supplierId:order.supplierId,purchaseOrderId:a.purchaseOrderId,status:"draft",notes:a.notes,receivedBy:u._id});
    for(const line of clean) await ctx.db.insert("grnLines",{grnId,productId:line.productId,qtyOrdered:line.qtyOrdered,qtyReceived:line.qtyReceived,qtyRejected:line.qtyRejected,unitCost:line.unitCost});
    return {grnId,grnRef};
  }
});

export const confirmGoodsReceivedNote = mutation({
  args:{grnId:v.id("goodsReceivedNotes")},
  handler:async(ctx,a)=>{
    const u=await requireManager(ctx, "purchasing"),scope=await resolveWriteScope(ctx, u);const grn=await ctx.db.get(a.grnId);
    if(!canAccessRecord(u,grn)||!grn) throw new Error("GRN haipatikani."); if(grn.status!=="draft") throw new Error("GRN hii tayari imethibitishwa.");
    const lines=await ctx.db.query("grnLines").withIndex("by_grn",q=>q.eq("grnId",a.grnId)).collect();if(!lines.length)throw new Error("GRN haina bidhaa.");
    const order=grn.purchaseOrderId?await ctx.db.get(grn.purchaseOrderId):null;
    for(const line of lines){
      const product=await ctx.db.get(line.productId);if(!canAccessRecord(u,product)||!product)throw new Error("Bidhaa haipatikani.");
      const newQty=product.currentQty+line.qtyReceived,oldQty=product.currentQty,oldCost=product.weightedAvgCost??product.lastPurchaseCost??0;
      const avg=newQty>0?round((oldQty*oldCost+line.qtyReceived*line.unitCost)/newQty):line.unitCost;
      await ctx.db.patch(line.productId,{currentQty:newQty,lastPurchaseCost:line.unitCost,lastPurchaseDate:grn.receiptDate,lastSupplierId:grn.supplierId,weightedAvgCost:avg});
      await ctx.db.insert("stockMovements",{...scope,movementDate:grn.receiptDate,productId:line.productId,movementType:"grn",referenceId:String(a.grnId),referenceType:"goodsReceivedNote",qtyIn:line.qtyReceived,qtyOut:0,runningBalance:newQty,unitCost:line.unitCost,supplierId:grn.supplierId,notes:grn.grnRef,createdBy:u._id});
      if(order){const poLine=(await ctx.db.query("purchaseOrderLines").withIndex("by_order",q=>q.eq("orderId",order._id)).collect()).find(x=>x.productId===line.productId);if(poLine)await ctx.db.patch(poLine._id,{qtyReceived:round(poLine.qtyReceived+line.qtyReceived)});}
    }
    if(order){const refreshed=await ctx.db.query("purchaseOrderLines").withIndex("by_order",q=>q.eq("orderId",order._id)).collect();const complete=refreshed.every(x=>x.qtyReceived+1e-8>=x.qtyOrdered);await ctx.db.patch(order._id,{status:complete?"fully_received":"partially_received"});}
    await ctx.db.patch(a.grnId,{status:"confirmed",confirmedAt:new Date().toISOString()});
    await ctx.db.insert("auditLogs",{userId:u._id,userName:u.name??u.email??"user",action:"confirm_grn",module:"purchasing",referenceId:String(a.grnId),referenceType:"goodsReceivedNote",details:`${grn.grnRef}; lines ${lines.length}`,timestamp:new Date().toISOString(),result:"success"});
    return {success:true,lines:lines.length};
  }
});

/** Post a return against a posted purchase; stock and supplier payable are reduced exactly once. */
export const postPurchaseReturn = mutation({
  args:{purchaseId:v.id("purchases"),returnDate:v.string(),reason:v.optional(v.string()),lines:v.array(v.object({productId:v.id("products"),qty:v.number()}))},
  handler:async(ctx,a)=>{
    const u=await requireManager(ctx, "purchasing"),scope=await resolveWriteScope(ctx, u);const purchase=await ctx.db.get(a.purchaseId);
    if(!canAccessRecord(u,purchase)||!purchase||purchase.status!=="posted")throw new Error("Purchase invoice haipatikani au haijapostiwa.");
    if(!a.lines.length)throw new Error("Ongeza bidhaa za kurudisha.");
    const purchaseLines=await ctx.db.query("purchaseLines").withIndex("by_purchase",q=>q.eq("purchaseId",a.purchaseId)).collect();
    const previousReturns=filterScoped(u,await ctx.db.query("purchaseReturns").withIndex("by_purchase",q=>q.eq("purchaseId",a.purchaseId)).collect()).filter(r=>r.status==="posted");
    const priorLines=(await Promise.all(previousReturns.map(r=>ctx.db.query("purchaseReturnLines").withIndex("by_return",q=>q.eq("returnId",r._id)).collect()))).flat();
    const clean=[] as Array<{productId:typeof a.lines[number]["productId"];qty:number;unitCost:number;lineTotal:number}>;let total=0;
    for(const line of a.lines){if(!Number.isFinite(line.qty)||line.qty<=0)throw new Error("Kiasi cha return si sahihi.");const bought=purchaseLines.find(x=>x.productId===line.productId);if(!bought)throw new Error("Bidhaa hii haipo kwenye invoice.");const already=priorLines.filter(x=>x.productId===line.productId).reduce((s,x)=>s+x.qty,0);if(line.qty> bought.qty-already+1e-8)throw new Error("Return inazidi kiasi kilichonunuliwa.");const product=await ctx.db.get(line.productId);if(!canAccessRecord(u,product)||!product)throw new Error("Bidhaa haipatikani.");if(product.currentQty+1e-8<line.qty)throw new Error(`Stock haitoshi kurudisha ${product.name}.`);const lineTotal=round(line.qty*bought.unitCost);total=round(total+lineTotal);clean.push({productId:line.productId,qty:line.qty,unitCost:bought.unitCost,lineTotal});}
    const existing=await scopedRows(ctx,u,"purchaseReturns");const returnRef=`PR-${existing.length+1}-${Date.now().toString(36).toUpperCase()}`;
    const returnId=await ctx.db.insert("purchaseReturns",{...scope,returnDate:a.returnDate,supplierId:purchase.supplierId,purchaseId:a.purchaseId,returnRef,total,reason:a.reason,status:"posted",createdBy:u._id});
    for(const line of clean){const p=await ctx.db.get(line.productId);if(!p)throw new Error("Bidhaa haipo.");const newQty=p.currentQty-line.qty;await ctx.db.patch(line.productId,{currentQty:newQty});await ctx.db.insert("purchaseReturnLines",{returnId,productId:line.productId,qty:line.qty,unitCost:line.unitCost,lineTotal:line.lineTotal});await ctx.db.insert("stockMovements",{...scope,movementDate:a.returnDate,productId:line.productId,movementType:"purchase_return",referenceId:String(returnId),referenceType:"purchaseReturn",qtyIn:0,qtyOut:line.qty,runningBalance:newQty,unitCost:line.unitCost,supplierId:purchase.supplierId,notes:returnRef,createdBy:u._id});}
    // Returns reduce the supplier payable. A return exceeding the remaining payable creates a supplier credit.
    const inventory=await getSystemAccount(ctx,scope,"1200","Inventory","asset"),payable=await getSystemAccount(ctx,scope,"2000","Accounts payable","liability");
    await postSystemJournal(ctx,{scope,userId:u._id,date:a.returnDate,reference:returnRef,description:`Supplier purchase return ${returnRef}`,sourceType:"purchase_return",sourceId:String(returnId),lines:[{accountId:payable,debit:total,credit:0,description:"Reduce supplier payable"},{accountId:inventory,debit:0,credit:total,description:"Goods returned to supplier"}]});
    const updatedOutstanding=round(Math.max(0,purchase.outstanding-total));await ctx.db.patch(a.purchaseId,{outstanding:updatedOutstanding,paymentStatus:updatedOutstanding===0?"paid":purchase.amountPaid>0?"partial":"unpaid"});await bumpStats(ctx,{tenantId:purchase.tenantId,branchId:purchase.branchId},{payable:-round(purchase.outstanding-updatedOutstanding)});
    await ctx.db.insert("auditLogs",{userId:u._id,userName:u.name??u.email??"user",action:"post_purchase_return",module:"purchasing",referenceId:String(returnId),referenceType:"purchaseReturn",details:`${returnRef}; total ${total}`,timestamp:new Date().toISOString(),result:"success"});
    return {returnId,returnRef,total};
  }
});
