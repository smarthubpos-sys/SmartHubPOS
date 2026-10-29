import { useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Printer } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Empty, FormField, PageHeader, Panel, SelectBox } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { formatDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";

export default function Payslip() {
  const navigate = useNavigate();
  const periods = useQuery(api.payroll.listPeriods);
  const settings = useQuery(api.dashboard.getSettings);
  const { money } = useMoney();
  const [periodId, setPeriodId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const records = useQuery(api.payroll.listRecords, periodId ? { periodId: periodId as never } : "skip");
  const shown = (records ?? []).filter((r) => !employeeId || String(r.employeeId) === employeeId);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="outline" onClick={() => navigate("/payroll")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Payroll")}</Button>
        <Button disabled={!shown.length} onClick={() => { document.body.classList.add("print-slip"); window.print(); document.body.classList.remove("print-slip"); }}><Printer className="mr-2 h-4 w-4" />{tr("Chapisha")}</Button>
      </div>
      <div className="print:hidden">
        <PageHeader icon={FileText} title={tr("Payslip")} subtitle={tr("Chagua kipindi na mfanyakazi, kisha chapisha hati ya mshahara.")} />
        <Panel className="mt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label={tr("Period")}><SelectBox value={periodId} onChange={(e) => { setPeriodId(e.target.value); setEmployeeId(""); }}><option value="">{tr("-- Select --")}</option>{(periods ?? []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</SelectBox></FormField>
            <FormField label={tr("Mfanyakazi")}><SelectBox value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!periodId}><option value="">{tr("Wote")}</option>{(records ?? []).map((r) => <option key={r._id} value={String(r.employeeId)}>{r.employeeName}</option>)}</SelectBox></FormField>
          </div>
        </Panel>
      </div>
      {periodId && shown.length === 0 && <Empty>{tr("No information yet.")}</Empty>}
      <div className="print-area space-y-4">
        {shown.map((r) => (
          <article key={r._id} className="break-inside-avoid rounded-2xl border bg-card p-6 print:rounded-none print:border-black print:break-after-page">
            <header className="flex items-start justify-between border-b pb-3">
              <div><h2 className="text-lg font-bold">{settings?.companyName ?? "SmartHubPOS"}</h2><p className="text-xs text-muted-foreground">{tr("Hati ya Mshahara (Payslip)")}</p></div>
              <div className="text-right text-xs"><p className="font-semibold">{r.periodName}</p><p>{formatDate(r.startDate)} – {formatDate(r.endDate)}</p></div>
            </header>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 py-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{tr("Mfanyakazi")}</dt><dd className="font-medium">{r.employeeName}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{tr("Msimbo")}</dt><dd>{r.employeeCode}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{tr("Position")}</dt><dd>{r.position ?? "-"}</dd></div>
            </dl>
            <table className="w-full text-sm">
              <tbody className="[&_td]:py-1.5 [&_tr]:border-b">
                <tr><td>{tr("Basic salary")}</td><td className="text-right">{money(r.basicSalary)}</td></tr>
                <tr><td>{tr("Allowances")}</td><td className="text-right">{money(r.allowances)}</td></tr>
                <tr><td>{tr("Overtime")}</td><td className="text-right">{money(r.overtime)}</td></tr>
                <tr className="font-semibold"><td>{tr("Gross")}</td><td className="text-right">{money(r.grossPay)}</td></tr>
                <tr><td>{tr("Makato")} ({tr("Kodi")})</td><td className="text-right">- {money(r.taxDeduction)}</td></tr>
                {(r.lateDeductions ?? 0) > 0 && <tr><td>{tr("Kuchelewa kazini")} ({r.lateCount ?? 0})</td><td className="text-right">- {money(r.lateDeductions ?? 0)}</td></tr>}
                {(r.absentDeductions ?? 0) > 0 && <tr><td>{tr("Kutokuwepo kazini")} ({tr("siku {0}", [r.absentDays ?? 0])})</td><td className="text-right">- {money(r.absentDeductions ?? 0)}</td></tr>}
                <tr><td>{tr("Makato mengine")}</td><td className="text-right">- {money(Math.max(0, r.otherDeductions - (r.lateDeductions ?? 0) - (r.absentDeductions ?? 0)))}</td></tr>
                <tr className="text-base font-bold"><td>{tr("Jumla halisi")}</td><td className="text-right">{money(r.netPay)}</td></tr>
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </div>
  );
}
