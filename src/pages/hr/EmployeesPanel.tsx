import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Fingerprint, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, Panel, Pill, SelectBox, Table, useSubmit } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { localDate } from "@/lib/format.ts";
import { errorText, tr, trValue } from "@/lib/i18n.ts";
import { biometricError, biometricSupported, createCredential } from "@/lib/webauthn.ts";

type Employee = Doc<"employees">;
const blank = { employeeCode: "", name: "", startDate: localDate(), basicSalary: "", salaryType: "monthly", phone: "", email: "", position: "", department: "", taxId: "", bankAccount: "", isActive: true };

/** Employee list + add/edit form + fingerprint/Face ID enrolment. Used by HR and Payroll. */
export default function EmployeesPanel() {
  const employees = useQuery(api.payroll.listEmployees);
  const credentials = useQuery(api.biometric.listCredentials);
  const createEmployee = useMutation(api.payroll.createEmployee);
  const updateEmployee = useMutation(api.hr.updateEmployee);
  const registerOptions = useMutation(api.biometric.registerOptions);
  const finishRegistration = useMutation(api.biometric.finishRegistration);
  const removeCredential = useMutation(api.biometric.removeCredential);
  const { money } = useMoney();
  const { busy, run } = useSubmit();
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const [f, setF] = useState(blank);
  const list = employees ?? [];
  const credsOf = (id: string) => (credentials ?? []).filter((c) => String(c.employeeId) === id);

  function startNew() {
    const next = list.reduce((m, e) => { const x = /^EMP-(\d+)$/.exec(e.employeeCode); return x ? Math.max(m, Number(x[1])) : m; }, 0) + 1;
    setF({ ...blank, employeeCode: `EMP-${String(next).padStart(3, "0")}` });
    setEditing("new");
  }
  function startEdit(e: Employee) {
    setF({ employeeCode: e.employeeCode, name: e.name, startDate: e.startDate, basicSalary: String(e.basicSalary), salaryType: e.salaryType, phone: e.phone ?? "", email: e.email ?? "", position: e.position ?? "", department: e.department ?? "", taxId: e.taxId ?? "", bankAccount: e.bankAccount ?? "", isActive: e.isActive });
    setEditing(e);
  }
  async function save() {
    const base = { name: f.name, startDate: f.startDate, basicSalary: Number(f.basicSalary), salaryType: f.salaryType, phone: f.phone || undefined, email: f.email || undefined, position: f.position || undefined, department: f.department || undefined };
    const ok = await run(() => editing === "new" || editing === null
      ? createEmployee({ employeeCode: f.employeeCode.trim(), ...base })
      : updateEmployee({ id: editing._id, ...base, taxId: f.taxId || undefined, bankAccount: f.bankAccount || undefined, isActive: f.isActive }));
    if (ok) setEditing(null);
  }
  async function enroll(e: Employee) {
    if (!biometricSupported()) { toast.error(tr("Kifaa au kivinjari hiki hakitumii alama ya kidole/uso. Tumia HTTPS na kivinjari cha kisasa.")); return; }
    await run(async () => {
      const opts = await registerOptions({ employeeId: e._id });
      try {
        const c = await createCredential(opts.challenge, opts.employee, opts.exclude);
        await finishRegistration({ employeeId: e._id, challenge: opts.challenge, credentialId: c.credentialId, publicKey: c.publicKey, algorithm: c.algorithm, clientDataJSON: c.clientDataJSON, label: navigator.platform });
      } catch (err) { throw err instanceof DOMException ? biometricError(err) : err; }
    }, tr("Alama ya kidole/uso imesajiliwa kwa {0}.", [e.name]));
  }

  return (
    <div className="space-y-4">
      {editing && (
        <Panel title={editing === "new" ? tr("Mfanyakazi mpya") : tr("Badilisha mfanyakazi")}>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label={tr("Msimbo wa mfanyakazi")}><Input value={f.employeeCode} disabled={editing !== "new"} onChange={(e) => setF({ ...f, employeeCode: e.target.value })} /></FormField>
            <FormField label={tr("Full name")}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
            <FormField label={tr("Start date")}><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></FormField>
            <FormField label={tr("Basic salary")}><Input type="number" min="0" value={f.basicSalary} onChange={(e) => setF({ ...f, basicSalary: e.target.value })} /></FormField>
            <FormField label={tr("Salary type")}><SelectBox value={f.salaryType} onChange={(e) => setF({ ...f, salaryType: e.target.value })}>{["monthly", "daily", "hourly"].map((s) => <option key={s} value={s}>{trValue(s)}</option>)}</SelectBox></FormField>
            <FormField label={tr("Position")}><Input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></FormField>
            <FormField label={tr("Idara")}><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></FormField>
            <FormField label={tr("Phone")}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormField>
            <FormField label={tr("Barua pepe")}><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></FormField>
            {editing !== "new" && <>
              <FormField label={tr("Namba ya mlipakodi (TIN)")}><Input value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} /></FormField>
              <FormField label={tr("Akaunti ya benki")}><Input value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value })} /></FormField>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />{tr("Anafanya kazi")}</label>
            </>}
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || !f.name.trim() || !f.employeeCode.trim() || f.basicSalary === ""} onClick={() => void save()}>{tr("Hifadhi")}</Button>
            <Button variant="outline" onClick={() => setEditing(null)}>{tr("Cancel")}</Button>
          </div>
        </Panel>
      )}
      <Panel title={tr("Employees")} actions={<Button size="sm" onClick={startNew}><Plus className="mr-1 h-4 w-4" />{tr("Mfanyakazi mpya")}</Button>}>
        {list.length === 0 ? <Empty>{tr("Bado hakuna mfanyakazi.")}</Empty> : (
          <Table head={[tr("Msimbo"), tr("Jina"), tr("Position"), tr("Idara"), tr("Salary type"), tr("Basic salary"), tr("Alama ya kidole/uso"), tr("Hali"), ""]}>
            {list.map((e) => {
              const creds = credsOf(String(e._id));
              return (
                <tr key={e._id}>
                  <td className="whitespace-nowrap">{e.employeeCode}</td><td className="font-medium">{e.name}</td><td>{e.position}</td><td>{e.department}</td>
                  <td>{trValue(e.salaryType)}</td><td className="whitespace-nowrap">{money(e.basicSalary)}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {creds.length ? <Pill tone="green">{tr("Imesajiliwa ({0})", [creds.length])}</Pill> : <Pill>{tr("Haijasajiliwa")}</Pill>}
                      <Button size="sm" variant="outline" disabled={busy || !e.isActive} onClick={() => void enroll(e)} title={tr("Sajili alama ya kidole / uso")}><Fingerprint className="h-4 w-4" /></Button>
                      {creds.map((c) => <button key={c._id} className="cursor-pointer rounded p-1 text-muted-foreground hover:text-destructive" title={tr("Ondoa alama hii")} onClick={() => { if (window.confirm(tr("Ondoa alama hii ya kidole/uso?"))) void removeCredential({ id: c._id }).catch((err) => toast.error(errorText(err, "Hitilafu imetokea."))); }}><Trash2 className="h-3.5 w-3.5" /></button>)}
                    </div>
                  </td>
                  <td><Pill tone={e.isActive ? "green" : "gray"}>{e.isActive ? trValue("active") : trValue("inactive")}</Pill></td>
                  <td className="text-right"><Button size="sm" variant="ghost" onClick={() => startEdit(e)}><Pencil className="h-4 w-4" /></Button></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
    </div>
  );
}
