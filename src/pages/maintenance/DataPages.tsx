import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { useRun } from "./helpers.ts";
import { useState } from "react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, Loading, PageShell, SelectField, TextField } from "./_shared";
import { tr } from "@/lib/i18n.ts";

/* ───────── Backup & Restore ───────── */
export function BackupPage() {
  const convex = useConvex();
  const tables = useQuery(api.maintenance.backupTables, {});
  const record = useMutation(api.maintenance.recordBackup);
  const { busy, run } = useRun();
  const [progress, setProgress] = useState("");

  const exportAll = () => run(async () => {
    if (!tables) throw new Error(tr("Subiri orodha ya tables."));
    const out: Record<string, unknown[]> = {};
    let total = 0;
    for (const table of tables) {
      const rows: unknown[] = [];
      let cursor: string | null = null;
      for (;;) {
        setProgress(tr("Inapakua {0}… ({1})", [table, rows.length]));
        const page: { rows: unknown[]; isDone: boolean; cursor: string } = await convex.query(api.maintenance.exportTable, { table, cursor });
        rows.push(...page.rows);
        if (page.isDone) break;
        cursor = page.cursor;
      }
      out[table] = rows; total += rows.length;
    }
    const blob = new Blob([JSON.stringify({ app: "SmartHubPOS", exportedAt: new Date().toISOString(), tables: out }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `smarthubpos-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    await record({ tables: tables.length, rows: total });
    setProgress(tr("Imekamilika: tables {0}, rows {1}.", [tables.length, total]));
  }, tr("Backup imepakuliwa."));

  return (
    <PageShell title={tr("Backup and Restore")} subtitle={tr("Nakala ya hifadhi ya database (Super Admin pekee)")}>
      <Card title={tr("Backup (export)")}>
        <p className="text-sm">{tr("Inapakua data zote za biashara kwenye faili la JSON. Password na sessions za watumiaji")} <b>{tr("hazimo")}</b>  {tr("kwenye backup kwa usalama.")}</p>
        <Button disabled={busy || !tables} onClick={() => void exportAll()}>{busy ? tr("Inapakua…") : tr("Pakua backup sasa")}</Button>
        {progress && <p className="text-sm text-muted-foreground">{progress}</p>}
        {tables === undefined && <Loading />}
      </Card>
      <Card title={tr("Restore")}>
        <p className="text-sm">{tr("Restore ya database nzima haifanyiki ndani ya app kwa sababu IDs za Convex hubadilika na data za kifedha zinahitaji uadilifu kamili. Tumia zana rasmi za Convex:")}</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{tr(`# Snapshot kamili (inajumuisha password hashes) — hifadhi mahali salama
npx convex export --path backup.zip

# Kurejesha (deployment sahihi!)
npx convex import --replace-all backup.zip`)}</pre>
        <p className="text-xs text-muted-foreground">{tr("Pia unaweza kutumia Backups kwenye Convex Dashboard > Settings > Backup & Restore. Jaribu kwanza kwenye deployment ya majaribio.")}</p>
      </Card>
    </PageShell>
  );
}

/* ───────── Audit trail ───────── */
export function AuditPage() {
  const [module, setModule] = useState("");
  const [q, setQ] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const me = useQuery(api.tenants.current, {});
  const businesses = useQuery(api.tenants.list, me?.isSuperAdmin ? {} : "skip");
  const logs = useQuery(api.maintenance.listAudit, { module: module || undefined, limit: 500, ...(tenantFilter ? { tenantId: tenantFilter as Id<"tenants"> } : {}) });
  const rows = (logs ?? []).filter((l) => !q || `${l.userName} ${l.action} ${l.details ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <PageShell title={tr("Audit Trail")} subtitle={tr("Kumbukumbu ya shughuli za mfumo (mpya kwanza)")}>
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField label={tr("Moduli")} value={module} onChange={setModule} options={[["", tr("Zote")], ["maintenance", tr("Maintenance")], ["purchasing", tr("Purchasing")], ["sales", tr("Sales")], ["stock", tr("Stock")], ["payroll", tr("Payroll")], ["accounts", tr("Accounts")]]} />
        {me?.isSuperAdmin && <SelectField label={tr("Biashara")} value={tenantFilter} onChange={setTenantFilter} options={[["", me.tenant ? tr("Biashara niliyoichagua") : tr("Zote")], ...(businesses ?? []).map((b): [string, string] => [String(b._id), b.name])]} />}
        <TextField label={tr("Tafuta")} value={q} onChange={setQ} placeholder={tr("mtumiaji, kitendo, maelezo…")} />
      </div>
      <section className="overflow-x-auto rounded-xl border">
        {!logs ? <div className="p-4"><Loading /></div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr>{[tr("Muda"), ...(me?.isSuperAdmin ? [tr("Biashara")] : []), tr("Mtumiaji"), tr("Moduli"), tr("Kitendo"), tr("Maelezo"), tr("Matokeo")].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l._id} className="border-t align-top">
                  <td className="whitespace-nowrap p-3">{new Date(l.timestamp).toLocaleString()}</td>{me?.isSuperAdmin && <td className="p-3">{l.tenantName}</td>}<td className="p-3">{l.userName}</td>
                  <td className="p-3">{l.module}</td><td className="p-3 font-mono text-xs">{l.action}</td><td className="p-3">{l.details ?? "—"}</td>
                  <td className="p-3">{l.result}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="p-4 text-muted-foreground">{tr("Hakuna kumbukumbu.")}</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </PageShell>
  );
}

/* ───────── Database maintenance ───────── */
export function DatabasePage() {
  const health = useQuery(api.maintenance.healthCheck, {});
  const assign = useMutation(api.maintenance.assignUnscoped);
  const purge = useMutation(api.maintenance.purgeAuditLogs);
  const bookWaiterJournals = useMutation(api.waiterCollections.bookMissingJournals);
  const { busy, run } = useRun();
  const [days, setDays] = useState("365");
  const [booked, setBooked] = useState<{ booked: number; skipped: number } | null>(null);
  const issues = health ? [
    health.superAdmins === 0 && tr("Hakuna Super Admin aliye active."),
    health.usersWithoutRole > 0 && tr("Watumiaji {0} hawana role.", [health.usersWithoutRole]),
    health.usersWithoutOffice > 0 && tr("Watumiaji {0} (si Super Admin) hawajaunganishwa na ofisi.", [health.usersWithoutOffice]),
    health.duplicateSupplierCodes.length > 0 && tr("Supplier codes zinazojirudia: {0}", [health.duplicateSupplierCodes.join(", ")]),
    ...health.unscoped.map((u) => tr("{0}: rekodi {1} hazina ofisi/branch (hazionekani kwa watumiaji wa ofisi).", [u.table, u.count])),
  ].filter(Boolean) as string[] : [];
  return (
    <PageShell title={tr("Database Maintenance")} subtitle={tr("Ukaguzi wa afya ya data na usafishaji (Super Admin pekee)")}>
      <Card title={tr("Re-index & optimize")}>
        <p className="text-sm">{tr("Convex hutunza na kuboresha indexes kiotomatiki kila schema inapo-deploy; hakuna hatua ya mkono inayohitajika. Ukurasa huu unakagua")} <b>{tr("uadilifu wa data")}</b>  {tr("na kusafisha taka.")}</p>
      </Card>
      <Card title={tr("Ukaguzi wa afya")}>
        {!health ? <Loading /> : issues.length === 0 ? <p className="text-sm text-emerald-700">{tr("Hakuna tatizo lililogunduliwa ✔")}</p> : (
          <ul className="list-disc space-y-1 pl-5 text-sm">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
        )}
        {health && health.legacyProfiles > 0 && <p className="text-xs text-muted-foreground">{tr("Kumbukumbu za profile za zamani (per-session):")} {health.legacyProfiles}{tr(". Hazitumiki tena; hazina madhara.")}</p>}
        {health && health.unscoped.length > 0 && (
          <Button disabled={busy} onClick={() => void run(async () => { const r = await assign({}); if (r.more) throw new Error(tr("Zimeunganishwa {0}; bado zipo — bonyeza tena.", [r.updated])); }, tr("Rekodi zimeunganishwa na ofisi/branch ya kwanza."))}>{tr("Unganisha rekodi zisizo na ofisi na ofisi ya kwanza")}</Button>
        )}
      </Card>
      <Card title={tr("Hesabu za mauzo ya Selling Point (za zamani)")}>
        <p className="text-sm">{tr("Malipo ya wahudumu yaliyopokelewa kabla ya marekebisho haya hayakuingia kwenye hesabu (Profit & Loss, Cash flow, Balance sheet). Kitufe hiki kinaingiza ambayo hayajaingizwa; ukibonyeza mara mbili hakirudii. Chagua biashara kwanza.")}</p>
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => { setBooked(await bookWaiterJournals({})); }, tr("Imekamilika."))}>{tr("Ingiza hesabu zilizokosekana")}</Button>
        {booked && <p className="text-sm">{tr("Zimeingizwa: {0}. Zimerukwa (kipindi kimefungwa): {1}.", [booked.booked, booked.skipped])}</p>}
      </Card>
      <Card title={tr("Idadi ya rekodi kwa table")}>
        {!health ? <Loading /> : (
          <div className="grid gap-x-8 gap-y-1 text-sm md:grid-cols-3">
            {health.counts.map((c) => <div key={c.table} className="flex justify-between border-b py-1"><span className="font-mono text-xs">{c.table}</span><span>{c.count}{c.capped ? "+" : ""}</span></div>)}
          </div>
        )}
      </Card>
      <Card title={tr("Safisha audit logs za zamani")}>
        <div className="flex flex-wrap items-end gap-3">
          <TextField label={tr("Za zaidi ya siku")} type="number" value={days} onChange={setDays} hint={tr("Kiwango cha chini: 30")} />
          <Button variant="outline" disabled={busy} onClick={() => { if (confirm(tr("Futa audit logs za zaidi ya siku {0}?", [days]))) void run(async () => { const r = await purge({ olderThanDays: Number(days) }); if (r.more) throw new Error(tr("Zimefutwa {0}; bado zipo — bonyeza tena.", [r.deleted])); }, tr("Audit logs za zamani zimefutwa.")); }}>{tr("Futa")}</Button>
        </div>
      </Card>
    </PageShell>
  );
}

/* ───────── Clear Data File ───────── */
export function ClearDataPage() {
  const overview = useQuery(api.maintenance.clearDataOverview, {});
  const clear = useAction(api.maintenance.clearData);
  const { busy, run } = useRun();
  const [picked, setPicked] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [scopeChoice, setScopeChoice] = useState<string | null>(null); // null = the department the Super Admin is working in (or the whole business when none is chosen)

  if (overview === undefined) return <PageShell title={tr("Clear Data File")}><Loading /></PageShell>;
  if (!overview.isSuperAdmin) {
    return <PageShell title={tr("Clear Data File")}><p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{tr("Ukurasa huu ni wa Super Admin pekee.")}</p></PageShell>;
  }
  const departments = overview.departments ?? [];
  // "all" = the whole business; otherwise the id of ONE department: only that department's data is deleted.
  const scope = scopeChoice ?? (overview.currentBranchId && departments.some((d) => d._id === overview.currentBranchId) ? String(overview.currentBranchId) : "all");
  const scopeName = scope === "all" ? tr("biashara nzima (idara zote)") : (departments.find((d) => String(d._id) === scope)?.name ?? "");
  const all = overview.categories.map((c) => c.key).filter((k) => scope === "all" || k !== "auditLogs"); // audit logs belong to the whole business, not to one department
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  const names = overview.categories.filter((c) => picked.includes(c.key)).map((c) => c.label).join(", ");
  const canSubmit = !busy && !!overview.tenantName && picked.length > 0 && password.length > 0;

  const submit = () => {
    if (!confirm(tr("Utafuta KUDUMU: {0} ya biashara {1} — {2}. Hatua hii haiwezi kurudishwa. Endelea?", [names, overview.tenantName, scope === "all" ? scopeName : tr("idara ya {0} PEKEE", [scopeName])]))) return;
    void run(async () => {
      const r = await clear({ categories: picked, password, ...(scope === "all" ? { wholeBusiness: true } : { branchId: scope as Id<"branches"> }) });
      setPassword("");
      setPicked([]);
      return r;
    }, tr("Data imefutwa."));
  };

  return (
    <PageShell title={tr("Clear Data File")} subtitle={tr("Futa data ya biashara iliyochaguliwa (Super Admin pekee)")}>
      <Card title={tr("Chagua data ya kufuta")}>
        {overview.tenantName
          ? <p className="text-sm">{tr("Biashara itakayoathirika:")} <b>{overview.tenantName}</b></p>
          : <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">{tr("Chagua biashara kwanza (Badilisha biashara) kisha rudi hapa.")}</p>}
        {departments.length > 0 && (
          <SelectField label={tr("Data ya kufuta ni ya")} value={scope} onChange={(v) => { setScopeChoice(v); setPicked((p) => (v === "all" ? p : p.filter((k) => k !== "auditLogs"))); }}
            options={[["all", tr("Biashara nzima (idara zote)")], ...departments.map((d) => [String(d._id), tr("Idara: {0} pekee", [d.name])] as [string, string])]}
            hint={scope === "all" ? tr("Itafuta data ya idara ZOTE za biashara hii.") : tr("Itafuta data ya idara hii tu. Idara nyingine na orodha za biashara nzima (mfano suppliers wa biashara nzima) haziguswi.")} />
        )}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={picked.length === all.length} onChange={(e) => setPicked(e.target.checked ? all : [])} />
          {tr("Chagua zote")}
        </label>
        <div className="grid gap-2 md:grid-cols-2">
          {overview.categories.filter((c) => scope === "all" || c.key !== "auditLogs").map((c) => (
            <label key={c.key} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm hover:bg-muted/40">
              <input type="checkbox" className="mt-1" checked={picked.includes(c.key)} onChange={() => toggle(c.key)} />
              <span><span className="font-medium">{c.label}</span><span className="block text-xs text-muted-foreground">{c.description}</span></span>
            </label>
          ))}
        </div>
      </Card>
      <Card title={tr("Thibitisha kwa password ya Super Admin")}>
        <TextField label={tr("Password ya Super Admin")} type="password" value={password} onChange={setPassword} hint={tr("Ingiza password yako ya Super Admin ili kuruhusu kufuta.")} />
        <Button variant="destructive" disabled={!canSubmit} onClick={submit}>{busy ? tr("Inafuta…") : tr("Futa data iliyochaguliwa")}</Button>
        <p className="text-xs text-muted-foreground">{scope === "all" ? tr("Inafuta data ya biashara iliyochaguliwa tu (idara zote). Tengeneza backup kwanza kupitia Backup and Restore.") : tr("Inafuta data ya idara iliyochaguliwa tu. Tengeneza backup kwanza kupitia Backup and Restore.")}</p>
      </Card>
    </PageShell>
  );
}
