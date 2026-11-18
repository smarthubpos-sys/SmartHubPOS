import { Fragment, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tr, trValue, errorText } from "@/lib/i18n.ts";

type Account = { _id: Id<"accounts">; code: string; name: string; type: string; balance: number; isActive: boolean; isSystem?: boolean; branchId?: Id<"branches">; description?: string };

/** Chart of Accounts: where each account lives (All locations or one department), and edit / switch off / delete. */
export default function ChartOfAccountsTable({ accounts }: { accounts: Account[] }) {
  const tenant = useQuery(api.tenants.current);
  const update = useMutation(api.accounting.updateAccount);
  const remove = useMutation(api.accounting.deleteAccount);
  const departments = tenant?.departments ?? [];
  const businessWide = !tenant?.activeBranchId; // only a business-wide user (no single department selected) can move accounts between locations
  const nameOf = (id?: Id<"branches">) => (id ? (departments.find((d) => d._id === id)?.name ?? tr("Idara")) : tr("Maeneo yote (All locations)"));
  const [editId, setEditId] = useState<string>("");
  const [f, setF] = useState({ name: "", code: "", description: "", location: "" });
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); return true; }
    catch (e) { toast.error(errorText(e, tr("Imeshindikana. Hakuna kilichobadilishwa."))); return false; }
    finally { setBusy(false); }
  };
  const open = (a: Account) => {
    if (editId === String(a._id)) { setEditId(""); return; }
    setEditId(String(a._id));
    setF({ name: a.name, code: a.code, description: a.description ?? "", location: a.branchId ? String(a.branchId) : "all" });
  };
  const save = async (a: Account) => {
    const body: { accountId: Id<"accounts">; name: string; description: string; code?: string; location?: "all" | Id<"branches"> } = { accountId: a._id, name: f.name, description: f.description };
    if (!a.isSystem && f.code.trim() !== a.code) body.code = f.code;
    if (businessWide && departments.length > 0) {
      const now = a.branchId ? String(a.branchId) : "all";
      if (f.location !== now) body.location = f.location === "all" ? "all" : (f.location as Id<"branches">);
    }
    if (await act(() => update(body), tr("Account imebadilishwa."))) setEditId("");
  };

  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="border-b p-4 font-semibold">{tr("Chart of accounts")} <span className="text-sm font-normal text-muted-foreground">({accounts.length})</span></div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr>{[tr("Code"), tr("Jina"), tr("Aina"), tr("Eneo"), tr("Balance"), tr("Hali"), ""].map((h, i) => <th key={i} className="whitespace-nowrap bg-muted/50 p-3">{h}</th>)}</tr></thead>
          <tbody>
            {accounts.map((a) => (
              <Fragment key={String(a._id)}>
                <tr className={`border-t ${a.isActive ? "" : "text-muted-foreground"}`}>
                  <td className="whitespace-nowrap p-3">{a.code}</td>
                  <td className="p-3">{a.name}</td>
                  <td className="whitespace-nowrap p-3">{trValue(a.type)}</td>
                  <td className="whitespace-nowrap p-3">{nameOf(a.branchId)}</td>
                  <td className="whitespace-nowrap p-3 tabular-nums">{a.balance}</td>
                  <td className="whitespace-nowrap p-3">{a.isActive ? tr("Inatumika") : tr("Imezimwa")}</td>
                  <td className="whitespace-nowrap p-3 text-right"><Button size="sm" variant="outline" disabled={busy} onClick={() => open(a)}>{tr("Hariri")}</Button></td>
                </tr>
                {editId === String(a._id) && (
                  <tr className="border-t bg-muted/30">
                    <td colSpan={7} className="space-y-3 p-4">
                      <div className="grid gap-3 md:grid-cols-4">
                        <label className="grid gap-1 text-xs">{tr("Jina la account")}<Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
                        <label className="grid gap-1 text-xs">{tr("Account code")}<Input value={f.code} disabled={!!a.isSystem} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
                        <label className="grid gap-1 text-xs">{tr("Maelezo")}<Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
                        {departments.length > 0 && (
                          <label className="grid gap-1 text-xs">{tr("Eneo (Location)")}
                            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={f.location} disabled={!businessWide} onChange={(e) => setF({ ...f, location: e.target.value })}>
                              <option value="all">{tr("Maeneo yote (All locations)")}</option>
                              {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                      {departments.length > 0 && <p className="text-xs text-muted-foreground">{businessWide ? tr("Account ya \"Maeneo yote\" inatumika na kila idara, lakini kila idara inabeba hesabu zake peke yake.") : tr("Kubadilisha eneo, chagua \"All departments\" kwenye menyu ya juu.")}</p>}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={busy || f.name.trim().length < 2} onClick={() => void save(a)}>{tr("Hifadhi mabadiliko")}</Button>
                        {!a.isSystem && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => update({ accountId: a._id, isActive: !a.isActive }), a.isActive ? tr("Account imezimwa.") : tr("Account imewashwa.")).then((ok) => ok && setEditId(""))}>{a.isActive ? tr("Zima (Deactivate)") : tr("Washa")}</Button>}
                        {!a.isSystem && <Button size="sm" variant="destructive" disabled={busy} onClick={() => { if (window.confirm(tr("Futa account {0}? Inawezekana tu kama haijatumika kabisa.", [`${a.code} ${a.name}`]))) void act(() => remove({ accountId: a._id }), tr("Account imefutwa.")).then((ok) => ok && setEditId("")); }}>{tr("Futa")}</Button>}
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditId("")}>{tr("Ghairi")}</Button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!accounts.length && <p className="p-5 text-sm text-muted-foreground">{tr("Hakuna taarifa bado.")}</p>}
      </div>
    </section>
  );
}
