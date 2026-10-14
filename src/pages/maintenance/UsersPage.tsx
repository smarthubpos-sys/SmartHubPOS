import { useRun } from "./helpers.ts";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, Loading, PageShell, SelectField, TextField } from "./_shared";
import { useAuth } from "@/hooks/use-auth";
import ModulePicker from "@/components/module-picker.tsx";
import { ALL_MODULE_KEYS } from "@/convex/permissions";
import { tr } from "@/lib/i18n.ts";

type Form = { id?: Id<"users">; name: string; username: string; password: string; role: string; tenantId: string; branchId: string; menuAll: boolean; menu: string[]; ownDataOnly: boolean };
const empty: Form = { name: "", username: "", password: "", role: "cashier", tenantId: "", branchId: "", menuAll: true, menu: ALL_MODULE_KEYS, ownDataOnly: false };

export default function UsersPage() {
  const { user: me } = useAuth();
  const users = useQuery(api.maintenance.listUsers, {});
  const roles = useQuery(api.maintenance.listRoles, {});
  const offices = useQuery(api.maintenance.listOffices, {});
  const create = useAction(api.maintenance.createUser);
  const reset = useAction(api.maintenance.resetUserPassword);
  const update = useMutation(api.maintenance.updateUser);
  const { busy, run } = useRun();
  const [f, setF] = useState<Form | null>(null);
  const set = (k: keyof Form, v: string) => setF((p) => (p ? { ...p, [k]: v } : p));
  const isSuper = ["super_admin", "superadmin"].includes(String(me?.role ?? "").toLowerCase().replace(/[\s-]+/g, "_"));
  const roleOptions = (roles ?? []).filter((r) => isSuper || r.name !== "super_admin").map((r) => [r.name, r.displayName] as [string, string]);
  if (isSuper) roleOptions.unshift(["super_admin", tr("Super Admin")]);
  const tenantName = (id?: string) => offices?.tenants.find((t) => t._id === id)?.name ?? "—";
  const branchName = (id?: string) => offices?.branches.find((b) => b._id === id)?.name ?? tr("Zote");
  const branches = (offices?.branches ?? []).filter((b) => b.tenantId === (f?.tenantId || me?.tenantId));
  const tenantModules = offices?.tenants.find((t) => t._id === (f?.tenantId || me?.tenantId))?.modules ?? undefined; // what this business has paid for
  const editingSelf = !!f?.id && String(f.id) === String(me?._id);

  if (f) {
    const editing = !!f.id;
    return (
      <PageShell title={editing ? tr("Modify User") : tr("Add User")}>
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label={tr("Jina kamili")} value={f.name} onChange={(v) => set("name", v)} />
            <TextField label={tr("Username")} value={f.username} onChange={(v) => set("username", v.toLowerCase())} disabled={editing} hint={tr("Herufi ndogo/namba, 3–32, bila nafasi.")} />
            {!editing && <TextField label={tr("Password ya kuanzia")} type="password" value={f.password} onChange={(v) => set("password", v)} />}
            <SelectField label={tr("Role")} value={f.role} onChange={(v) => set("role", v)} options={roleOptions} />
            {isSuper && f.role !== "super_admin" && (
              <SelectField label={tr("Ofisi")} value={f.tenantId} onChange={(v) => setF((p) => (p ? { ...p, tenantId: v, branchId: "" } : p))} options={[["", tr("— chagua ofisi —")], ...(offices?.tenants ?? []).map((t) => [t._id, t.name] as [string, string])]} />
            )}
            {f.role !== "super_admin" && (
              <SelectField label={tr("Branch")} value={f.branchId} onChange={(v) => set("branchId", v)} hint={tr("Acha 'Zote' ili aone branches zote za ofisi.")} options={[["", tr("Zote")], ...branches.map((b) => [b._id, b.name] as [string, string])]} />
            )}
            {f.role !== "super_admin" && !editingSelf && (
              <div className="space-y-2 rounded-xl border p-3 md:col-span-2">
                <p className="text-sm font-medium">{tr("Menyu (sidebar) anazoweza kuona")}</p>
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={f.menuAll} onChange={(e) => setF((p) => (p ? { ...p, menuAll: e.target.checked } : p))} />{tr("Zote ambazo biashara ina")}</label>
                {!f.menuAll && <ModulePicker value={f.menu} onChange={(menu) => setF((p) => (p ? { ...p, menu } : p))} available={tenantModules} />}
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={f.ownDataOnly} onChange={(e) => setF((p) => (p ? { ...p, ownDataOnly: e.target.checked } : p))} />{tr("Aone mauzo na bili zake tu (dashboard yake binafsi)")}</label>
                <p className="text-xs text-muted-foreground">{tr("Mfano mhudumu: ruhusu Sales na Bills tu, na weka 'aone mauzo na bili zake tu'. Huduma ambazo biashara haijalipia hazionekani hapa.")}</p>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Button disabled={busy} onClick={() => void run(async () => {
              if (!f.name.trim() || (!editing && !f.username)) throw new Error(tr("Jina na username vinahitajika."));
              const tenantId = (f.tenantId || undefined) as Id<"tenants"> | undefined;
              const branchId = (f.branchId || undefined) as Id<"branches"> | undefined;
              // New users: send ownDataOnly only when ticked, so a normal user can always be created even if the backend is a version behind.
              const access = f.role === "super_admin" ? {} : editing ? { ownDataOnly: f.ownDataOnly } : f.ownDataOnly ? { ownDataOnly: true } : {};
              const menu = f.menuAll ? {} : { menuAccess: f.menu };
              if (editing) await update({ userId: f.id!, name: f.name, role: f.role, tenantId, branchId, clearBranch: !f.branchId, ...(editingSelf ? {} : { ...access, ...(f.menuAll ? { clearMenuAccess: true } : menu) }) });
              else await create({ name: f.name, username: f.username, password: f.password, role: f.role, tenantId, branchId, ...access, ...menu });
              setF(null);
            }, editing ? tr("Mtumiaji amesasishwa.") : tr("Mtumiaji ameundwa."))}>{tr("Hifadhi")}</Button>
            <Button variant="outline" onClick={() => setF(null)}>{tr("Ghairi")}</Button>
          </div>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell title={tr("User Settings")} subtitle={tr("Ongeza na badilisha watumiaji")}>
      <div><Button onClick={() => setF({ ...empty, tenantId: me?.tenantId ?? "" })}>{tr("＋ Add User")}</Button></div>
      <section className="overflow-x-auto rounded-xl border">
        {!users ? <div className="p-4"><Loading /></div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr>{[tr("Jina"), tr("Username"), tr("Role"), tr("Ofisi"), tr("Branch"), tr("Hali"), tr("Vitendo")].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className="border-t">
                  <td className="p-3 font-medium">{u.name ?? "—"}</td><td className="p-3">{u.username ?? "—"}</td>
                  <td className="p-3">{roles?.find((r) => r.name === u.role)?.displayName ?? u.role}</td>
                  <td className="p-3">{tenantName(u.tenantId)}</td><td className="p-3">{branchName(u.branchId)}</td>
                  <td className="p-3">{u.isActive ? tr("Active") : tr("Disabled")}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setF({ id: u._id, name: u.name ?? "", username: u.username ?? "", password: "", role: u.role, tenantId: u.tenantId ?? "", branchId: u.branchId ?? "", menuAll: u.menuAccess === null, menu: u.menuAccess ?? ALL_MODULE_KEYS, ownDataOnly: u.ownDataOnly })}>{tr("Modify")}</Button>
                      <Button size="sm" variant="outline" onClick={() => { const p = prompt(tr("Password mpya ya {0}:", [u.username])); if (p) void run(() => reset({ userId: u._id, newPassword: p }), tr("Password imebadilishwa; ataingia upya.")); }}>{tr("Reset password")}</Button>
                      {String(me?._id) !== String(u._id) && (
                        <Button size="sm" variant="outline" onClick={() => void run(() => update({ userId: u._id, isActive: !u.isActive }), u.isActive ? tr("Amezimwa.") : tr("Amewashwa."))}>{u.isActive ? tr("Disable") : tr("Enable")}</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={7} className="p-4 text-muted-foreground">{tr("Hakuna watumiaji.")}</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </PageShell>
  );
}
