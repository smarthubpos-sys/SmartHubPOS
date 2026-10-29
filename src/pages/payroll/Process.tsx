import { useSubmit } from "@/components/use-submit.ts";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, DollarSign } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, PageHeader, Panel, Pill, SelectBox, Stat, Table } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { formatDate } from "@/lib/format.ts";
import { methodArgs, pickMethodKey, usePaymentMethods } from "@/hooks/use-payment-methods.ts";
import { tr, trValue } from "@/lib/i18n.ts";

function monthRange() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1), end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const iso = (x: Date) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), name: `${tr("Mishahara")} ${d.toLocaleDateString(undefined, { month: "long", year: "numeric" })}` };
}
const methodLabel = (m: string) => ({ cash: tr("Fedha taslimu"), bank: tr("Benki"), mobile: tr("Pesa za simu") } as Record<string, string>)[m] ?? m;

export default function ProcessPayroll() {
  const navigate = useNavigate();
  const periods = useQuery(api.payroll.listPeriods);
  const process = useMutation(api.payroll.processPayroll);
  const approve = useMutation(api.payroll.approvePayroll);
  const pay = useMutation(api.payroll.markPayrollPaid);
  const { money } = useMoney();
  const methods = usePaymentMethods();
  const { busy, run } = useSubmit();
  const m = monthRange();
  const [f, setF] = useState({ name: m.name, start: m.start, end: m.end, rate: "0", other: "0" });
  const [method, setMethod] = useState("bank");
  const [openId, setOpenId] = useState<Id<"payrollPeriods"> | null>(null);
  const records = useQuery(api.payroll.listRecords, openId ? { periodId: openId } : "skip");

  const list = periods ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Button variant="outline" onClick={() => navigate("/payroll")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Payroll")}</Button>
      <PageHeader icon={DollarSign} title={tr("Process Payroll")} subtitle={tr("Mshahara wa kila mwezi, siku au saa huhesabiwa kutoka kwenye mahudhurio na likizo bila malipo.")} />

      <Panel title={tr("Calculate payroll")}>
        <div className="grid gap-3 md:grid-cols-5">
          <FormField label={tr("Period name")} className="md:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <FormField label={tr("Start date")}><Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></FormField>
          <FormField label={tr("End date")}><Input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></FormField>
          <FormField label={tr("Kiwango cha makato (%) — weka kiwango kilichoidhinishwa")}><Input type="number" min="0" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></FormField>
          <FormField label={tr("Other deductions per employee")}><Input type="number" min="0" value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} /></FormField>
        </div>
        <div className="mt-3"><Button disabled={busy || !f.name.trim()} onClick={() => void run(() => process({ name: f.name.trim(), startDate: f.start, endDate: f.end, deductionRatePercent: Number(f.rate) || 0, otherDeductionPerEmployee: Number(f.other) || 0 }), tr("Mishahara imehesabiwa."))}>{tr("Calculate payroll")}</Button></div>
      </Panel>

      <Panel title={tr("Vipindi vya mishahara")} actions={<div className="flex items-center gap-2 text-xs"><span>{tr("Lipa kupitia:")}</span><SelectBox className="h-8 w-44" value={pickMethodKey(methods, method, "bank")} onChange={(e) => setMethod(e.target.value)}>{methods.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</SelectBox></div>}>
        {list.length === 0 ? <Empty>{tr("No information yet.")}</Empty> : (
          <div className="space-y-2">
            {list.map((p) => (
              <div key={p._id} className="rounded-xl border border-border/60">
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" onClick={() => setOpenId(openId === p._id ? null : p._id)}>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${openId === p._id ? "rotate-180" : ""}`} />
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block text-xs text-muted-foreground">{formatDate(p.startDate)} – {formatDate(p.endDate)}</span></span>
                  </button>
                  <div className="text-right text-xs"><p className="text-muted-foreground">{tr("Jumla halisi")}</p><p className="text-sm font-bold">{money(p.totalNet)}</p></div>
                  <Pill tone={p.status === "paid" ? "green" : p.status === "approved" ? "blue" : "amber"}>{trValue(p.status)}</Pill>
                  {p.status === "draft" && <Button size="sm" disabled={busy} onClick={() => void run(() => approve({ periodId: p._id }), tr("Mishahara imeidhinishwa."))}>{tr("Approve")}</Button>}
                  {p.status === "approved" && <Button size="sm" disabled={busy} onClick={() => void run(() => pay({ periodId: p._id, ...methodArgs(methods, pickMethodKey(methods, method, "bank")) }), tr("Malipo ya mishahara yamerekodiwa."))}>{tr("Confirm payment")}</Button>}
                </div>
                {openId === p._id && (
                  <div className="space-y-3 border-t border-border/60 p-3">
                    <div className="grid grid-cols-3 gap-2"><Stat label={tr("Gross")} value={money(p.totalGross)} tone="blue" /><Stat label={tr("Makato")} value={money(p.totalDeductions)} tone="rose" /><Stat label={tr("Net")} value={money(p.totalNet)} tone="green" /></div>
                    {records && <Table head={[tr("Mfanyakazi"), tr("Gross"), tr("Kuchelewa"), tr("Kutokuwepo"), tr("Makato"), tr("Net"), tr("Hali")]}>{records.map((r) => <tr key={r._id}><td className="font-medium">{r.employeeName}</td><td>{money(r.grossPay)}</td><td>{r.lateCount ? `${money(r.lateDeductions ?? 0)} (${r.lateCount})` : "-"}</td><td>{r.absentDays ? `${money(r.absentDeductions ?? 0)} (${tr("siku {0}", [r.absentDays])})` : "-"}</td><td>{money(r.totalDeductions)}</td><td className="font-semibold">{money(r.netPay)}</td><td><Pill tone={r.paymentStatus === "paid" ? "green" : "amber"}>{trValue(r.paymentStatus)}</Pill></td></tr>)}</Table>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
