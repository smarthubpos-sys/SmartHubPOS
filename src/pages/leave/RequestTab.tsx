import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, Panel, Pill, SelectBox } from "@/components/page-kit.tsx";
import { useSubmit } from "@/components/use-submit.ts";
import { formatDate, localDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";
import { LEAVE_TYPES, leaveLabel, targetLabel } from "./leave-utils.ts";
import { LeaveTracker, StagePill } from "./shared.tsx";

/** A staff member sends a leave / permission request to the manager or HR and follows it until it is decided. */
export default function RequestTab({ linked, canRequest }: { linked: boolean; canRequest: boolean }) {
  const mine = useQuery(api.myLeave.myRequests);
  const submit = useMutation(api.myLeave.submit);
  const cancel = useMutation(api.myLeave.cancelMine);
  const { busy, run } = useSubmit();
  const today = localDate();
  const [f, setF] = useState({ target: "manager" as "manager" | "hr", leaveType: "annual", startDate: today, endDate: today, reason: "" });
  const willBeLate = f.startDate < today;
  const ready = linked && canRequest && f.reason.trim().length >= 3 && f.endDate >= f.startDate;

  async function send() {
    const r = await run(() => submit(f), tr("Ombi lako limetumwa."));
    if (r) setF({ ...f, reason: "" });
  }

  return (
    <div className="space-y-4">
      <Panel title={tr("Omba ruhusa / likizo")}>
        {!linked ? <p className="text-sm text-muted-foreground" role="status">{tr("Akaunti yako haijaunganishwa na mfanyakazi wa HR. Muombe HR au Manager akuunganishe (HR > Employees).")}</p>
          : !canRequest ? <p className="text-sm text-muted-foreground" role="status">{tr("Huna ruhusa ya kutuma maombi ya ruhusa.")}</p> : (
          <div className="grid gap-3 md:grid-cols-4">
            <FormField label={tr("Tuma kwa")}>
              <SelectBox value={f.target} onChange={(e) => setF({ ...f, target: e.target.value as "manager" | "hr" })}><option value="manager">{tr("Manager")}</option><option value="hr">{tr("HR")}</option></SelectBox>
            </FormField>
            <FormField label={tr("Aina ya likizo")}><SelectBox value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value })}>{LEAVE_TYPES.map((k) => <option key={k} value={k}>{leaveLabel(k)}</option>)}</SelectBox></FormField>
            <FormField label={tr("Kuanzia")}><Input type="date" value={f.startDate} min={localDate(-30)} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} /></FormField>
            <FormField label={tr("Hadi")}><Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></FormField>
            <FormField label={tr("Sababu ya ombi")} className="md:col-span-4"><Input value={f.reason} maxLength={1000} placeholder={tr("Eleza kwa ufupi kwa nini unaomba ruhusa")} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
            {willBeLate && <p className="flex items-start gap-2 text-xs text-amber-600 md:col-span-4 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />{tr("Tarehe hii imeshapita: ombi litaonyeshwa kama la kuchelewa. Eleza sababu ya kuchelewa kuomba.")}</p>}
            <div className="md:col-span-4"><Button disabled={busy || !ready} onClick={() => void send()}>{tr("Tuma ombi")}</Button></div>
          </div>
        )}
      </Panel>
      <Panel title={tr("Maombi yangu")}>
        {!mine || mine.length === 0 ? <Empty>{tr("Hujatuma ombi lolote bado.")}</Empty> : (
          <div className="space-y-3">
            {mine.map((r) => (
              <div key={r._id} className="rounded-xl border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{leaveLabel(r.leaveType)}</span>
                  <span className="text-sm text-muted-foreground">{formatDate(r.startDate)} – {formatDate(r.endDate)} · {tr("Siku {0}", [r.days])}</span>
                  <Pill>{tr("Kwa {0}", [targetLabel(r.target)])}</Pill>
                  {r.lateRequest && <Pill tone="amber">{tr("Imechelewa kuombwa")}</Pill>}
                  <span className="ml-auto"><StagePill stage={r.stage} /></span>
                </div>
                {r.reason && <p className="mt-1 text-sm text-muted-foreground">{r.reason}</p>}
                <div className="mt-3"><LeaveTracker row={r} /></div>
                {r.decisionNote && <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${r.status === "rejected" ? "bg-rose-500/10" : "bg-emerald-500/10"}`}><span className="font-medium">{r.decidedByName ? `${r.decidedByName}: ` : ""}</span>{r.decisionNote}</p>}
                {r.status === "pending" && <div className="mt-2 text-right"><Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm(tr("Futa ombi hili?"))) void run(() => cancel({ id: r._id as never }), tr("Ombi limeghairiwa.")); }}>{tr("Futa ombi")}</Button></div>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
