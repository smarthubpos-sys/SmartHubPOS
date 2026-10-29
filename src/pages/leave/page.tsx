import { useState } from "react";
import { useQuery } from "convex/react";
import { CalendarClock } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { PageHeader } from "@/components/page-kit.tsx";
import { tr } from "@/lib/i18n.ts";
import InboxTab from "./InboxTab.tsx";
import MyWork from "./MyWork.tsx";
import RequestTab from "./RequestTab.tsx";

type Tab = "work" | "request" | "inbox";

/** Leave / Ruhusa: my timetable and sign-in, requests to the manager or HR with their progress, and the manager / HR inbox. */
export default function LeavePage() {
  const status = useQuery(api.myLeave.status);
  const mineCount = useQuery(api.myLeave.myRequests)?.filter((r) => r.status === "pending").length ?? 0;
  const inbox = useQuery(api.myLeave.inbox, status?.canReview ? {} : "skip");
  const waiting = inbox?.filter((r) => r.status === "pending").length ?? 0;
  const [picked, setPicked] = useState<Tab | null>(null);
  if (!status) return null;
  const tab: Tab = picked ?? (status.canReview && !status.linked ? "inbox" : "work");
  const tabs: [Tab, string, number][] = [["work", tr("Ratiba yangu"), 0], ["request", tr("Omba ruhusa"), mineCount], ...(status.canReview ? [["inbox", tr("Maombi ya kupitia"), waiting] as [Tab, string, number]] : [])];
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader icon={CalendarClock} title={tr("Ruhusa na Ratiba Yangu")} subtitle={status.employee ? `${status.employee.name}${status.employee.position ? ` · ${status.employee.position}` : ""}` : tr("Omba ruhusa, fuatilia ombi lako na uone ratiba yako.")} />
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => setPicked(k)} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium ${tab === k ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md shadow-primary/30" : "bg-card border hover:bg-muted"}`}>
            {label}{n > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{n}</span>}
          </button>
        ))}
      </div>
      {tab === "work" && <MyWork />}
      {tab === "request" && <RequestTab linked={status.linked} canRequest={status.canRequest} />}
      {tab === "inbox" && status.canReview && <InboxTab />}
    </div>
  );
}
