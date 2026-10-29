import { useQuery } from "convex/react";
import { CalendarCheck, Clock, TimerOff, TrendingUp, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Empty, Panel, Pill, Stat } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { formatDate } from "@/lib/format.ts";
import { getLocale, tr } from "@/lib/i18n.ts";

const dayName = (w: number) => [tr("Jumapili"), tr("Jumatatu"), tr("Jumanne"), tr("Jumatano"), tr("Alhamisi"), tr("Ijumaa"), tr("Jumamosi")][w];

/** My timetable, today's sign-in and (when the person sells) the sales of the day. */
export default function MyWork() {
  const w = useQuery(api.myLeave.myWork);
  const { money } = useMoney();
  if (!w) return null;
  const sales = w.sales && (
    <div className="grid grid-cols-2 gap-2.5">
      <Stat label={tr("Mauzo yangu ya leo")} value={money(w.sales.total)} sub={tr("Oda / invoice {0}", [w.sales.count])} icon={TrendingUp} tone="blue" />
      <Stat label={tr("Fedha nilizopokea leo")} value={money(w.sales.collected)} icon={Wallet} tone="green" />
    </div>
  );
  if (!w.linked) {
    return (
      <div className="space-y-4">
        <Panel><p className="text-sm text-muted-foreground" role="status">{tr("Akaunti yako haijaunganishwa na mfanyakazi wa HR, kwa hiyo ratiba na mahudhurio hayaonekani. Muombe HR au Manager akuunganishe (HR > Employees).")}</p></Panel>
        {sales}
      </div>
    );
  }
  const t = w.today;
  const state = t.closed ? { tone: "gray" as const, text: tr("Leo ni siku ya mapumziko ya biashara.") }
    : t.isOff ? { tone: "gray" as const, text: tr("Leo ni siku yako ya mapumziko (Off).") }
    : t.signInTime ? ((t.lateMinutes ?? 0) > 0 ? { tone: "amber" as const, text: tr("Umeingia saa {0}, umechelewa dakika {1}.", [t.signInTime, t.lateMinutes]) } : { tone: "green" as const, text: tr("Umeingia kazini saa {0}.", [t.signInTime]) })
    : t.notInYet ? { tone: "rose" as const, text: tr("Hujaingia kazini bado. Ulitakiwa kuingia saa {0}.", [t.startTime ?? ""]) }
    : t.startTime ? { tone: "blue" as const, text: tr("Unatakiwa kuingia saa {0}.", [t.startTime]) }
    : { tone: "gray" as const, text: tr("Huna ratiba iliyowekwa.") };
  return (
    <div className="space-y-4">
      <Panel title={tr("Leo")} actions={<span className="text-xs text-muted-foreground">{new Date(`${w.date}T00:00:00`).toLocaleDateString(getLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>}>
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone={state.tone}>{state.text}</Pill>
          {t.startTime && <span className="text-sm text-muted-foreground">{tr("Ratiba ya leo")}: {t.startTime}–{t.endTime ?? "?"}</span>}
          {t.signOutTime && <span className="text-sm text-muted-foreground">{tr("Ulitoka saa {0}", [t.signOutTime])}</span>}
        </div>
        {(t.lateDeduction ?? 0) > 0 && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{tr("Kato la kuchelewa la leo: {0}", [money(t.lateDeduction)])}</p>}
      </Panel>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat label={tr("Siku nilizofanya kazi mwezi huu")} value={w.month.daysWorked} icon={CalendarCheck} tone="green" />
        <Stat label={tr("Mara nilizochelewa")} value={w.month.lateCount} icon={Clock} tone="amber" />
        <Stat label={tr("Dakika nilizochelewa")} value={w.month.lateMinutes} icon={TimerOff} tone="rose" />
        <Stat label={tr("Makato ya kuchelewa")} value={money(w.month.lateDeduction)} icon={Wallet} tone="violet" />
      </div>
      {sales}
      <Panel title={tr("Ratiba yangu ya wiki")}>
        {!w.hasTimetable ? <Empty>{tr("Huna ratiba iliyowekwa.")}</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 pr-3 font-medium">{tr("Siku")}</th><th className="py-1.5 pr-3 font-medium">{tr("Anaingia")}</th><th className="py-1.5 font-medium">{tr("Anatoka")}</th></tr></thead>
            <tbody>{w.week.map((d) => (
              <tr key={d.weekday} className={`border-t ${d.weekday === new Date(`${w.date}T00:00:00`).getDay() ? "bg-primary/5 font-medium" : ""}`}>
                <td className="py-2 pr-3">{dayName(d.weekday)}</td>
                {d.isOff ? <td colSpan={2} className="py-2 text-muted-foreground">{tr("Off")}</td> : <><td className="py-2 pr-3">{d.startTime}</td><td className="py-2">{d.endTime}</td></>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {w.closedDays.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{tr("Siku za mapumziko za biashara zinazokuja:")} {w.closedDays.map((d) => formatDate(d)).join(", ")}</p>}
      </Panel>
    </div>
  );
}
