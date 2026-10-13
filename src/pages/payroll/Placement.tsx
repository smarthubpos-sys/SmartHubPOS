import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, LayoutList } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, PageHeader, Panel, SelectBox, Table } from "@/components/page-kit.tsx";
import { errorText, tr, trValue } from "@/lib/i18n.ts";

function Row({ e }: { e: Doc<"employees"> }) {
  const update = useMutation(api.hr.updateEmployee);
  const [v, setV] = useState({ department: e.department ?? "", position: e.position ?? "", salaryType: e.salaryType, basicSalary: String(e.basicSalary) });
  const [busy, setBusy] = useState(false);
  const dirty = v.department !== (e.department ?? "") || v.position !== (e.position ?? "") || v.salaryType !== e.salaryType || Number(v.basicSalary) !== e.basicSalary;
  async function save() {
    setBusy(true);
    try {
      await update({ id: e._id, name: e.name, startDate: e.startDate, phone: e.phone, email: e.email, address: e.address, taxId: e.taxId, bankAccount: e.bankAccount, notes: e.notes, isActive: e.isActive, department: v.department || undefined, position: v.position || undefined, salaryType: v.salaryType, basicSalary: Number(v.basicSalary) });
      toast.success(tr("Taarifa imehifadhiwa kikamilifu."));
    } catch (err) { toast.error(errorText(err, "Imeshindikana kuhifadhi taarifa.")); } finally { setBusy(false); }
  }
  return (
    <tr>
      <td className="whitespace-nowrap">{e.employeeCode}</td><td className="font-medium">{e.name}</td>
      <td><Input className="h-8 min-w-32" value={v.department} onChange={(x) => setV({ ...v, department: x.target.value })} /></td>
      <td><Input className="h-8 min-w-32" value={v.position} onChange={(x) => setV({ ...v, position: x.target.value })} /></td>
      <td><SelectBox className="h-8" value={v.salaryType} onChange={(x) => setV({ ...v, salaryType: x.target.value })}>{["monthly", "daily", "hourly"].map((s) => <option key={s} value={s}>{trValue(s)}</option>)}</SelectBox></td>
      <td><Input className="h-8 w-28" type="number" min="0" value={v.basicSalary} onChange={(x) => setV({ ...v, basicSalary: x.target.value })} /></td>
      <td className="text-right"><Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>{tr("Hifadhi")}</Button></td>
    </tr>
  );
}

export default function Placement() {
  const navigate = useNavigate();
  const employees = useQuery(api.payroll.listEmployees);
  const list = (employees ?? []).filter((e) => e.isActive);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Button variant="outline" onClick={() => navigate("/payroll")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Payroll")}</Button>
      <PageHeader icon={LayoutList} title={tr("Payroll Placement")} subtitle={tr("Weka kila mfanyakazi kwenye idara, nafasi na aina ya mshahara.")} />
      <Panel>{list.length === 0 ? <Empty>{tr("Bado hakuna mfanyakazi.")}</Empty> : <Table head={[tr("Msimbo"), tr("Jina"), tr("Idara"), tr("Position"), tr("Salary type"), tr("Basic salary"), ""]}>{list.map((e) => <Row key={e._id} e={e} />)}</Table>}</Panel>
    </div>
  );
}
