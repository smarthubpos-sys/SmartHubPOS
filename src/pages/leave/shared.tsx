import { Check, Eye, Inbox, Send, X } from "lucide-react";
import { Pill } from "@/components/page-kit.tsx";
import { tr } from "@/lib/i18n.ts";
import { formatStamp, stageLabel, stageTone, type LeaveRow } from "./leave-utils.ts";

export function StagePill({ stage }: { stage: string }) {
  return <Pill tone={stageTone(stage)}>{stageLabel(stage)}</Pill>;
}

/** Sent -> Received -> Viewed -> Decision, each with the time it happened. */
export function LeaveTracker({ row }: { row: LeaveRow }) {
  const decided = row.status === "approved" || row.status === "rejected";
  const steps = [
    { key: "sent", label: tr("Imetumwa"), at: row.requestedAt, done: true, Icon: Send },
    { key: "received", label: tr("Imepokelewa"), at: row.receivedAt, done: !!row.receivedAt || decided, Icon: Inbox },
    { key: "viewed", label: tr("Imeonwa"), at: row.viewedAt, done: !!row.viewedAt || decided, Icon: Eye },
    { key: "decision", label: row.status === "approved" ? tr("Imekubaliwa") : row.status === "rejected" ? tr("Imekataliwa") : row.status === "cancelled" ? tr("Imeghairiwa") : tr("Uamuzi"), at: decided ? row.decidedAt : undefined, done: decided || row.status === "cancelled", Icon: row.status === "rejected" || row.status === "cancelled" ? X : Check },
  ];
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label={tr("Safari ya ombi")}>
      {steps.map((s, i) => {
        const bad = s.key === "decision" && (row.status === "rejected" || row.status === "cancelled");
        const color = !s.done ? "bg-muted text-muted-foreground" : bad ? (row.status === "rejected" ? "bg-rose-500 text-white" : "bg-slate-400 text-white") : s.key === "decision" ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground";
        return (
          <li key={s.key} className="relative flex flex-col items-center text-center">
            {i > 0 && <span aria-hidden className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 ${s.done ? "bg-primary/60" : "bg-border"}`} />}
            <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ${color}`}><s.Icon className="h-4 w-4" /></span>
            <span className={`mt-1 text-[11px] font-medium leading-tight ${s.done ? "" : "text-muted-foreground"}`}>{s.label}</span>
            <span className="text-[10px] leading-tight text-muted-foreground">{s.done && s.at ? formatStamp(s.at) : "—"}</span>
          </li>
        );
      })}
    </ol>
  );
}
