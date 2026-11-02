import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRange, ReportTable, Stat } from "@/pages/shared/report.tsx";
import { fmt, groupRows, monthStart, num, round2, today, type Row } from "@/pages/shared/report-utils.ts";
import { tr, errorText, trValue } from "@/lib/i18n.ts";
import TransactionReceipt from "@/components/TransactionReceipt.tsx";
import PaymentSplit from "@/components/PaymentSplit.tsx";
import { describeSplits, newSplitLine, splitsTotal, toSplits, type SplitLine } from "@/lib/payment-split.ts";
import { usePaymentMethods } from "@/hooks/use-payment-methods.ts";
import { printElement, type Paper } from "@/lib/print-area.ts";
import InvoiceFinder from "@/pages/sales/InvoiceFinder.tsx";

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Prints one sold item (a single invoice line) as a small slip, N copies, in the chosen paper size. */
function printSoldItem(row: Row, copies: number, paper: Paper, company: { name: string; address: string; phone: string; currencySymbol: string }) {
  const money = (n: unknown) => `${company.currencySymbol} ${fmt(num(n as number), 2)}`;
  const rowLine = (k: string, v: string) => `<tr><td style="padding:2px 0;color:#444">${esc(k)}</td><td style="padding:2px 0;text-align:right;font-weight:600">${esc(v)}</td></tr>`;
  const one = `<section style="break-inside:avoid;page-break-after:always;padding:6px 0;font-size:12px">
    <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:6px">
      <div style="font-size:15px;font-weight:700">${esc(company.name || tr("Biashara"))}</div>
      ${company.address ? `<div>${esc(company.address)}</div>` : ""}${company.phone ? `<div>${esc(company.phone)}</div>` : ""}
      <div style="margin-top:4px;font-weight:700">${esc(tr("Sold Item Report"))}</div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      ${rowLine(tr("Invoice"), String(row[tr("Invoice")] ?? row.Invoice ?? ""))}
      ${rowLine(tr("Tarehe"), String(row.Tarehe ?? ""))}
      ${rowLine(tr("Mteja"), String(row.Mteja ?? ""))}
      ${rowLine(tr("Code"), String(row.Code ?? ""))}
      ${rowLine(tr("Bidhaa"), String(row.Bidhaa ?? ""))}
      ${rowLine(tr("Qty"), fmt(num(row.Qty), 4))}
      ${rowLine(tr("Bei/kipande"), money(row["Bei/kipande"]))}
      ${rowLine(tr("Discount"), money(row.Discount))}
    </table>
    <div style="display:flex;justify-content:space-between;border-top:1px dashed #000;margin-top:6px;padding-top:6px;font-size:14px;font-weight:700"><span>${esc(tr("Jumla"))}</span><span>${esc(money(row.Jumla))}</span></div>
  </section>`;
  const el = document.createElement("div");
  el.innerHTML = one.repeat(Math.max(1, copies));
  printElement(el, paper);
}

const selectClass = "h-10 rounded-md border bg-background px-3";
// Report screens about product sales / invoices that carry the "search invoice by number" box.
const INVOICE_SEARCH_PATHS = ["reports/product-client", "reports/by-product", "reports/sold-items", "reports/invoices"];
const TITLES: Record<string, string> = {
  payments: tr("Payment Received"), "clients/list": tr("List of Clients"), "reports/invoices": tr("Invoice Report"), "reports/summary": tr("Summary Sales Report"),
  "reports/client-statement": tr("Client Statement"), "reports/analysis": tr("Sales Analysis"), "reports/tax": tr("Sales Tax Report"), "reports/payments": tr("Sales Payment Report"),
  "reports/by-client": tr("Sales by Client"), "reports/by-product": tr("Sales by Product"), "reports/client-product": tr("Client Sales Product"), "reports/product-client": tr("Product Sales by Client"),
  "reports/staff": tr("Staff Sales Report"), "reports/sold-items": tr("Sold Item Report"), "reports/by-supplier": tr("Sales by Supplier"), "reports/source": tr("Sales Source Report"),
};

