import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { tr } from "@/lib/i18n.ts";
import { formatNumber } from "@/lib/format.ts";

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;
const money = (n: number) => formatNumber(n, 2);

type Row = { code?: string; name?: string; type?: string; debit?: number; credit?: number; balance?: number; amount?: number };
export default function FinancialReportPage() {
  const location = useLocation(); const navigate = useNavigate();
  const path = location.pathname.split("/").filter(Boolean).slice(2).join("/");
  const [from, setFrom] = useState(monthStart); const [to, setTo] = useState(today);
  const trial = useQuery(api.accounting.trialBalance, {});
  const accounts = useQuery(api.accounting.listAccounts, {});
  const journals = useQuery(api.accounting.generalLedger, path === "ledger" ? { startDate: from, endDate: to } : "skip");
  const pnl = useQuery(api.accounting.profitAndLoss, path === "profit-loss" || path === "trading" ? { startDate: from, endDate: to } : "skip");
  const balance = useQuery(api.accounting.balanceSheet, path === "balance-sheet" ? { asOfDate: to } : "skip");
  const cashFlow = useQuery(api.accounting.cashFlow, path === "cash-flow" ? { startDate: from, endDate: to } : "skip");
  const receivables = useQuery(api.accounting.receivablesReport, path === "receivable" ? { startDate: from, endDate: to } : "skip");
  const payables = useQuery(api.accounting.payablesReport, path === "payable" ? { startDate: from, endDate: to } : "skip");
  const title: Record<string,string> = {
    ledger: tr("General Ledger"), "trial-balance": tr("Trial Balance"), "balance-sheet": tr("Balance Sheet"),
    "profit-loss": tr("Profit and Loss"), trading: tr("Trading Account"), "cash-flow": tr("Cash Flow Report"),
    receivable: tr("Accounts Receivable"), payable: tr("Accounts Payable"), "accounts-list": tr("List of Accounts"),
  };
  const rows = useMemo(() => (trial ?? []) as Row[], [trial]);
  const loading = path === "profit-loss" || path === "trading" ? pnl === undefined : path === "balance-sheet" ? balance === undefined : path === "cash-flow" ? cashFlow === undefined : path === "receivable" ? receivables === undefined : path === "payable" ? payables === undefined : path === "ledger" ? journals === undefined : path === "accounts-list" ? accounts === undefined : trial === undefined;
  const table = (items: Row[], cols: string[]) => <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead><tr className="bg-muted/60 text-left">{cols.map(c=><th key={c} className="p-3">{c}</th>)}</tr></thead><tbody>{items.map((r,i)=><tr className="border-t" key={`${r.code??r.name}-${i}`}>{cols.map(c=><td key={c} className="p-3">{c==="Code"?r.code:c==="Account"?r.name:c==="Type"?r.type:c==="Debit"?money(r.debit??0):c==="Credit"?money(r.credit??0):c==="Balance"?money(r.balance??0):money(r.amount??0)}</td>)}</tr>)}</tbody></table>{!items.length&&<p className="p-5 text-sm text-muted-foreground">{tr("Hakuna taarifa kwenye ripoti hii kwa kipindi ulichochagua.")}</p>}</div>;
  return <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><Button variant="outline" onClick={()=>navigate("/accounts")}>{tr("← Accounts")}</Button><h1 className="mt-3 text-2xl font-bold">{title[path]??tr("Accounting Report")}</h1><p className="text-sm text-muted-foreground">{tr("Ripoti maalumu inayotumia taarifa za ledger na Chart of Accounts.")}</p></div><div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs">{tr("Kuanzia")}<Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="grid gap-1 text-xs">{tr("Mpaka / As of")}<Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div></div>
  {loading&&<p className="rounded-lg border p-5 text-sm text-muted-foreground">{tr("Inapakia ripoti...")}</p>}
  {!loading&&path==="ledger"&&<><div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead><tr className="bg-muted/60 text-left">{["Date","Reference","Code","Account","Description","Debit","Credit"].map(c=><th className="p-3" key={c}>{c}</th>)}</tr></thead><tbody>{(journals??[]).map((j,i)=><tr className="border-t" key={`${j.reference}-${i}`}><td className="p-3">{j.date}</td><td className="p-3">{j.reference}</td><td className="p-3">{j.code}</td><td className="p-3">{j.account}</td><td className="p-3">{j.description}</td><td className="p-3">{money(j.debit)}</td><td className="p-3">{money(j.credit)}</td></tr>)}</tbody></table>{!journals?.length&&<p className="p-5 text-sm text-muted-foreground">{tr("Hakuna journal lines kwa kipindi hiki.")}</p>}</div></>}
  {!loading&&path==="trial-balance"&&<>{table(rows,["Code","Account","Type","Debit","Credit","Balance"])}</>}
  {!loading&&path==="accounts-list"&&<>{table((accounts??[]).map(a=>({code:a.code,name:a.name,type:a.type,balance:a.balance})),["Code","Account","Type","Balance"])}</>}
  {!loading&&path==="balance-sheet"&&balance&&<><div className="grid gap-3 sm:grid-cols-3">{[[tr("Total Assets"),balance.totalAssets],[tr("Total Liabilities"),balance.totalLiabilities],[tr("Total Equity"),balance.totalEquity]].map(([label,value])=><div className="rounded-xl border p-4" key={String(label)}><p className="text-sm text-muted-foreground">{label}</p><p className="text-xl font-bold">{money(Number(value))}</p></div>)}</div>{table(balance.rows.map(r=>({code:r.code,name:r.name,type:r.type,balance:r.balance})),["Code","Account","Type","Balance"])}</>}
  {!loading&&(path==="profit-loss"||path==="trading")&&pnl&&<><div className="grid gap-3 sm:grid-cols-3">{[[tr("Revenue"),pnl.totalRevenue],[tr("Cost & Expenses"),pnl.totalExpenses],[tr("Net Profit / Loss"),pnl.netProfit]].map(([label,value])=><div className="rounded-xl border p-4" key={String(label)}><p className="text-sm text-muted-foreground">{label}</p><p className="text-xl font-bold">{money(Number(value))}</p></div>)}</div>{table(pnl.rows.map(r=>({code:r.code,name:r.name,type:r.type,amount:r.amount})),["Code","Account","Type","Amount"])}</>}
  {!loading&&path==="cash-flow"&&cashFlow&&<><div className="grid gap-3 sm:grid-cols-3">{[[tr("Cash Inflow"),cashFlow.totalInflow],[tr("Cash Outflow"),cashFlow.totalOutflow],[tr("Net Cash Movement"),cashFlow.netMovement]].map(([label,value])=><div className="rounded-xl border p-4" key={String(label)}><p className="text-sm text-muted-foreground">{label}</p><p className="text-xl font-bold">{money(Number(value))}</p></div>)}</div><div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead><tr className="bg-muted/60 text-left"><th className="p-3">{tr("Code")}</th><th className="p-3">{tr("Cash / Bank Account")}</th><th className="p-3">{tr("Inflow")}</th><th className="p-3">{tr("Outflow")}</th><th className="p-3">{tr("Net")}</th></tr></thead><tbody>{cashFlow.rows.map(r=><tr className="border-t" key={r.code}><td className="p-3">{r.code}</td><td className="p-3">{r.name}</td><td className="p-3">{money(r.inflow)}</td><td className="p-3">{money(r.outflow)}</td><td className="p-3">{money(r.inflow-r.outflow)}</td></tr>)}</tbody></table></div></>}
  {!loading&&path==="receivable"&&<div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead><tr className="bg-muted/60 text-left"><th className="p-3">{tr("Customer")}</th><th className="p-3">{tr("Invoices")}</th><th className="p-3">{tr("Total")}</th><th className="p-3">{tr("Outstanding")}</th></tr></thead><tbody>{(receivables??[]).map(r=><tr className="border-t" key={r.customerId}><td className="p-3">{r.customerName}</td><td className="p-3">{r.invoiceCount}</td><td className="p-3">{money(r.total)}</td><td className="p-3">{money(r.outstanding)}</td></tr>)}</tbody></table></div>}
  {!loading&&path==="payable"&&<div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead><tr className="bg-muted/60 text-left"><th className="p-3">{tr("Supplier")}</th><th className="p-3">{tr("Invoices")}</th><th className="p-3">{tr("Total")}</th><th className="p-3">{tr("Outstanding")}</th></tr></thead><tbody>{(payables??[]).map(r=><tr className="border-t" key={r.supplierId}><td className="p-3">{r.supplierName}</td><td className="p-3">{r.invoiceCount}</td><td className="p-3">{money(r.total)}</td><td className="p-3">{money(r.outstanding)}</td></tr>)}</tbody></table></div>}
  {!title[path]&&<p className="rounded-lg border p-5">{tr("Ripoti haijatambuliwa.")}</p>}
  <p className="text-xs text-muted-foreground">{tr("Kumbuka: ripoti hizi zinategemea journal entries zilizopostiwa na accounts zilizo kwenye scope ya biashara/branch yako.")}</p></main>;
}
