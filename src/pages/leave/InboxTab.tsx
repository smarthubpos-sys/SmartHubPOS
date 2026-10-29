import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Users } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Empty, Panel, Pill } from "@/components/page-kit.tsx";
import { useSubmit } from "@/components/use-submit.ts";
import { formatDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";
import { leaveLabel, targetLabel, type LeaveRow } from "./leave-utils.ts";
import { LeaveTracker, StagePill } from "./shared.tsx";

function Card({ r }: { r: LeaveRow }) {
  const markViewed = useMutation(api.myLeave.markViewed);
  const decide = useMutation(api.myLeave.decide);
  const { busy, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const pending = r.status === "pending";
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && pending && !r.viewedAt) void markViewed({ id: r._id as never }).catch(() => undefined); // opening = "viewed"
  };
  return (
    <div className="rounded-xl border bg-card p-3">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full cursor-pointer flex-wrap items-center gap-2 text-left">
        <span className="font-semibold">{r.employeeName}</span>
        {r.employeeCode && <span className="text-xs text-muted-foreground">{r.employeeCode}</span>}
        <span className="text-sm text-muted-foreground">{leaveLabel(r.leaveType)} · {formatDate(r.startDate)} – {formatDate(r.endDate)} · {tr("Siku {0}", [r.days])}</span>
        <Pill>{tr("Kwa {0}", [targetLabel(r.target)])}</Pill>
        {r.lateRequest && <Pill tone="amber">{tr("Imechelewa kuombwa")}</Pill>}
        <span className="ml-auto"><StagePill stage={r.stage} /></span>
      </button>
      {(open || !pending) && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-1 text-sm md:grid-cols-2">
            {(r.position || r.department) && <p><span className="text-muted-foreground">{tr("Nafasi / Idara")}: </span>{[r.position, r.department].filter(Boolean).join(" · ")}</p>}
            <p><span className="text-muted-foreground">{tr("Sababu ya ombi")}: </span>{r.reason || "—"}</p>
          </div>
          {r.lateRequest && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{tr("Ombi hili limetumwa baada ya ruhusa kuanza (au baada ya muda wa kuingia kazini). Angalia sababu ya kuchelewa kuomba kabla ya kuamua.")}</p>}
          {r.clashes > 0 && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{tr("Wafanyakazi wengine {0} wana likizo iliyokubaliwa kwenye siku hizi.", [r.clashes])}</p>}
          <LeaveTracker row={r} />
          {pending ? (
            <div className="space-y-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder={tr("Maelezo ya uamuzi (lazima ukikataa)")} className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void run(() => decide({ id: r._id as never, approve: true, note: note || undefined }), tr("Likizo imekubaliwa."))}>{tr("Kubali")}</Button>
                <Button size="sm" variant="outline" disabled={busy || note.trim().length < 3} onClick={() => void run(() => decide({ id: r._id as never, approve: false, note }), tr("Likizo imekataliwa."))}>{tr("Kataa")}</Button>
              </div>
            </div>
          ) : r.decisionNote ? <p className="text-sm"><span className="font-medium">{r.decidedByName ? `${r.decidedByName}: ` : ""}</span>{r.decisionNote}</p> : null}
        </div>
      )}
    </div>
  );
}

/** Manager / HR side: requests sent to them, newest waiting first. Loading this list marks them "received"; opening one marks it "viewed". */
export default function InboxTab() {
  const rows = useQuery(api.myLeave.inbox);
  const markReceived = useMutation(api.myLeave.markReceived);
  const needsReceipt = !!rows?.some((r) => r.status === "pending" && !r.receivedAt);
  useEffect(() => { if (needsReceipt) void markReceived({}).catch(() => undefined); }, [needsReceipt, markReceived]);
  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const decided = (rows ?? []).filter((r) => r.status !== "pending");
  return (
    <div className="space-y-4">
      <Panel title={tr("Maombi yanayosubiri uamuzi ({0})", [pending.length])}>
        {pending.length === 0 ? <Empty>{tr("Hakuna maombi yanayosubiri.")}</Empty> : <div className="space-y-3">{pending.map((r) => <Card key={r._id} r={r as LeaveRow} />)}</div>}
      </Panel>
      {decided.length > 0 && <Panel title={tr("Yaliyoamuliwa hivi karibuni")}><div className="space-y-3">{decided.map((r) => <Card key={r._id} r={r as LeaveRow} />)}</div></Panel>}
    </div>
  );
}
