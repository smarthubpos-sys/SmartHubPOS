import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, X, Pencil } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { tr, errorText } from "@/lib/i18n.ts";
import PlanFields, { SubscriptionBadge } from "./PlanFields.tsx";
import EditBusinessPanel from "./EditBusinessPanel.tsx";
import ErrorBoundary from "@/components/error-boundary.tsx";
import { emptyPlan, planArgs, type PlanValue } from "./plan-utils.ts";

type Office = FunctionReturnType<typeof api.tenants.list>[number];

export default function SuperAdminPage() {
  const offices = useQuery(api.tenants.list, {});
  const create = useMutation(api.tenants.create);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [currency, setCurrency] = useState("TZS");
  const [departments, setDepartments] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanValue>(emptyPlan);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const setDept = (i: number, value: string) => setDepartments((d) => d.map((x, k) => (k === i ? value : x)));

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{tr("Super Admin · Usimamizi wa Ofisi")}</h1>
        <p className="text-muted-foreground">{tr("Unda biashara mpya. Idara (mf. Bar, Lounge, Jiko) ni hiari: kila idara ina hesabu zake zilizotengwa.")}</p>
      </header>
      <form
        className="grid gap-3 rounded-xl border p-4 md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const result = await create({ name, code, currency, departments: departments.map((d) => d.trim()).filter(Boolean), ...planArgs(plan) });
            setMessage(result.branchesCreated > 0 ? tr("Biashara imeundwa pamoja na idara {0}.", [result.branchesCreated]) : tr("Biashara imeundwa (bila idara)."));
            setName(""); setCode(""); setDepartments([]); setPlan(emptyPlan);
          } catch (err) { setMessage(errorText(err, "Imeshindikana kuunda ofisi")); } finally { setBusy(false); }
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Jina la ofisi")} required />
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={tr("Office code")} required />
        <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder={tr("Sarafu (TZS)")} required />
        <Button type="submit" disabled={busy}>{busy ? tr("Inaunda…") : tr("Unda biashara")}</Button>

        <div className="space-y-2 md:col-span-4">
          <p className="text-sm font-medium">{tr("Idara / sehemu za biashara (hiari)")}</p>
          <p className="text-xs text-muted-foreground">{tr("Mfano: biashara moja ina Bar, Lounge na Jiko. Kila idara ina stock, mauzo na hesabu zake; mmiliki anaweza kuona ripoti za pamoja.")}</p>
          {departments.map((d, i) => (
            <div key={i} className="flex gap-2">
              <Input value={d} onChange={(e) => setDept(i, e.target.value)} placeholder={tr("Jina la idara")} />
              <Button type="button" variant="outline" size="icon" aria-label={tr("Ondoa")} onClick={() => setDepartments((x) => x.filter((_, k) => k !== i))}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setDepartments((x) => [...x, ""])}><Plus className="mr-1 h-4 w-4" />{tr("Ongeza idara")}</Button>
        </div>
        <div className="md:col-span-4"><PlanFields value={plan} onChange={setPlan} /></div>
        {message && <p className="text-sm md:col-span-4" role="status">{message}</p>}
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50"><tr><th className="p-3 text-left">{tr("Ofisi")}</th><th className="p-3 text-left">{tr("Code")}</th><th className="p-3 text-left">{tr("Hali")}</th><th className="p-3 text-left">{tr("Usajili")}</th><th className="p-3 text-left">{tr("Idara")}</th></tr></thead>
          <tbody>
            {offices?.map((o) => <OfficeRow key={o._id} office={o} />)}
            {offices?.length === 0 && <tr><td colSpan={5} className="p-4 text-muted-foreground">{tr("Bado hakuna ofisi. Unda ya kwanza hapo juu.")}</td></tr>}
            {offices === undefined && <tr><td colSpan={5} className="p-4">{tr("Inapakia…")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{tr("Ulinzi wa Super Admin unatekelezwa pia kwenye Convex backend; kuficha ukurasa pekee hakutoshi kwa usalama.")}</p>
    </section>
  );
}

function OfficeRow({ office }: { office: Office }) {
  const branches = useQuery(api.tenants.listBranches, { tenantId: office._id });
  const add = useMutation(api.tenants.addDepartment);
  const remove = useMutation(api.tenants.removeDepartment);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  return (
    <tr className="border-t align-top">
      <td className="p-3 font-medium">{office.name}
        <div className="mt-1"><Button type="button" size="icon" variant="outline" className="h-8 w-8" title={editing ? tr("Funga") : tr("Hariri biashara")} aria-label={editing ? tr("Funga") : tr("Hariri biashara")} onClick={() => setEditing((e) => !e)}>{editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}</Button></div>
        {editing && <div className="mt-2 w-[min(90vw,34rem)] rounded-xl border border-border bg-card p-2 text-card-foreground shadow-lg"><ErrorBoundary inline><EditBusinessPanel tenantId={office._id} onDone={() => setEditing(false)} /></ErrorBoundary></div>}
      </td>
      <td className="p-3">{office.code}</td>
      <td className="p-3">{office.isActive ? tr("Active") : tr("Inactive")}</td>
      <td className="p-3"><SubscriptionBadge sub={office.subscription} /></td>
      <td className="p-3">
        <div className="mb-1 flex flex-wrap gap-1 text-xs">
          {branches === undefined ? "…" : branches.filter((b) => b.isActive).length === 0 ? <span className="text-muted-foreground">{tr("Hakuna idara")}</span> : branches.filter((b) => b.isActive).map((b) => (
            <span key={b._id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">{b.name}
              <button type="button" className="cursor-pointer text-muted-foreground hover:text-destructive" aria-label={tr("Ondoa")} onClick={async () => { setError(""); try { await remove({ branchId: b._id }); } catch (err) { setError(errorText(err, "Imeshindikana kuondoa idara.")); } }}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
        <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); setError(""); try { await add({ tenantId: office._id, name }); setName(""); } catch (err) { setError(errorText(err, "Imeshindikana kuongeza idara.")); } }}>
          <Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Idara mpya")} />
          <Button type="submit" size="sm" variant="outline" disabled={!name.trim()}>{tr("Ongeza")}</Button>
        </form>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}
