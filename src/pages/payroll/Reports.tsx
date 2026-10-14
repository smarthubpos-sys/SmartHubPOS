import { useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart2 } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { FormField, PageHeader, Panel, SelectBox } from "@/components/page-kit.tsx";
import { ReportTable } from "@/pages/shared/report.tsx";
import type { Row } from "@/pages/shared/report-utils.ts";
import { tr, trValue } from "@/lib/i18n.ts";

export default function PayrollReports({ mode }: { mode: "summary" | "payments" | "employee" }) {
  const navigate = useNavigate();
  const records = useQuery(api.payroll.listRecords, {});
  const employees = useQuery(api.payroll.listEmployees);
  const [employeeId, setEmployeeId] = useState("");
  const all = records ?? [];

  const K = { period: tr("Kipindi"), employee: tr("Mfanyakazi"), count: tr("Wafanyakazi"), gross: tr("Gross"), ded: tr("Makato"), net: tr("Net"), status: tr("Hali"), date: tr("Tarehe") };
  let rows: Row[];
  let title: string;
  let sum: string[];
  if (mode === "summary") {
    title = tr("Payroll Report");
    const by = new Map<string, Row>();
    for (const r of all) {
      const cur = by.get(String(r.periodId)) ?? { [K.period]: r.periodName, [K.count]: 0, [K.gross]: 0, [K.ded]: 0, [K.net]: 0 };
      cur[K.count] = Number(cur[K.count]) + 1; cur[K.gross] = Number(cur[K.gross]) + r.grossPay; cur[K.ded] = Number(cur[K.ded]) + r.totalDeductions; cur[K.net] = Number(cur[K.net]) + r.netPay;
      by.set(String(r.periodId), cur);
    }
    rows = [...by.values()]; sum = [K.count, K.gross, K.ded, K.net];
  } else if (mode === "payments") {
    title = tr("Payroll Payment Report");
    rows = all.filter((r) => r.paymentStatus === "paid").map((r) => ({ [K.date]: (r.paidAt ?? "").slice(0, 10), [K.period]: r.periodName, [K.employee]: r.employeeName, [K.net]: r.netPay }));
    sum = [K.net];
  } else {
    title = tr("Employee Statement");
    rows = all.filter((r) => String(r.employeeId) === employeeId).map((r) => ({ [K.period]: r.periodName, [K.gross]: r.grossPay, [K.ded]: r.totalDeductions, [K.net]: r.netPay, [K.status]: trValue(r.paymentStatus) }));
    sum = [K.gross, K.ded, K.net];
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Button variant="outline" onClick={() => navigate("/payroll")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Payroll")}</Button>
      <PageHeader icon={BarChart2} title={title} />
      {mode === "employee" && <Panel><FormField label={tr("Mfanyakazi")}><SelectBox value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">{tr("-- Select --")}</option>{(employees ?? []).map((e) => <option key={e._id} value={e._id}>{e.name}</option>)}</SelectBox></FormField></Panel>}
      <ReportTable title={title} rows={rows} sumCols={sum} />
    </div>
  );
}
