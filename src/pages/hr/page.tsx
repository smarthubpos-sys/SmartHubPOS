import { useSubmit } from "@/components/use-submit.ts";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarCheck, CalendarOff, UserCheck, UserCog, Users } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, PageHeader, Panel, Pill, SelectBox, Stat, Table } from "@/components/page-kit.tsx";
import EmployeesPanel from "@/pages/hr/EmployeesPanel.tsx";
import { formatDate, localDate } from "@/lib/format.ts";
import { tr, trValue } from "@/lib/i18n.ts";
import { LEAVE_TYPES as LEAVE, leaveLabel, targetLabel } from "@/pages/leave/leave-utils.ts";
import { StagePill } from "@/pages/leave/shared.tsx";
const tip = { contentStyle: { borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12 } };

type Tab = "overview" | "employees" | "leave" | "attendance";

function Overview() {
  const o = useQuery(api.hr.overview, { date: localDate() });
  if (!o) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat label={tr("Wafanyakazi wanaofanya kazi")} value={o.active} sub={tr("Jumla {0}", [o.total])} icon={Users} tone="blue" />
        <Stat label={tr("Wapo kazini leo")} value={o.present} icon={UserCheck} tone="green" />
        <Stat label={tr("Wapo likizo leo")} value={o.onLeave} icon={CalendarOff} tone="violet" />
        <Stat label={tr("Maombi ya likizo yanayosubiri")} value={o.pendingLeave} icon={CalendarCheck} tone="amber" />
      </div>
      <Panel title={tr("Wafanyakazi kwa idara")}>
        {o.departments.length === 0 ? <Empty>{tr("Bado hakuna mfanyakazi.")}</Empty> : (
          <div className="h-56"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={o.departments} margin={{ left: -16, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip {...tip} />
              <Bar dataKey="count" name={tr("Wafanyakazi")} fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer></div>
        )}
      </Panel>
    </div>
  );
}

function Leave() {
  const leaves = useQuery(api.hr.listLeave);
  const employees = useQuery(api.payroll.listEmployees);
  const request = useMutation(api.hr.requestLeave);
  const decide = useMutation(api.hr.decideLeave);
  const cancel = useMutation(api.hr.cancelLeave);
  const { busy, run } = useSubmit();
  const [f, setF] = useState({ employeeId: "", leaveType: "annual", startDate: localDate(), endDate: localDate(), reason: "" });
  return (
    <div className="space-y-4">
      <Panel title={tr("Ombi jipya la likizo")}>
        <div className="grid gap-3 md:grid-cols-5">
          <FormField label={tr("Mfanyakazi")} className="md:col-span-2"><SelectBox value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">{tr("-- Select --")}</option>{(employees ?? []).filter((e) => e.isActive).map((e) => <option key={e._id} value={e._id}>{e.name}</option>)}</SelectBox></FormField>
          <FormField label={tr("Aina ya likizo")}><SelectBox value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value })}>{LEAVE.map((k) => <option key={k} value={k}>{leaveLabel(k)}</option>)}</SelectBox></FormField>
          <FormField label={tr("Kuanzia")}><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></FormField>
          <FormField label={tr("Hadi")}><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></FormField>
          <FormField label={tr("Sababu (hiari)")} className="md:col-span-4"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
          <div className="flex items-end"><Button disabled={busy || !f.employeeId} onClick={async () => { const ok = await run(() => request({ employeeId: f.employeeId as never, leaveType: f.leaveType, startDate: f.startDate, endDate: f.endDate, reason: f.reason || undefined }), tr("Ombi la likizo limetumwa.")); if (ok) setF({ ...f, reason: "" }); }}>{tr("Tuma ombi")}</Button></div>
        </div>
      </Panel>
      <Panel title={tr("Maombi ya likizo")}>
        {!leaves || leaves.length === 0 ? <Empty>{tr("Hakuna maombi ya likizo.")}</Empty> : (
          <Table head={[tr("Mfanyakazi"), tr("Aina ya likizo"), tr("Kuanzia"), tr("Hadi"), tr("Siku"), tr("Sababu (hiari)"), tr("Imetumwa kwa"), tr("Hali"), ""]}>
            {leaves.map((l) => (
              <tr key={l._id}>
                <td className="font-medium">{l.employeeName}</td><td>{leaveLabel(l.leaveType)}</td><td className="whitespace-nowrap">{formatDate(l.startDate)}</td><td className="whitespace-nowrap">{formatDate(l.endDate)}</td><td>{l.days}</td><td className="text-xs text-muted-foreground">{l.reason}{l.decisionNote ? ` — ${l.decisionNote}` : ""}</td>
                <td className="whitespace-nowrap text-xs">{l.target ? targetLabel(l.target) : "—"}{l.lateRequest && <> <Pill tone="amber">{tr("Imechelewa kuombwa")}</Pill></>}</td>
                <td><StagePill stage={l.status === "pending" ? ((l as { viewedAt?: string }).viewedAt ? "viewed" : (l as { receivedAt?: string }).receivedAt ? "received" : "sent") : l.status} /></td>
                <td className="whitespace-nowrap text-right">
                  {l.status === "pending" && <><Button size="sm" disabled={busy} onClick={() => void run(() => decide({ id: l._id, approve: true }), tr("Likizo imekubaliwa."))}>{tr("Kubali")}</Button>{" "}<Button size="sm" variant="outline" disabled={busy} onClick={() => { const note = window.prompt(tr("Andika sababu ya kukataa ombi."))?.trim(); if (note && note.length >= 3) void run(() => decide({ id: l._id, approve: false, note }), tr("Likizo imekataliwa.")); }}>{tr("Kataa")}</Button></>}
                  {["pending", "approved"].includes(l.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => cancel({ id: l._id }), tr("Ombi limeghairiwa."))}>{tr("Futa")}</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

function Attendance() {
  const [from, setFrom] = useState(`${localDate().slice(0, 8)}01`);
  const [to, setTo] = useState(localDate());
  const rows = useQuery(api.attendance.range, { from, to });
  return (
    <Panel title={tr("Mahudhurio")} actions={<div className="flex items-center gap-2"><Input type="date" className="h-8 w-36" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" className="h-8 w-36" value={to} onChange={(e) => setTo(e.target.value)} /></div>}>
      {!rows || rows.length === 0 ? <Empty>{tr("Hakuna rekodi za mahudhurio kwenye kipindi hiki.")}</Empty> : (
        <Table head={[tr("Tarehe"), tr("Mfanyakazi"), tr("Muda wa kuingia"), tr("Muda wa kutoka"), tr("Masaa"), tr("Njia")]}>
          {rows.map((r) => <tr key={r._id}><td className="whitespace-nowrap">{formatDate(r.date)}</td><td className="font-medium">{r.employeeName}</td><td>{r.signInTime}</td><td>{r.signOutTime ?? "-"}</td><td>{r.hoursWorked ?? "-"}</td><td>{(r.notes ?? "").includes("biometric") ? <Pill tone="green">{tr("Alama ya kidole/uso")}</Pill> : <Pill>{trValue("manual")}</Pill>}</td></tr>)}
        </Table>
      )}
    </Panel>
  );
}

export default function HRPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: [Tab, string][] = [["overview", tr("Muhtasari")], ["employees", tr("Employees")], ["leave", tr("Likizo")], ["attendance", tr("Mahudhurio")]];
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader icon={UserCog} title={tr("HR")} subtitle={tr("Wafanyakazi, likizo na mahudhurio mahali pamoja.")} />
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium ${tab === k ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md shadow-primary/30" : "bg-card border hover:bg-muted"}`}>{label}</button>)}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "employees" && <EmployeesPanel />}
      {tab === "leave" && <Leave />}
      {tab === "attendance" && <Attendance />}
    </div>
  );
}
