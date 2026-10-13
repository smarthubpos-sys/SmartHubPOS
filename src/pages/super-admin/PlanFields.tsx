import { Input } from "@/components/ui/input.tsx";
import { formatDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";
import type { PlanValue, Sub } from "./plan-utils.ts";

export function SubscriptionBadge({ sub }: { sub?: Sub }) {
  if (!sub) return null;
  let text: string, tone: string;
  if (sub.plan === "none") { text = tr("Bila kikomo cha usajili"); tone = "bg-slate-500/20 text-slate-200"; }
  else if (sub.expired) { text = tr("Imeisha {0}", [formatDate(sub.endsAt ?? "")]); tone = "bg-rose-500/25 text-rose-200"; }
  else if (sub.plan === "demo") { text = tr("Demo · siku {0} zimebaki", [(sub.daysLeft ?? 0) + 1]); tone = "bg-amber-500/25 text-amber-200"; }
  else { text = tr("Imelipiwa hadi {0}", [formatDate(sub.endsAt ?? "")]); tone = sub.expiringSoon ? "bg-amber-500/25 text-amber-200" : "bg-emerald-500/20 text-emerald-200"; }
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{text}</span>;
}

/** Demo (3 days) or paid (months + amount). `light` = inputs on a dark card are white; otherwise default theme inputs. */
export default function PlanFields({ value, onChange, light = false }: { value: PlanValue; onChange: (v: PlanValue) => void; light?: boolean }) {
  const inputCls = light ? "bg-white text-slate-900" : "";
  const choice = (plan: PlanValue["plan"], label: string) => (
    <button type="button" onClick={() => onChange({ ...value, plan })}
      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${value.plan === plan ? "border-primary bg-primary text-primary-foreground" : "border-white/30 bg-transparent hover:bg-white/10"}`}>{label}</button>
  );
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{tr("Aina ya usajili")}</p>
      <div className="flex flex-wrap gap-2">{choice("demo", tr("Demo (siku 3)"))}{choice("paid", tr("Amelipia"))}</div>
      {value.plan === "demo" ? (
        <p className="text-xs opacity-80">{tr("Biashara itatumika kwa siku 3 tu, kisha itafungwa hadi ulipie.")}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">{tr("Miezi aliyolipia")}
            <Input type="number" min={1} max={60} step={1} value={value.months} onChange={(e) => onChange({ ...value, months: e.target.value })} className={inputCls} /></label>
          <label className="grid gap-1 text-sm">{tr("Kiasi alicholipa (TZS)")}
            <Input type="number" min={1} step="any" value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} className={inputCls} /></label>
        </div>
      )}
    </div>
  );
}
