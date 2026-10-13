import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { errorText, tr } from "@/lib/i18n.ts";
import { formatDate, formatNumber } from "@/lib/format.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import PlanFields, { SubscriptionBadge } from "./PlanFields.tsx";
import { emptyPlan, planArgs, type PlanValue } from "./plan-utils.ts";

/** Super Admin: set demo / record a payment for one business, and see what was paid before. Shown on a dark card. */
export default function SubscriptionPanel({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.subscriptions.history, { tenantId });
  const set = useMutation(api.subscriptions.set);
  const [plan, setPlan] = useState<PlanValue>({ ...emptyPlan, plan: "paid" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await set({ tenantId, ...planArgs(plan), note: note.trim() || undefined });
      toast.success(tr("Usajili umehifadhiwa. Unaisha {0}.", [formatDate(r.endsAt)]));
      setNote(""); setPlan({ ...emptyPlan, plan: "paid" });
    } catch (err) { toast.error(errorText(err, "Hitilafu imetokea.")); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 rounded-xl bg-white/5 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-blue-200">{tr("Hali ya sasa")}:</span><SubscriptionBadge sub={data?.status} /></div>
      <form onSubmit={save} className="space-y-3">
        <PlanFields value={plan} onChange={setPlan} light />
        <label className="grid gap-1 text-sm">{tr("Maelezo (hiari)")}<Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Mf. M-Pesa 0712…")} className="bg-white text-slate-900" /></label>
        <p className="text-xs opacity-80">{tr("Ukiongeza malipo wakati usajili bado unaendelea, miezi mipya inaongezwa baada ya tarehe ya mwisho ya sasa.")}</p>
        <Button type="submit" disabled={busy} className="w-full">{busy ? tr("Inahifadhi…") : plan.plan === "demo" ? tr("Rudisha kwenye demo") : tr("Hifadhi malipo")}</Button>
      </form>
      {data && data.payments.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-200">{tr("Historia ya malipo")}</p>
          <ul className="divide-y divide-white/10 text-xs">
            {data.payments.map((p) => (
              <li key={p._id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span>{formatDate(p.createdAt)} · {formatNumber(p.amount)} TZS · {tr("miezi {0}", [p.months])}</span>
                <span className="opacity-80">{formatDate(p.startsAt)} → {formatDate(p.endsAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
