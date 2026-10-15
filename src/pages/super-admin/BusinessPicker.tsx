import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Building2, CreditCard, LogOut, Megaphone, Pause, Pencil, Play, Plus, X, BarChart3, Clock3, Wallet, CheckCircle2, ChevronDown, Bell, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import { errorText, tr } from "@/lib/i18n.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import AnnouncementsAdmin from "./AnnouncementsAdmin.tsx";
import PlanFields, { SubscriptionBadge } from "./PlanFields.tsx";
import { emptyPlan, planArgs, type PlanValue } from "./plan-utils.ts";
import SubscriptionPanel from "./SubscriptionPanel.tsx";
import EditBusinessPanel from "./EditBusinessPanel.tsx";
import ErrorBoundary from "@/components/error-boundary.tsx";

/**
 * Shown to the Super Admin right after sign-in (and after "Switch business").
 * Lists every business so the admin picks the one to work in, and lets the admin
 * register a new business or stop / resume an existing one.
 */
export default function BusinessPicker() {
  const { user, signout } = useAuth();
  const businesses = useQuery(api.tenants.listForPicker, {});
  const summary = useQuery(api.subscriptions.dashboardSummary, {});
  const select = useMutation(api.tenants.selectBusiness);
  const create = useMutation(api.tenants.create);
  const setActive = useMutation(api.tenants.setActive);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [currency, setCurrency] = useState("TZS");
  const [departments, setDepartments] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanValue>(emptyPlan);
  const [tab, setTab] = useState<"businesses" | "messages">("businesses");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // The alerts panel opens by itself once per browser session when something is dangerous; the person can toggle it afterwards.
  const [alertsToggled, setAlertsToggled] = useState<boolean | null>(null);
  const [firstAlertVisit] = useState(() => { try { return !window.sessionStorage.getItem("smarthub.alerts.toast"); } catch { return true; } });
  const alertCount = summary?.alerts.length ?? 0;
  const dangerCount = summary?.alerts.filter((a) => a.level === "danger").length ?? 0;
  const alertsOpen = alertsToggled ?? (firstAlertVisit && dangerCount > 0);
  useEffect(() => {
    if (!summary || dangerCount === 0) return;
    const key = "smarthub.alerts.toast";
    try { if (window.sessionStorage.getItem(key)) return; window.sessionStorage.setItem(key, "1"); } catch { /* storage unavailable */ }
    toast.warning(tr("Kuna tahadhari {0} zinazohitaji kuangaliwa.", [dangerCount]));
  }, [summary, dangerCount]);
  const shownBusinesses = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (businesses ?? []).filter((b) => !q || b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q));
  }, [businesses, filter]);
  const alertText = (a: NonNullable<typeof summary>["alerts"][number]) =>
    a.code === "expired" ? tr("{0}: usajili uliisha tarehe {1}.", [a.name, a.a ?? "—"])
    : a.code === "expiring" ? tr("{0}: usajili unaisha baada ya siku {1} ({2}).", [a.name, a.a ?? 0, a.b ?? "—"])
    : a.code === "failures" ? tr("{0}: vitendo {1} vimeshindwa ndani ya saa 24 zilizopita.", [a.name, a.a ?? 0])
    : tr("{0}: biashara imesimamishwa.", [a.name]);

  type SummaryAlert = NonNullable<typeof summary>["alerts"][number];
  /** Opens what the alert is about: the business card (and its subscription panel for expiry alerts), scrolled into view. */
  function openAlert(a: SummaryAlert) {
    const id = String(a.tenantId);
    setTab("businesses");
    setFilter("");
    setOpenCard(id);
    setEditId(null);
    if (a.code === "expired" || a.code === "expiring") setOpenId(id);
    if (a.code === "failures") toast.info(tr("Ingia kwenye biashara hii kisha fungua Maintenance > Audit Trail kuona vitendo vilivyoshindwa."));
    window.setTimeout(() => document.getElementById(`biz-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  }

  async function enter(id: Id<"tenants">) {
    setBusyId(String(id));
    try { await select({ tenantId: id }); }
    catch (e) { toast.error(errorText(e, "Imeshindikana kuingia kwenye biashara.")); setBusyId(null); }
  }

  async function toggle(id: Id<"tenants">, businessName: string, isActive: boolean) {
    if (isActive && !window.confirm(tr("Simamisha biashara \"{0}\"? Watumiaji wake hawataweza kuingia hadi uiwashe tena. Data haifutwi.", [businessName]))) return;
    setBusyId(String(id));
    try {
      await setActive({ tenantId: id, isActive: !isActive });
      toast.success(isActive ? tr("Biashara imesimamishwa.") : tr("Biashara imewashwa."));
    } catch (e) { toast.error(errorText(e, "Hitilafu imetokea.")); }
    finally { setBusyId(null); }
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) { toast.error(tr("Jina na msimbo vinahitajika.")); return; }
    setCreating(true);
    try {
      const result = await create({ name: name.trim(), code: code.trim(), currency: currency.trim() || "TZS", departments: departments.map((d) => d.trim()).filter(Boolean), ...planArgs(plan) });
      toast.success(result.branchesCreated > 0 ? tr("Biashara {0} imesajiliwa pamoja na idara {1}.", [name.trim(), result.branchesCreated]) : tr("Biashara {0} imesajiliwa (bila idara).", [name.trim()]));
      setName(""); setCode(""); setDepartments([]); setPlan(emptyPlan); setShowForm(false);
    } catch (err) { toast.error(errorText(err, "Hitilafu imetokea.")); }
    finally { setCreating(false); }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_8%,rgba(96,165,250,0.32),transparent_34%),linear-gradient(145deg,#0b4ea2_0%,#0a63c7_48%,#0756ad_100%)] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center gap-3">
          <img src="/assets/smarthub-logo.webp.png" alt="SmartHub POS" className="h-11 w-11 rounded-xl border border-white/10 bg-white/5 p-1 sm:h-14 sm:w-14 sm:rounded-2xl sm:p-1.5" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold text-white sm:text-2xl">{tr("Chagua biashara")}</h1>
            <p className="text-sm text-blue-100">{tr("Chagua biashara unayotaka kuingia, au sajili biashara mpya.")}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <span className="hidden text-xs text-blue-100 sm:inline">{tr("Umeingia kama {0}", [user?.name ?? (user as { username?: string } | null)?.username ?? ""])}</span>
            <Button variant="secondary" onClick={() => setShowForm((v) => !v)}><Plus className="mr-1 h-4 w-4" />{tr("Sajili biashara mpya")}</Button>
            <Button variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => void signout()}><LogOut className="mr-1 h-4 w-4" />{tr("Sign Out")}</Button>
          </div>
        </header>

        <div className="flex flex-wrap gap-2">
          {([["businesses", tr("Biashara"), Building2], ["messages", tr("Matangazo na ujumbe"), Megaphone]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium ${tab === k ? "border-white bg-white text-blue-900" : "border-white/30 text-white hover:bg-white/10"}`}><Icon className="h-4 w-4" />{label}</button>
          ))}
        </div>

        {tab === "messages" && <AnnouncementsAdmin />}

        {tab === "businesses" && summary && (
          <section aria-label={tr("Muhtasari wa biashara na usajili")} className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: tr("Biashara zote"), value: summary.totalBusinesses, icon: Building2 },
                { label: tr("Demo hai"), value: summary.demoBusinesses, icon: Clock3 },
                { label: tr("Zilizolipia"), value: summary.paidBusinesses, icon: CheckCircle2 },
                { label: tr("Zinazoisha karibuni"), value: summary.expiringBusinesses, icon: BarChart3 },
                { label: tr("Mapato yote"), value: `${summary.totalRevenue.toLocaleString()} TZS`, icon: Wallet },
                { label: tr("Mapato mwezi huu"), value: `${summary.monthRevenue.toLocaleString()} TZS`, icon: CreditCard },
              ].map((item) => { const Icon = item.icon; return (
                <article key={item.label} className="min-w-0 rounded-lg border border-white/10 bg-[#061f4b]/70 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-blue-100"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{item.label}</span></div>
                  <p className="truncate text-sm font-bold text-white" title={String(item.value)}>{item.value}</p>
                </article>
              ); })}
            </div>

            <div className="rounded-xl border border-white/10 bg-[#061f4b]/50">
              <button type="button" aria-expanded={alertsOpen} onClick={() => setAlertsToggled(!alertsOpen)} className="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-white">
                <Bell className="h-4 w-4 shrink-0" />
                <span className="flex-1">{tr("Tahadhari")}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${dangerCount > 0 ? "bg-red-500 text-white" : alertCount > 0 ? "bg-amber-300 text-slate-900" : "bg-emerald-400/20 text-emerald-100"}`}>{alertCount}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${alertsOpen ? "rotate-180" : ""}`} />
              </button>
              {alertsOpen && <div className="space-y-1.5 border-t border-white/10 p-2">
                {alertCount === 0 && <p className="px-1 py-1 text-xs text-blue-100">{tr("Hakuna tahadhari. Kila kitu kiko sawa.")}</p>}
                {summary.alerts.map((a) => (
                  <button key={a.key} type="button" onClick={() => openAlert(a)} title={tr("Bonyeza kufungua biashara hii")}
                    className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${a.level === "danger" ? "bg-red-500/20 text-red-50 hover:bg-red-500/30" : a.level === "warning" ? "bg-amber-300/15 text-amber-50 hover:bg-amber-300/25" : "bg-white/10 text-blue-50 hover:bg-white/20"}`}>
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${a.level === "danger" ? "bg-red-400" : a.level === "warning" ? "bg-amber-300" : "bg-blue-300"}`} />
                    <span className="min-w-0 flex-1 break-words">{alertText(a)}</span>
                    <span className="shrink-0 self-center text-[10px] font-semibold underline underline-offset-2">{a.code === "expired" || a.code === "expiring" ? tr("Fungua usajili") : tr("Fungua")}</span>
                  </button>
                ))}
              </div>}
            </div>
          </section>
        )}

        {tab === "businesses" && showForm && (
          <form onSubmit={register} className="grid gap-3 rounded-2xl border border-white/10 bg-[#061f4b]/80 p-5 md:grid-cols-4">
            <label className="grid gap-1 text-sm">{tr("Jina la biashara")}<Input required value={name} onChange={(e) => setName(e.target.value)} className="bg-white text-slate-900" /></label>
            <label className="grid gap-1 text-sm">{tr("Msimbo wa biashara (code)")}<Input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="bg-white text-slate-900" /></label>
            <label className="grid gap-1 text-sm">{tr("Sarafu")}<Input required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="bg-white text-slate-900" /></label>
            <div className="flex items-end"><Button type="submit" disabled={creating} className="w-full">{creating ? tr("Inasajili…") : tr("Sajili")}</Button></div>

            <div className="space-y-2 md:col-span-4">
              <p className="text-sm font-medium">{tr("Idara / sehemu za biashara (hiari)")}</p>
              <p className="text-xs text-blue-100">{tr("Mfano: biashara moja ina Bar, Lounge na Jiko. Kila idara ina stock, mauzo na hesabu zake; mmiliki anaweza kuona ripoti za pamoja.")}</p>
              {departments.map((d, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={d} onChange={(e) => setDepartments((x) => x.map((v, k) => (k === i ? e.target.value : v)))} placeholder={tr("Jina la idara")} className="bg-white text-slate-900" />
                  <Button type="button" variant="outline" size="icon" aria-label={tr("Ondoa")} className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setDepartments((x) => x.filter((_, k) => k !== i))}><X className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setDepartments((x) => [...x, ""])}><Plus className="mr-1 h-4 w-4" />{tr("Ongeza idara")}</Button>
            </div>

            <div className="md:col-span-4"><PlanFields value={plan} onChange={setPlan} light /></div>
          </form>
        )}

        {tab === "businesses" && businesses === undefined && <p className="text-sm text-blue-100">{tr("Inapakia biashara…")}</p>}
        {tab === "businesses" && businesses?.length === 0 && <p className="rounded-2xl border border-white/10 bg-[#061f4b]/60 p-6 text-sm">{tr("Bado hakuna biashara. Sajili ya kwanza kwa kubonyeza kitufe hapo juu.")}</p>}

        {tab === "businesses" && businesses && businesses.length > 0 && (
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tr("Tafuta biashara…")} className="h-10 bg-white pl-9 text-slate-900" />
          </label>
        )}
        {tab === "businesses" && businesses && businesses.length > 0 && shownBusinesses.length === 0 && <p className="text-sm text-blue-100">{tr("Hakuna biashara inayolingana.")}</p>}

        {tab === "businesses" && <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {shownBusinesses.map((b) => {
            const busy = busyId === String(b._id);
            const open = openCard === String(b._id);
            const paid = summary?.paidByTenant[String(b._id)] ?? 0;
            return (
              <article key={b._id} id={`biz-${b._id}`} className={`scroll-mt-24 rounded-xl border shadow-sm ${open ? "col-span-full" : ""} ${b.isActive ? "border-white/10 bg-[#061f4b]/70" : "border-amber-400/30 bg-[#061f4b]/50 opacity-90"}`}>
                <button type="button" aria-expanded={open} onClick={() => setOpenCard(open ? null : String(b._id))} className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${b.isActive ? "bg-emerald-400" : "bg-amber-400"}`} title={b.isActive ? tr("Inafanya kazi") : tr("Imesimamishwa")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-white" title={b.name}>{b.name}</span>
                    <span className="block truncate text-[10px] text-blue-200">{b.code} · {tr("Idara: {0}", [b.branchCount])}</span>
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && <div className="space-y-2 border-t border-white/10 p-3">
                  <SubscriptionBadge sub={b.subscription} />
                  {paid > 0 && <p className="text-xs text-blue-100">{tr("Jumla iliyolipwa: {0} TZS", [paid.toLocaleString()])}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" className="h-9 min-w-[10rem] flex-1" disabled={busy || !b.isActive} onClick={() => void enter(b._id)}>{tr("Ingia kwenye biashara")}</Button>
                    <Button size="sm" variant="outline" disabled={busy} className="h-9 border-white/30 bg-transparent px-3 text-white hover:bg-white/10 hover:text-white" onClick={() => void toggle(b._id, b.name, b.isActive)}>
                      {b.isActive ? <><Pause className="mr-1 h-4 w-4" />{tr("Simamisha")}</> : <><Play className="mr-1 h-4 w-4" />{tr("Washa tena")}</>}
                    </Button>
                    <Button size="icon" variant="outline" disabled={busy} aria-label={tr("Usajili")} title={tr("Usajili")} className="h-9 w-9 border-white/30 bg-transparent p-0 text-white hover:bg-white/10 hover:text-white" onClick={() => setOpenId(openId === String(b._id) ? null : String(b._id))}><CreditCard className="h-4 w-4" /></Button>
                    <Button size="icon" variant="outline" disabled={busy} aria-label={tr("Hariri biashara")} title={tr("Hariri biashara")} className="h-9 w-9 border-white/30 bg-transparent p-0 text-white hover:bg-white/10 hover:text-white" onClick={() => setEditId(editId === String(b._id) ? null : String(b._id))}><Pencil className="h-4 w-4" /></Button>
                  </div>
                  {openId === String(b._id) && <SubscriptionPanel tenantId={b._id} />}
                  {editId === String(b._id) && <ErrorBoundary inline resetKey={String(b._id)}><EditBusinessPanel tenantId={b._id} onDone={() => setEditId(null)} /></ErrorBoundary>}
                </div>}
              </article>
            );
          })}
        </div>}
      </div>
    </main>
  );
}
