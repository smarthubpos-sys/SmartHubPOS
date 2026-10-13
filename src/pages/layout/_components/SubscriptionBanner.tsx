import { useQuery } from "convex/react";
import { Clock } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { formatDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";

/** Strip under the top bar: tells the business admin / manager that the subscription (or demo) is about to end. */
export default function SubscriptionBanner() {
  const business = useQuery(api.tenants.current, {});
  const sub = business?.subscription;
  if (!business || business.isSuperAdmin || !business.isManager || !sub?.expiringSoon) return null;
  const days = sub.daysLeft ?? 0;
  const text = sub.plan === "demo"
    ? (days === 0 ? tr("Demo yako inaisha leo ({0}). Wasiliana na SmartHub ulipie ili uendelee.", [formatDate(sub.endsAt ?? "")]) : tr("Demo yako inaisha baada ya siku {0} ({1}). Wasiliana na SmartHub ulipie ili uendelee.", [days, formatDate(sub.endsAt ?? "")]))
    : (days === 0 ? tr("Usajili wako unaisha leo ({0}). Lipia sasa ili mfumo usikatike.", [formatDate(sub.endsAt ?? "")]) : tr("Usajili wako unaisha baada ya siku {0} ({1}). Lipia mapema ili mfumo usikatike.", [days, formatDate(sub.endsAt ?? "")]));
  return (
    <div role="status" className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white ${days <= 2 ? "bg-rose-600" : "bg-amber-600"}`}>
      <Clock className="h-4 w-4 shrink-0" /><span>{text}</span>
    </div>
  );
}
