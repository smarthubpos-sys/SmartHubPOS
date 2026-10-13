import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, Loading, PageShell, SelectField, TextField, useRun, useMaintenanceSettings } from "./_shared";
import { tr, trValue } from "@/lib/i18n.ts";

const MONTHS = [tr("Jan"), tr("Feb"), tr("Mar"), tr("Apr"), tr("May"), tr("Jun"), tr("Jul"), tr("Aug"), tr("Sep"), tr("Oct"), tr("Nov"), tr("Dec")];

export default function PeriodsPage() {
  const periods = useQuery(api.maintenance.listPeriods, {});
  const settings = useMaintenanceSettings();
  const create = useMutation(api.maintenance.createPeriod);
  const generate = useMutation(api.maintenance.generateYear);
  const setStatus = useMutation(api.maintenance.setPeriodStatus);
  const del = useMutation(api.maintenance.deletePeriod);
  const { busy, run } = useRun();
  const [f, setF] = useState({ name: "", startDate: "", endDate: "", year: String(new Date().getFullYear()), startMonth: "1" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const ok = settings?.canEdit["maintenance.periods"] ?? false;
  const badge = (s: string) => (s === "open" ? "bg-emerald-500/15 text-emerald-700" : s === "closed" ? "bg-amber-500/15 text-amber-700" : "bg-red-500/15 text-red-700");
  return (
    <PageShell title={tr("Financial Period Settings")} subtitle={tr("Mwaka wa fedha na vipindi (open / closed / locked)")}>
      {ok && (
        <>
          <Card title={tr("Tengeneza vipindi 12 vya mwaka")}>
            <div className="grid items-end gap-4 md:grid-cols-3">
              <TextField label={tr("Mwaka wa kuanza")} type="number" value={f.year} onChange={(v) => set("year", v)} />
              <SelectField label={tr("Mwezi wa kuanza")} value={f.startMonth} onChange={(v) => set("startMonth", v)} options={MONTHS.map((m, i) => [String(i + 1), m] as [string, string])} />
              <Button disabled={busy} onClick={() => void run(async () => { const n = await generate({ year: Number(f.year), startMonth: Number(f.startMonth) }); if (!n) throw new Error(tr("Vipindi hivi vipo tayari.")); }, tr("Vipindi vimetengenezwa."))}>{tr("Tengeneza")}</Button>
            </div>
          </Card>
          <Card title={tr("Ongeza kipindi kimoja")}>
            <div className="grid items-end gap-4 md:grid-cols-4">
              <TextField label={tr("Jina")} value={f.name} onChange={(v) => set("name", v)} />
              <TextField label={tr("Kuanzia")} type="date" value={f.startDate} onChange={(v) => set("startDate", v)} />
              <TextField label={tr("Mpaka")} type="date" value={f.endDate} onChange={(v) => set("endDate", v)} />
              <Button disabled={busy} onClick={() => void run(() => create({ name: f.name, startDate: f.startDate, endDate: f.endDate }))}>{tr("Ongeza")}</Button>
            </div>
          </Card>
        </>
      )}
      <section className="overflow-x-auto rounded-xl border">
        {!periods ? <div className="p-4"><Loading /></div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">{tr("Kipindi")}</th><th className="p-3">{tr("Kuanzia")}</th><th className="p-3">{tr("Mpaka")}</th><th className="p-3">{tr("Hali")}</th><th className="p-3">{tr("Vitendo")}</th></tr></thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p._id} className="border-t">
                  <td className="p-3 font-medium">{p.name}</td><td className="p-3">{p.startDate}</td><td className="p-3">{p.endDate}</td>
                  <td className="p-3"><span className={`rounded px-2 py-0.5 text-xs font-medium ${badge(p.status)}`}>{trValue(p.status)}</span></td>
                  <td className="p-3">
                    {ok && (
                      <div className="flex flex-wrap gap-2">
                        {p.status === "open" && <Button size="sm" variant="outline" onClick={() => void run(() => setStatus({ id: p._id, status: "closed" }), tr("Imefungwa (closed)."))}>{tr("Close")}</Button>}
                        {p.status === "closed" && <>
                          <Button size="sm" variant="outline" onClick={() => void run(() => setStatus({ id: p._id, status: "open" }), tr("Imefunguliwa."))}>{tr("Reopen")}</Button>
                          <Button size="sm" variant="outline" onClick={() => void run(() => setStatus({ id: p._id, status: "locked" }), tr("Imefungwa kabisa (locked)."))}>{tr("Lock")}</Button>
                        </>}
                        {p.status === "locked" && <Button size="sm" variant="outline" onClick={() => void run(() => setStatus({ id: p._id, status: "open" }), tr("Imefunguliwa."))}>{tr("Unlock (Super Admin)")}</Button>}
                        {p.status === "open" && <Button size="sm" variant="outline" onClick={() => { if (confirm(tr("Futa {0}?", [p.name]))) void run(() => del({ id: p._id }), tr("Imefutwa.")); }}>{tr("Futa")}</Button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!periods.length && <tr><td colSpan={5} className="p-4 text-muted-foreground">{tr("Hakuna vipindi bado.")}</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </PageShell>
  );
}
