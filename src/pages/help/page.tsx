import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LifeBuoy, Search, Send } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, PageHeader, Panel, Pill, SelectBox, useSubmit } from "@/components/page-kit.tsx";
import { formatDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";

const faqs = () => [
  { q: tr("Ninatengenezaje ankara ya mauzo?"), a: tr("Nenda Sales > Ankara Mpya, chagua mteja, ongeza bidhaa (unaweza kuscan barcode), weka malipo kisha Hifadhi Ankara. Stoo inapungua kiotomatiki."), to: "/sales" },
  { q: tr("Ninaingizaje bidhaa nyingi kwa Excel?"), a: tr("Nenda Stock > Import from Excel, pakua template, jaza jina, bei ya kuuzia, bei ya manunuzi na idadi, kisha pakia faili. Hakiki na ubonyeze Ingiza."), to: "/stock/import" },
  { q: tr("Ninarekodije mtaji wa kuanzisha biashara?"), a: tr("Nenda Accounts > Mapokezi ya Mtaji, chagua mtaji umetoka wapi (mmiliki, mkurugenzi, mkopo wa benki...) na fedha ziliingia wapi. Hesabu zinasasishwa kiotomatiki."), to: "/accounts/capital" },
  { q: tr("Ninalipaje bili za pango, umeme au maji?"), a: tr("Nenda Bills, bonyeza Bili mpya, kisha Lipa utakapolipa. Unaweza kulipa kwa awamu; bili zilizochelewa zinakuja kwenye Notifications."), to: "/bills" },
  { q: tr("Ninasajili vipi alama ya kidole au Face ID kwa mfanyakazi?"), a: tr("Nenda HR > Employees, bonyeza ikoni ya kidole kwenye safu ya mfanyakazi na ufuate maelekezo ya kifaa. Tumia kifaa chenye kisoma kidole, Face ID au Windows Hello, kwenye HTTPS."), to: "/hr" },
  { q: tr("Mfanyakazi anaingiaje kazini kwa alama ya kidole?"), a: tr("Nenda Payroll > Staff Sign In, bonyeza Ingia kazini, kisha thibitisha kwa alama ya kidole au uso. Kutoka kazini tumia Staff Sign Out."), to: "/payroll/sign-in" },
  { q: tr("Ninahesabuje na kulipaje mishahara?"), a: tr("Nenda Payroll > Process Payroll, weka kipindi, bonyeza Hesabu. Mahudhurio na likizo bila malipo huzingatiwa. Idhinisha kisha Lipa; journal inatengenezwa kiotomatiki."), to: "/payroll/process" },
  { q: tr("Ninabadilishaje lugha ya mfumo?"), a: tr("Nenda Maintenance > Language Settings, chagua Kiswahili au English na uhifadhi. Mfumo mzima utatumia lugha moja."), to: "/maintenance" },
  { q: tr("Ninabadilishaje biashara?"), a: tr("Super Admin anabonyeza Badilisha biashara juu ya skrini kurudi kwenye orodha ya biashara, kisha achague nyingine."), to: "/dashboard" },
  { q: tr("Ninaunganishaje printer ya risiti?"), a: tr("Nenda Maintenance > Hardware Setup, chagua aina ya muunganisho (waya au wireless), tafuta printer kisha bonyeza Jaribu kuchapa."), to: "/maintenance" },
  { q: tr("Bidhaa ikiisha ninajuaje?"), a: tr("Mfumo unakutumia taarifa kwenye Notifications bidhaa ikifika kiwango cha kuagiza upya au ikiisha. Weka Reorder Level kwenye kila bidhaa."), to: "/notifications" },
  { q: tr("Nakala rudufu (backup) ninapataje?"), a: tr("Super Admin: Maintenance > Backup and Restore > Download backup now. Hifadhi faili mahali salama mara kwa mara."), to: "/maintenance" },
];

const catLabel = (c: string) => ({ question: tr("Swali"), problem: tr("Tatizo"), request: tr("Ombi la huduma"), other: tr("Nyingine") } as Record<string, string>)[c] ?? c;

export default function HelpPage() {
  const navigate = useNavigate();
  const tickets = useQuery(api.support.list);
  const create = useMutation(api.support.create);
  const close = useMutation(api.support.close);
  const respond = useMutation(api.support.respond);
  const me = useQuery(api.users.getCurrentUser);
  const { busy, run } = useSubmit();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(0);
  const [f, setF] = useState({ subject: "", message: "", category: "question" });
  const [reply, setReply] = useState<Record<string, string>>({});
  const list = faqs().filter((x) => !search.trim() || `${x.q} ${x.a}`.toLowerCase().includes(search.trim().toLowerCase()));
  const isManager = ["super_admin", "superadmin", "admin", "manager", "owner"].includes((me?.role ?? "").toLowerCase());

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader icon={LifeBuoy} title={tr("Help & Support")} subtitle={tr("Majibu ya haraka, maelekezo na msaada kutoka kwa timu.")} />
      <Panel title={tr("Maswali yanayoulizwa mara nyingi")}>
        <div className="relative mb-3"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder={tr("Tafuta msaada…")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {list.length === 0 ? <Empty>{tr("Hakuna jibu lililopatikana. Tuma ombi la msaada hapa chini.")}</Empty> : (
          <ul className="space-y-1.5">
            {list.map((x, i) => (
              <li key={x.q} className="rounded-xl border border-border/60">
                <button className="flex w-full cursor-pointer items-center gap-2 p-3 text-left text-sm font-medium" onClick={() => setOpen(open === i ? null : i)}>
                  <span className="flex-1">{x.q}</span><ChevronDown className={`h-4 w-4 transition-transform ${open === i ? "rotate-180" : ""}`} />
                </button>
                {open === i && <div className="space-y-2 border-t border-border/60 p-3 text-sm text-muted-foreground"><p>{x.a}</p><Button size="sm" variant="outline" onClick={() => navigate(x.to)}>{tr("Nenda ukurasa huu")}</Button></div>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={tr("Tuma ombi la msaada")}>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label={tr("Mada")} className="md:col-span-2"><Input maxLength={140} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></FormField>
          <FormField label={tr("Aina")}><SelectBox value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["question", "problem", "request", "other"].map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}</SelectBox></FormField>
          <FormField label={tr("Maelezo")} className="md:col-span-3"><textarea rows={4} maxLength={4000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" /></FormField>
        </div>
        <div className="mt-3"><Button disabled={busy || !f.subject.trim() || !f.message.trim()} onClick={async () => { const ok = await run(() => create(f), tr("Ombi lako limetumwa.")); if (ok) setF({ subject: "", message: "", category: "question" }); }}><Send className="mr-1 h-4 w-4" />{tr("Tuma ombi")}</Button></div>
      </Panel>

      <Panel title={isManager ? tr("Maombi yote ya msaada") : tr("Maombi yangu")}>
        {!tickets || tickets.length === 0 ? <Empty>{tr("Hakuna maombi bado.")}</Empty> : (
          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t._id} className="rounded-xl border border-border/60 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{t.subject}</span><Pill>{catLabel(t.category)}</Pill><Pill tone={t.status === "open" ? "amber" : "green"}>{t.status === "open" ? tr("Wazi") : tr("Imefungwa")}</Pill><span className="ml-auto text-xs text-muted-foreground">{t.createdByName} · {formatDate(t.createdAt)}</span></div>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{t.message}</p>
                {t.reply && <p className="mt-2 rounded-lg bg-primary/5 p-2"><span className="font-medium">{t.repliedBy}: </span>{t.reply}</p>}
                {t.status === "open" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isManager && <><Input className="h-8 min-w-48 flex-1" placeholder={tr("Andika jibu…")} value={reply[t._id] ?? ""} onChange={(e) => setReply({ ...reply, [t._id]: e.target.value })} /><Button size="sm" disabled={busy || !(reply[t._id] ?? "").trim()} onClick={() => void run(() => respond({ id: t._id, reply: reply[t._id], close: false }), tr("Jibu limetumwa.")).then(() => setReply({ ...reply, [t._id]: "" }))}>{tr("Jibu")}</Button></>}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => close({ id: t._id }), tr("Ombi limefungwa."))}>{tr("Funga ombi")}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
