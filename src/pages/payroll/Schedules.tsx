import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CalendarClock, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useSubmit } from "@/components/use-submit.ts";
import { Empty, FormField, PageHeader, Panel, Pill, Table } from "@/components/page-kit.tsx";
import { formatDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";

/** Monday first, as people read a week. weekday: 0 = Sunday ... 6 = Saturday. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const dayName = (w: number) => [tr("Jumapili"), tr("Jumatatu"), tr("Jumanne"), tr("Jumatano"), tr("Alhamisi"), tr("Ijumaa"), tr("Jumamosi")][w];
type Day = { weekday: number; isOff: boolean; startTime: string; endTime: string };
const blank = (): Day[] => ORDER.map((weekday) => ({ weekday, isOff: weekday === 0, startTime: "08:00", endTime: "17:00" }));

function summary(days: { weekday: number; isOff: boolean; startTime?: string; endTime?: string }[]) {
  if (days.length === 0) return tr("Hakuna ratiba");
  return ORDER.map((w) => days.find((d) => d.weekday === w)).filter((d): d is NonNullable<typeof d> => !!d).map((d) => `${dayName(d.weekday).slice(0, 3)} ${d.isOff ? tr("Off") : `${d.startTime}–${d.endTime}`}`).join(" · ");
}

export default function Schedules() {
  const navigate = useNavigate();
  const rows = useQuery(api.schedules.list);
  const closedDays = useQuery(api.schedules.listClosedDays);
  const save = useMutation(api.schedules.save);
  const clear = useMutation(api.schedules.clear);
  const addClosed = useMutation(api.schedules.addClosedDay);
  const removeClosed = useMutation(api.schedules.removeClosedDay);
  const { busy, run } = useSubmit();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [days, setDays] = useState<Day[]>(blank());
  const [search, setSearch] = useState("");
  const [holiday, setHoliday] = useState({ date: "", reason: "" });

  const list = useMemo(() => rows ?? [], [rows]);
  const shown = useMemo(() => list.filter((e) => !search.trim() || `${e.name} ${e.code}`.toLowerCase().includes(search.trim().toLowerCase())), [list, search]);
  const patch = (weekday: number, p: Partial<Day>) => setDays((all) => all.map((d) => (d.weekday === weekday ? { ...d, ...p } : d)));

  function togglePick(id: string) { setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  /** Opening one employee loads the timetable he already has. */
  function edit(id: string) {
    setPicked(new Set([id]));
    const e = list.find((x) => String(x.employeeId) === id);
    if (e && e.days.length === 7) setDays(ORDER.map((w) => { const d = e.days.find((x) => x.weekday === w); return { weekday: w, isOff: d?.isOff ?? false, startTime: d?.startTime ?? "08:00", endTime: d?.endTime ?? "17:00" }; }));
    else setDays(blank());
  }
  function sameForWorkingDays() {
    const first = days.find((d) => !d.isOff);
    if (first) setDays((all) => all.map((d) => (d.isOff ? d : { ...d, startTime: first.startTime, endTime: first.endTime })));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Button variant="outline" onClick={() => navigate("/payroll")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Payroll")}</Button>
      <PageHeader icon={CalendarClock} title={tr("Staff Schedules")} subtitle={tr("Panga siku, muda wa kuingia na muda wa kutoka kwa kila mfanyakazi. Mfumo hutumia ratiba hii kujua nani amechelewa au hajaingia.")} />

      <Panel title={tr("1. Chagua wafanyakazi")} actions={<Input className="h-8 w-44" placeholder={tr("Tafuta jina…")} value={search} onChange={(e) => setSearch(e.target.value)} />}>
        {rows === undefined ? null : list.length === 0 ? <Empty>{tr("Bado hakuna mfanyakazi.")}</Empty> : (
          <>
            <div className="mb-2 flex gap-2 text-xs">
              <Button size="sm" variant="outline" onClick={() => setPicked(new Set(shown.map((e) => String(e.employeeId))))}>{tr("Chagua wote")}</Button>
              <Button size="sm" variant="outline" onClick={() => setPicked(new Set())}>{tr("Ondoa wote")}</Button>
            </div>
            <Table head={["", tr("Mfanyakazi"), tr("Ratiba ya sasa"), " "]}>
              {shown.map((e) => {
                const id = String(e.employeeId);
                return (
                  <tr key={id}>
                    <td><input type="checkbox" className="h-4 w-4 cursor-pointer" checked={picked.has(id)} onChange={() => togglePick(id)} aria-label={e.name} /></td>
                    <td className="font-medium">{e.name}<span className="ml-2 text-xs text-muted-foreground">{e.code}</span></td>
                    <td className="text-xs text-muted-foreground">{summary(e.days)}</td>
                    <td className="space-x-1 whitespace-nowrap text-right">
                      <Button size="sm" variant="outline" onClick={() => edit(id)}>{tr("Hariri")}</Button>
                      {e.days.length > 0 && <Button size="sm" variant="ghost" disabled={busy} aria-label={tr("Futa ratiba")} onClick={() => void run(() => clear({ employeeId: e.employeeId as Id<"employees"> }), tr("Ratiba imefutwa."))}><Trash2 className="h-4 w-4" /></Button>}
                    </td>
                  </tr>
                );
              })}
            </Table>
          </>
        )}
      </Panel>

      <Panel title={tr("2. Ratiba ya wiki")} actions={<Pill tone="blue">{tr("Waliochaguliwa: {0}", [picked.size])}</Pill>}>
        <div className="space-y-2">
          {days.map((d) => (
            <div key={d.weekday} className="grid grid-cols-[6rem_1fr] items-center gap-2 rounded-xl border border-border/60 p-2 md:grid-cols-[8rem_7rem_1fr_1fr]">
              <span className="text-sm font-semibold">{dayName(d.weekday)}</span>
              <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={d.isOff} onChange={(e) => patch(d.weekday, { isOff: e.target.checked })} />{tr("Off (mapumziko)")}</label>
              <FormField label={tr("Anaingia")}><Input type="time" disabled={d.isOff} value={d.startTime} onChange={(e) => patch(d.weekday, { startTime: e.target.value })} /></FormField>
              <FormField label={tr("Anatoka")}><Input type="time" disabled={d.isOff} value={d.endTime} onChange={(e) => patch(d.weekday, { endTime: e.target.value })} /></FormField>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={sameForWorkingDays}>{tr("Nakili muda wa siku ya kwanza kwa siku zote za kazi")}</Button>
          <Button disabled={busy || picked.size === 0} onClick={() => void run(() => save({ employeeIds: [...picked] as Id<"employees">[], days: days.map((d) => ({ weekday: d.weekday, isOff: d.isOff, startTime: d.isOff ? undefined : d.startTime, endTime: d.isOff ? undefined : d.endTime })) }), tr("Ratiba imehifadhiwa."))}>{tr("Hifadhi ratiba")}</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{tr("Mfanyakazi asiye na ratiba hahesabiwi kuchelewa wala kutokuwepo.")}</p>
      </Panel>

      <Panel title={tr("Siku za mapumziko ya biashara (sikukuu)")}>
        <p className="mb-3 text-xs text-muted-foreground">{tr("Siku hizi hakuna anayehesabiwa kuchelewa wala kutokuwepo, kwa wafanyakazi wote.")}</p>
        <div className="grid items-end gap-3 md:grid-cols-4">
          <FormField label={tr("Tarehe")}><Input type="date" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} /></FormField>
          <FormField label={tr("Sababu (hiari)")} className="md:col-span-2"><Input value={holiday.reason} onChange={(e) => setHoliday({ ...holiday, reason: e.target.value })} /></FormField>
          <Button disabled={busy || !holiday.date} onClick={() => void run(async () => { await addClosed({ date: holiday.date, reason: holiday.reason || undefined }); setHoliday({ date: "", reason: "" }); }, tr("Siku ya mapumziko imeongezwa."))}>{tr("Ongeza")}</Button>
        </div>
        {(closedDays ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(closedDays ?? []).map((d) => (
              <span key={d._id} className="inline-flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs">
                {formatDate(d.date)}{d.reason ? ` · ${d.reason}` : ""}
                <button className="cursor-pointer text-rose-600" aria-label={tr("Ondoa")} disabled={busy} onClick={() => void run(() => removeClosed({ id: d._id }), tr("Imeondolewa."))}><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
