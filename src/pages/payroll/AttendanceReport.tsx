import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ClockAlert } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useSubmit } from "@/components/use-submit.ts";
import { Empty, FormField, PageHeader, Panel, Pill, Stat, Table } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { formatDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";

function monthRange() {
  const d = new Date();
  const iso = (x: Date) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
}

/** Who was late and who did not come, for a period, with the amounts that will be deducted. */
export default function AttendanceReport() {
  const navigate = useNavigate();
  const { money } = useMoney();
  const { busy, run } = useSubmit();
  const waive = useMutation(api.schedules.waiveLate);
  const [range, setRange] = useState(monthRange());
  const rows = useQuery(api.schedules.report, range.from && range.to && range.to >= range.from ? range : "skip");
  const list = rows ?? [];
  const lateTotal = list.reduce((n, r) => n + r.lateTotal, 0);
  const absentTotal = list.reduce((n, r) => n + r.absentAmount, 0);
  const absentDays = list.reduce((n, r) => n + r.absentDates.length, 0);
  const lateCount = list.reduce((n, r) => n + r.late.filter((l) => !l.waived).length, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Button variant="outline" onClick={() => navigate("/payroll")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Payroll")}</Button>
      <PageHeader icon={ClockAlert} title={tr("Late & Absence Report")} subtitle={tr("Waliochelewa na wasioingia kazini kwa kipindi, pamoja na makato yao.")} />
      <Panel>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label={tr("Start date")}><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></FormField>
          <FormField label={tr("End date")}><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></FormField>
        </div>
      </Panel>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat label={tr("Mara za kuchelewa")} value={lateCount} tone="amber" />
        <Stat label={tr("Makato ya kuchelewa")} value={money(lateTotal)} tone="rose" />
        <Stat label={tr("Siku za kutokuwepo")} value={absentDays} tone="amber" />
        <Stat label={tr("Makato ya kutokuwepo")} value={money(absentTotal)} tone="rose" />
      </div>
      <Panel title={tr("Kwa mfanyakazi")}>
        {rows === undefined ? null : list.length === 0 ? <Empty>{tr("Hakuna mfanyakazi mwenye ratiba bado.")}</Empty> : (
          <div className="space-y-3">
            {list.map((r) => (
              <div key={r.employeeId} className="rounded-xl border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{r.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{r.code}</span></p>
                  <div className="flex gap-2">
                    <Pill tone={r.lateTotal > 0 ? "amber" : "green"}>{tr("Kuchelewa: {0}", [money(r.lateTotal)])}</Pill>
                    <Pill tone={r.absentDates.length > 0 ? "rose" : "green"}>{tr("Kutokuwepo: siku {0}", [r.absentDates.length])}{r.absentAmount > 0 ? ` · ${money(r.absentAmount)}` : ""}</Pill>
                  </div>
                </div>
                {r.late.length > 0 && (
                  <div className="mt-2">
                    <Table head={[tr("Tarehe"), tr("Alitakiwa"), tr("Aliingia"), tr("Dakika"), tr("Kato"), " "]}>
                      {r.late.map((l) => (
                        <tr key={l.id}>
                          <td>{formatDate(l.date)}</td><td>{l.scheduledStart ?? "-"}</td><td>{l.signInTime ?? "-"}</td><td>{l.lateMinutes}</td>
                          <td>{l.waived ? <Pill>{tr("Imefutwa")}</Pill> : money(l.deduction)}</td>
                          <td className="text-right">{!l.waived && l.deduction > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => waive({ attendanceId: l.id as Id<"attendance"> }), tr("Kato limefutwa."))}>{tr("Futa kato")}</Button>}</td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                )}
                {r.absentDates.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{tr("Hakuingia tarehe:")} {r.absentDates.map((d) => formatDate(d)).join(", ")}</p>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