export default function SalesRegister() {
  const navigate = useNavigate();
  const path = useLocation().pathname.split("/").filter(Boolean).slice(1).join("/");
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(today());
  const [clientId, setClientId] = useState("");
  const needsLines = [ "reports/analysis", "reports/by-product", "reports/client-product", "reports/product-client", "reports/sold-items", "reports/by-supplier" ].includes(path);
  // Only the report screens read the report query (sales.reports.view). Everyday screens (payments, clients list, register totals)
  // use the basic one (sales.view), which never carries cost, profit or supplier data.
  const isReport = path.startsWith("reports/");
  const reportData = useQuery(api.sales.salesRegisters, isReport ? { startDate: start, endDate: end, withLines: needsLines } : "skip");
  const basicData = useQuery(api.sales.salesRegisterBasic, isReport ? "skip" : { startDate: start, endDate: end });
  const data = isReport ? reportData : basicData;
  const recordPayment = useMutation(api.sales.recordPayment);
  const [pay, setPay] = useState({ invoiceId: "", date: today(), filterClient: "" });
  const methods = usePaymentMethods();
  const [payLines, setPayLines] = useState<SplitLine[]>([newSplitLine(methods)]);
  const [busy, setBusy] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<null | { reference: string; date: string; party: string; amount: number; method: string }>(null);
  const title = TITLES[path] ?? tr("Sales Register");

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
      <div><Button variant="outline" onClick={() => navigate("/sales")}>{tr("← Sales")}</Button><h1 className="mt-3 text-2xl font-bold">{title}</h1></div>
      <DateRange startDate={start} endDate={end} onStart={setStart} onEnd={setEnd} />
    </div>
  );
  if (!data) return <div className="mx-auto max-w-7xl space-y-5 p-5">{header}<div className="p-6 text-sm text-muted-foreground">{tr("Inapakia taarifa za Sales…")}</div></div>;

  const { invoices, lines, payments, clients, balances, totals } = data;
  let rows: Row[] = [];
  let sumCols: string[] = [];
  let note: string | undefined;

  switch (path) {
    case "clients/list":
      rows = clients.map((c) => ({ Code: c.code, Jina: c.name, Simu: c.phone || "—", "Contact": c.contactPerson || "—", "Credit Policy": trValue(c.creditPolicy), Hali: c.isActive ? tr("Active") : tr("Imezimwa"), Balance: balances.find((b) => b.clientId === c._id)?.closing ?? 0 }));
      sumCols = [tr("Balance")]; note = tr("Balance = deni la mwanzo + invoices − malipo, hadi tarehe ya “Mpaka”."); break;
    case "reports/invoices":
      rows = invoices.map((x) => ({ Invoice: x.invoiceNo, Tarehe: x.date, Mteja: x.clientName, Staff: x.staff, Jumla: x.total, Imelipwa: x.amountPaid, Deni: x.outstanding, Hali: x.paymentStatus }));
      sumCols = [tr("Jumla"), tr("Imelipwa"), tr("Deni")]; break;
    case "reports/summary":
      rows = groupRows(invoices, (x) => x.date, (x) => ({ Tarehe: x.date, Invoices: 0, Subtotal: 0, Discount: 0, Tax: 0, Jumla: 0, Imelipwa: 0, Deni: 0 }), (a, x) => { a.Invoices = num(a.Invoices) + 1; a.Subtotal = round2(num(a.Subtotal) + x.subtotal); a.Discount = round2(num(a.Discount) + x.discount); a.Tax = round2(num(a.Tax) + x.taxAmount); a.Jumla = round2(num(a.Jumla) + x.total); a.Imelipwa = round2(num(a.Imelipwa) + x.amountPaid); a.Deni = round2(num(a.Deni) + x.outstanding); }).sort((a, b) => String(b.Tarehe).localeCompare(String(a.Tarehe)));
      sumCols = [tr("Invoices"), tr("Subtotal"), tr("Discount"), tr("Tax"), tr("Jumla"), tr("Imelipwa"), tr("Deni")]; break;
    case "reports/analysis":
      rows = groupRows(invoices, (x) => x.date.slice(0, 7), (x) => ({ Mwezi: x.date.slice(0, 7), Invoices: 0, "Mauzo (bila tax)": 0, "Cost ya mauzo": 0, Faida: 0, "Margin %": 0 }), () => undefined)
        .map((r) => { const ls = lines.filter((l) => l.date.slice(0, 7) === r.Mwezi); const sales = round2(ls.reduce((n, l) => n + l.net, 0)); const cost = round2(ls.reduce((n, l) => n + l.cost, 0)); return { ...r, Invoices: invoices.filter((i) => i.date.slice(0, 7) === r.Mwezi).length, "Mauzo (bila tax)": sales, "Cost ya mauzo": cost, Faida: round2(sales - cost), "Margin %": sales > 0 ? round2(((sales - cost) / sales) * 100) : 0 }; }).sort((a, b) => String(b.Mwezi).localeCompare(String(a.Mwezi)));
      sumCols = [tr("Invoices"), tr("Mauzo (bila tax)"), tr("Cost ya mauzo"), tr("Faida")]; break;
    case "reports/tax":
      rows = invoices.map((x) => ({ Invoice: x.invoiceNo, Tarehe: x.date, Mteja: x.clientName, "Taxable": round2(x.total - x.taxAmount), Tax: x.taxAmount, Jumla: x.total }));
      sumCols = [tr("Taxable"), tr("Tax"), tr("Jumla")]; break;
    case "reports/payments":
      rows = payments.map((p) => ({ Tarehe: p.date, Mteja: p.clientName, Invoice: p.invoiceNo, Kiasi: p.amount, Njia: trValue(p.method), Reference: p.reference || "—", Maelezo: p.notes || "—" }));
      sumCols = [tr("Kiasi")]; break;
    case "reports/by-client":
      rows = groupRows(invoices, (x) => String(x.clientId), (x) => ({ Mteja: x.clientName, Invoices: 0, Jumla: 0, Imelipwa: 0, Deni: 0 }), (a, x) => { a.Invoices = num(a.Invoices) + 1; a.Jumla = round2(num(a.Jumla) + x.total); a.Imelipwa = round2(num(a.Imelipwa) + x.amountPaid); a.Deni = round2(num(a.Deni) + x.outstanding); }).sort((a, b) => num(b.Jumla) - num(a.Jumla));
      sumCols = [tr("Invoices"), tr("Jumla"), tr("Imelipwa"), tr("Deni")]; break;
    case "reports/by-product":
      rows = groupRows(lines, (l) => String(l.productId), (l) => ({ Code: l.itemCode, Bidhaa: l.productName, Unit: l.unit, Qty: 0, "Mauzo (bila tax)": 0, Cost: 0, Faida: 0 }), (a, l) => { a.Qty = round2(num(a.Qty) + l.qty); a["Mauzo (bila tax)"] = round2(num(a["Mauzo (bila tax)"]) + l.net); a.Cost = round2(num(a.Cost) + l.cost); a.Faida = round2(num(a.Faida) + l.profit); }).sort((a, b) => num(b["Mauzo (bila tax)"]) - num(a["Mauzo (bila tax)"]));
      sumCols = [tr("Mauzo (bila tax)"), tr("Cost"), tr("Faida")]; break;
    case "reports/client-product":
    case "reports/product-client": {
      const byClientFirst = path === "reports/client-product";
      rows = groupRows(lines, (l) => `${l.clientId}|${l.productId}`, (l) => (byClientFirst ? { Mteja: l.clientName, Bidhaa: l.productName, Qty: 0, Mauzo: 0 } : { Bidhaa: l.productName, Mteja: l.clientName, Qty: 0, Mauzo: 0 }), (a, l) => { a.Qty = round2(num(a.Qty) + l.qty); a.Mauzo = round2(num(a.Mauzo) + l.net); }).sort((a, b) => String(byClientFirst ? a.Mteja : a.Bidhaa).localeCompare(String(byClientFirst ? b.Mteja : b.Bidhaa)));
      sumCols = [tr("Mauzo")]; break;
    }
    case "reports/staff":
      rows = groupRows(invoices, (x) => x.staff, (x) => ({ Staff: x.staff, Invoices: 0, Jumla: 0, Imelipwa: 0, Deni: 0 }), (a, x) => { a.Invoices = num(a.Invoices) + 1; a.Jumla = round2(num(a.Jumla) + x.total); a.Imelipwa = round2(num(a.Imelipwa) + x.amountPaid); a.Deni = round2(num(a.Deni) + x.outstanding); }).sort((a, b) => num(b.Jumla) - num(a.Jumla));
      sumCols = [tr("Invoices"), tr("Jumla"), tr("Imelipwa"), tr("Deni")]; break;
    case "reports/sold-items":
      rows = lines.map((l) => ({ Tarehe: l.date, Invoice: l.invoiceNo, Mteja: l.clientName, Code: l.itemCode, Bidhaa: l.productName, Qty: l.qty, "Bei/kipande": l.unitPrice, Discount: l.discount, Jumla: l.net }));
      sumCols = [tr("Jumla")]; break;
    case "reports/by-supplier":
      rows = groupRows(lines, (l) => l.supplierName, (l) => ({ Supplier: l.supplierName, Qty: 0, "Mauzo (bila tax)": 0, Cost: 0, Faida: 0 }), (a, l) => { a.Qty = round2(num(a.Qty) + l.qty); a["Mauzo (bila tax)"] = round2(num(a["Mauzo (bila tax)"]) + l.net); a.Cost = round2(num(a.Cost) + l.cost); a.Faida = round2(num(a.Faida) + l.profit); }).sort((a, b) => num(b["Mauzo (bila tax)"]) - num(a["Mauzo (bila tax)"]));
      sumCols = [tr("Mauzo (bila tax)"), tr("Cost"), tr("Faida")]; note = tr("Supplier ni wa mwisho aliyewasilisha bidhaa husika (kutoka kwenye Purchase/GRN ya mwisho)."); break;
    case "reports/source":
      rows = groupRows(invoices, (x) => x.source, (x) => ({ Chanzo: trValue(x.source), Invoices: 0, Jumla: 0, Imelipwa: 0 }), (a, x) => { a.Invoices = num(a.Invoices) + 1; a.Jumla = round2(num(a.Jumla) + x.total); a.Imelipwa = round2(num(a.Imelipwa) + x.amountPaid); }).sort((a, b) => num(b.Jumla) - num(a.Jumla));
      sumCols = [tr("Invoices"), tr("Jumla"), tr("Imelipwa")]; break;
    case "reports/client-statement": {
      const bal = balances.find((b) => b.clientId === clientId);
      if (clientId && bal) {
        const entries = [
          ...invoices.filter((i) => i.clientId === clientId).map((i) => ({ date: i.date, ref: i.invoiceNo, desc: tr("Invoice"), debit: i.total, credit: 0 })),
          ...payments.filter((p) => p.clientId === clientId).map((p) => ({ date: p.date, ref: p.invoiceNo, desc: tr("Malipo ({0})", [p.method]), debit: 0, credit: p.amount })),
        ].sort((a, b) => a.date.localeCompare(b.date) || a.debit - b.debit);
        let running = bal.before;
        rows = [{ Tarehe: "—", Reference: "", Maelezo: tr("Salio la kuanzia"), Debit: 0, Credit: 0, Balance: bal.before }, ...entries.map((e) => { running = round2(running + e.debit - e.credit); return { Tarehe: e.date, Reference: e.ref, Maelezo: e.desc, Debit: e.debit, Credit: e.credit, Balance: running }; })];
      }
      break;
    }
  }

  const paymentForm = path === "payments" && (
    <section className="space-y-4 rounded-xl border p-5">
      <h2 className="font-semibold">{tr("Rekodi malipo ya mteja")}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">{tr("Mteja (chuja)")}
          <select className={selectClass} value={pay.filterClient} onChange={(e) => setPay({ ...pay, filterClient: e.target.value, invoiceId: "" })}><option value="">{tr("Wote wenye deni")}</option>{clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
        </label>
        <label className="grid gap-1 text-sm">{tr("Invoice yenye deni")}
          <select className={selectClass} value={pay.invoiceId} onChange={(e) => { const inv = data.openInvoices.find((x) => x._id === e.target.value); setPay({ ...pay, invoiceId: e.target.value }); setPayLines([newSplitLine(methods, inv ? String(inv.outstanding) : "")]); }}>
            <option value="">{tr("-- Chagua invoice --")}</option>
            {data.openInvoices.filter((i) => !pay.filterClient || i.clientId === pay.filterClient).map((i) => <option key={i._id} value={i._id}>{i.invoiceNo} — {i.clientName}  {tr("— deni")} {fmt(i.outstanding)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">{tr("Tarehe")}<Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></label>
        <PaymentSplit methods={methods} lines={payLines} onChange={setPayLines} due={data.openInvoices.find((x) => x._id === pay.invoiceId)?.outstanding} />
      </div>
      <Button disabled={busy} onClick={() => void (async () => {
        if (!pay.invoiceId) { toast.error(tr("Chagua invoice yenye deni.")); return; }
        const total = splitsTotal(payLines);
        if (!(total > 0)) { toast.error(tr("Weka kiasi sahihi.")); return; }
        const invoice = data.openInvoices.find((x) => x._id === pay.invoiceId);
        if (invoice && total > invoice.outstanding + 1e-8) { toast.error(tr("Jumla ya malipo imezidi deni la invoice.")); return; }
        setBusy(true);
        try { const r = await recordPayment({ invoiceId: pay.invoiceId as Id<"invoices">, splits: toSplits(payLines, methods), paymentDate: pay.date }); setLastReceipt({ reference: payLines.map((l) => l.reference.trim()).find(Boolean) || r.receiptNo || invoice?.invoiceNo || "PAYMENT", date: pay.date, party: invoice?.clientName || "—", amount: total, method: describeSplits(payLines, methods) }); toast.success(tr("Malipo yamehifadhiwa.")); setPay({ ...pay, invoiceId: "" }); setPayLines([newSplitLine(methods)]); }
        catch (e) { toast.error(errorText(e, "Imeshindikana kuhifadhi malipo.")); }
        finally { setBusy(false); }
      })()}>{busy ? tr("Inahifadhi…") : tr("Hifadhi Malipo")}</Button>
    </section>
  );

  const statementPicker = path === "reports/client-statement" && (
    <label className="grid max-w-md gap-1 text-sm print:hidden">{tr("Mteja")}
      <select className={selectClass} value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">{tr("-- Chagua mteja --")}</option>{clients.map((c) => <option key={c._id} value={c._id}>{c.name} ({c.code})</option>)}</select>
    </label>
  );

  const listRows = path === "payments" ? payments.map((p) => ({ Tarehe: p.date, Mteja: p.clientName, Invoice: p.invoiceNo, Kiasi: p.amount, Njia: trValue(p.method), Reference: p.reference || "—" })) : rows;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      {header}
      {data.truncated && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">{tr("Kipindi hiki kina data nyingi sana; baadhi ya rekodi hazijaonyeshwa. Chagua kipindi kifupi zaidi ili kupata jumla kamili.")}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={tr("Invoices")} value={totals.invoices} /><Stat label={tr("Mauzo (jumla)")} value={totals.sales} /><Stat label={tr("Tax")} value={totals.tax} /><Stat label={tr("Malipo yaliyopokelewa")} value={totals.payments} /><Stat label={tr("Deni la invoices")} value={totals.outstanding} />{totals.waiterDebt > 0 && <Stat label={tr("Madeni ya wahudumu (yaliyotokea)")} value={totals.waiterDebt} />}{totals.waiterDebtOpen > 0 && <Stat label={tr("Madeni ya wahudumu (bado yamebaki)")} value={totals.waiterDebtOpen} />}
      </div>
      {INVOICE_SEARCH_PATHS.includes(path) && <InvoiceFinder />}
      {paymentForm}
      {lastReceipt && <TransactionReceipt title={tr("RISITI YA MALIPO YA MAUZO")} reference={lastReceipt.reference} date={lastReceipt.date} partyLabel={tr("Mteja")} party={lastReceipt.party} amount={lastReceipt.amount} method={lastReceipt.method} note={tr("Malipo yamepokelewa. Hifadhi risiti hii kwa kumbukumbu.")} />}
      {statementPicker}
      {path === "reports/client-statement" && !clientId ? <p className="text-sm text-muted-foreground">{tr("Chagua mteja kuona statement yake.")}</p> : <ReportTable title={title === "Payment Received" ? tr("Malipo yaliyopokelewa") : title} rows={listRows} sumCols={path === "payments" ? ["Kiasi"] : sumCols} note={note} onPrintRow={path === "reports/sold-items" ? (row, copies, paper) => printSoldItem(row, copies, paper, data.company) : undefined} />}
    </div>
  );
}
