import { formatDate, formatNumber } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";
import { SubscriptionBadge } from "./PlanFields.tsx";
import type { Sub } from "./plan-utils.ts";

type LastPayment = { paidOn: string; amount: number; months: number; startsAt: string; endsAt: string } | null | undefined;

/**
 * Super Admin list: everything about a business's subscription in one cell - the status, WHEN it was last paid (and how much / for how many months),
 * the period it covers and the days left (or how long ago it ended), and the total paid so far.
 */
export default function SubscriptionCell({ sub, last, totalPaid, count }: { sub: Sub; last: LastPayment; totalPaid?: number; count?: number }) {
  const left = sub.daysLeft;
  const daysText = sub.plan === "none" || left === undefined ? null
    : sub.expired ? tr("Iliisha siku {0} zilizopita", [Math.abs(left)])
    : left === 0 ? tr("Inaisha leo") : tr("Siku {0} zimebaki", [left]);
  const tone = sub.expired ? "text-rose-400" : sub.expiringSoon ? "text-amber-400" : "text-emerald-400";
  return (
    <div className="space-y-1">
      <SubscriptionBadge sub={sub} />
      {last ? (
        <>
          <div className="text-xs">{tr("Alilipa")}: <b>{formatDate(last.paidOn)}</b> · {formatNumber(last.amount)} TZS · {tr("miezi {0}", [last.months])}</div>
          <div className="text-xs text-muted-foreground">{tr("Kipindi")}: {formatDate(last.startsAt)} → <b className="text-foreground">{formatDate(last.endsAt)}</b></div>
        </>
      ) : sub.plan === "demo" ? (
        <div className="text-xs text-muted-foreground">{tr("Hajalipa bado (demo)")}{sub.endsAt ? ` · ${tr("inaisha {0}", [formatDate(sub.endsAt)])}` : ""}</div>
      ) : sub.plan === "paid" && sub.endsAt ? (
        <div className="text-xs text-muted-foreground">{tr("Inaisha {0}", [formatDate(sub.endsAt)])}</div>
      ) : null}
      {daysText && <div className={`text-xs font-medium ${tone}`}>{daysText}</div>}
      {(count ?? 0) > 1 && <div className="text-[11px] text-muted-foreground">{tr("Jumla aliyolipa")}: {formatNumber(totalPaid ?? 0)} TZS ({tr("malipo {0}", [count ?? 0])})</div>}
    </div>
  );
}
