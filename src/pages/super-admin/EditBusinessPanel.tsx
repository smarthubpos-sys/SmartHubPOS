import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { X, Plus } from "lucide-react";
import { ALL_MODULE_KEYS, MODULE_PRESETS } from "@/convex/permissions";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import ModulePicker from "@/components/module-picker.tsx";
import { errorText, tr } from "@/lib/i18n.ts";

/**
 * Super Admin: edit a business (name, code, currency) and choose which sidebar modules it has paid for.
 * Shown on a dark card (same look as the subscription panel).
 */
export default function EditBusinessPanel({ tenantId, onDone }: { tenantId: Id<"tenants">; onDone?: () => void }) {
  const data = useQuery(api.tenants.getEditable, { tenantId });
  const update = useMutation(api.tenants.update);
  const rebuild = useMutation(api.stats.rebuildBusiness);
  const branches = useQuery(api.tenants.listBranches, { tenantId });
  const addDepartment = useMutation(api.tenants.addDepartment);
  const removeDepartment = useMutation(api.tenants.removeDepartment);
  const [deptName, setDeptName] = useState("");
  const [deptBusy, setDeptBusy] = useState(false);
  async function addDept() {
    const n = deptName.trim();
    if (!n) return;
    setDeptBusy(true);
    try { await addDepartment({ tenantId, name: n }); setDeptName(""); toast.success(tr("Idara imeongezwa.")); }
    catch (err) { toast.error(errorText(err, "Hitilafu imetokea.")); }
    finally { setDeptBusy(false); }
  }
  async function removeDept(branchId: Id<"branches">) {
    setDeptBusy(true);
    try { await removeDepartment({ branchId }); }
    catch (err) { toast.error(errorText(err, "Imeshindikana kuondoa idara.")); }
    finally { setDeptBusy(false); }
  }
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [currency, setCurrency] = useState("TZS");
  const [modules, setModules] = useState<string[]>(ALL_MODULE_KEYS);
  const [waiterEnabled, setWaiterEnabled] = useState(false);
  const [waitressEnabled, setWaitressEnabled] = useState(false);
  const [waiterOrderMode, setWaiterOrderMode] = useState<"cashier" | "print">("cashier");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  // Initialize the editable draft once when the async query first resolves.
  // A guarded render-time update avoids an effect-driven cascading render and
  // does not overwrite edits when Convex refreshes the query afterward.
  if (data && !loaded) {
    setName(data.name);
    setCode(data.code);
    setCurrency(data.currency);
    setModules(data.modules ?? ALL_MODULE_KEYS);
    setWaiterEnabled(data.waiterEnabled ?? false);
    setWaitressEnabled(data.waitressEnabled ?? false);
    setWaiterOrderMode(data.waiterOrderMode ?? "cashier");
    setLoaded(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const everything = ALL_MODULE_KEYS.every((k) => modules.includes(k));
      await update({ tenantId, name, code, currency, waiterEnabled, waitressEnabled, waiterOrderMode, ...(everything ? { allModules: true } : { modules }) });
      toast.success(tr("Biashara imesasishwa."));
      onDone?.();
    } catch (err) { toast.error(errorText(err, "Hitilafu imetokea.")); }
    finally { setBusy(false); }
  }

  if (data === undefined) return <p className="rounded-xl bg-white/5 p-3 text-sm">{tr("Inapakia…")}</p>;
  if (data === null) return null;
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl bg-white/5 p-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1">{tr("Jina la biashara")}<Input required value={name} onChange={(e) => setName(e.target.value)} className="bg-white text-slate-900" /></label>
        <label className="grid gap-1">{tr("Msimbo wa biashara (code)")}<Input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="bg-white text-slate-900" /></label>
        <label className="grid gap-1">{tr("Sarafu")}<Input required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="bg-white text-slate-900" /></label>
      </div>

      <div className="space-y-2">
        <div className="space-y-3 rounded-lg border border-white/20 p-3">
          <p className="font-medium">{tr("Waiter Orders settings")}</p>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="enable-waiter" className="cursor-pointer">{tr("Enable Waiter")}</label>
            <Switch id="enable-waiter" checked={waiterEnabled} onCheckedChange={setWaiterEnabled} aria-label={tr("Enable Waiter")} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="enable-waitress" className="cursor-pointer">{tr("Enable Waitress")}</label>
            <Switch id="enable-waitress" checked={waitressEnabled} onCheckedChange={setWaitressEnabled} aria-label={tr("Enable Waitress")} />
          </div>
          <label className="grid gap-1">
            {tr("Namna ya waiter orders")}
            <select value={waiterOrderMode} onChange={(e) => setWaiterOrderMode(e.target.value as "cashier" | "print")} disabled={!waiterEnabled && !waitressEnabled} className="h-10 rounded-md border bg-white px-3 text-slate-900">
              <option value="cashier">{tr("Tuma kwa cashier")}</option>
              <option value="print">{tr("Mhudumu achapishe mwenyewe")}</option>
            </select>
          </label>
        </div>
        <p className="font-medium">{tr("Huduma (sidebar) alizolipia")}</p>
        <p className="text-xs opacity-80">{tr("Biashara itaona na kutumia huduma zilizotiwa tiki tu. Dashboard na Help ziko kila wakati. Meneja wa biashara anaweza kupunguza zaidi kwa kila mtumiaji.")}</p>
        <div className="flex flex-wrap gap-2">
          {MODULE_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => setModules(p.modules)} className="cursor-pointer rounded-lg border border-white/30 px-3 py-1 text-xs font-medium hover:bg-white/10">{tr(p.label)}</button>
          ))}
        </div>
        <ModulePicker value={modules} onChange={setModules} light />
      </div>

      <div className="space-y-2">
        <p className="font-medium">{tr("Idara / sehemu za biashara (hiari)")}</p>
        <p className="text-xs opacity-80">{tr("Mfano: biashara moja ina Bar, Lounge na Jiko. Kila idara ina stock, mauzo na hesabu zake; mmiliki anaweza kuona ripoti za pamoja.")}</p>
        <div className="flex flex-wrap gap-1.5">
          {branches === undefined ? <span className="text-xs opacity-80">{tr("Inapakia…")}</span> : branches.filter((b) => b.isActive).length === 0 ? <span className="text-xs opacity-80">{tr("Hakuna idara")}</span> : branches.filter((b) => b.isActive).map((b) => (
            <span key={b._id} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs">{b.name}
              <button type="button" disabled={deptBusy} aria-label={tr("Ondoa")} title={tr("Ondoa")} className="cursor-pointer opacity-80 hover:opacity-100" onClick={() => void removeDept(b._id)}><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={deptName} onChange={(e) => setDeptName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addDept(); } }} placeholder={tr("Jina la idara")} className="bg-white text-slate-900" />
          <Button type="button" variant="outline" disabled={deptBusy || !deptName.trim()} onClick={() => void addDept()} className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"><Plus className="mr-1 h-4 w-4" />{tr("Ongeza idara")}</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="flex-1">{busy ? tr("Inahifadhi…") : tr("Hifadhi mabadiliko")}</Button>
        <Button type="button" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" title={tr("Hesabu upya namba za dashboard ikiwa moja inaonekana si sahihi.")}
          onClick={() => void rebuild({ tenantId }).then(() => toast.success(tr("Namba za dashboard zinahesabiwa upya."))).catch((err) => toast.error(errorText(err, "Hitilafu imetokea.")))}>
          {tr("Hesabu upya dashboard")}
        </Button>
      </div>
    </form>
  );
}
