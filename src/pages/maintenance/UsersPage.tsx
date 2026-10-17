import { useRun } from "./helpers.ts";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, Loading, PageShell, SelectField, TextField } from "./_shared";
import { useAuth } from "@/hooks/use-auth";
import ModulePicker from "@/components/module-picker.tsx";
import { ALL_MODULE_KEYS, SUPER_ADMIN_ONLY_PERMISSIONS, USER_GRANTABLE_PERMISSIONS } from "@/convex/permissions";
import { useStockRights } from "@/hooks/use-stock-rights.ts";
import { tr } from "@/lib/i18n.ts";

type Form = { id?: Id<"users">; name: string; username: string; password: string; role: string; tenantId: string; branchIds: string[]; allDepartments: boolean; menuAll: boolean; menu: string[]; ownDataOnly: boolean; extra: string[] };
const empty: Form = { name: "", username: "", password: "", role: "cashier", tenantId: "", branchIds: [], allDepartments: false, menuAll: true, menu: ALL_MODULE_KEYS, ownDataOnly: false, extra: [] };

export default function UsersPage() {
  const { user: me } = useAuth();
  const { isSuperAdmin: meSuperAdmin } = useStockRights();
  const users = useQuery(api.maintenance.listUsers, {});
  const roles = useQuery(api.maintenance.listRoles, {});
  const offices = useQuery(api.maintenance.listOffices, {});
  const create = useAction(api.maintenance.createUser);
  const reset = useAction(api.maintenance.resetUserPassword);
  const update = useMutation(api.maintenance.updateUser);
  const rename = useMutation(api.maintenance.renameUsername);
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
  // A user tied to ONE department can only create/manage users of that same department.
  // A user tied to one department, or given a few, can only give those same departments to others. null = no limit.
  const myLimit: string[] | null = isSuper ? null : me?.branchIds && me.branchIds.length > 1 ? me.branchIds.map(String) : me?.branchId && !me?.branchPicked ? [String(me.branchId)] : null;
  const departmentRoles = ["cashier", "accountant", "viewer"]; // these must always belong to one department when the business has departments
  const needsBranch = !!f && !editingSelf && f.role !== "super_admin" && branches.length > 0 && departmentRoles.includes(f.role) && !f.allDepartments && f.branchIds.length === 0;
  const branchChoices = myLimit ? branches.filter((b) => myLimit.includes(b._id)) : branches;

  if (f) {
    const editing = !!f.id;
    return (
      <PageShell title={editing ? tr("Modify User") : tr("Add User")}>
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label={tr("Jina kamili")} value={f.name} onChange={(v) => set("name", v)} />
            <TextField label={tr("Username")} value={f.username} onChange={(v) => set("username", v.toLowerCase())} disabled={editing && editingSelf} hint={tr("Herufi ndogo/namba, 3–32, bila nafasi. Jina ni la kipekee kwa biashara zote (mfano asha.duka1). Biashara moja inaweza kuwa na admin na watumiaji wengi wa role moja, kila mmoja akiwa na username yake.")} />
            {!editing && <TextField label={tr("Password ya kuanzia")} type="password" value={f.password} onChange={(v) => set("password", v)} />}
            <SelectField label={tr("Role")} value={f.role} onChange={(v) => set("role", v)} options={roleOptions} />
            {isSuper && f.role !== "super_admin" && (
              <SelectField label={tr("Ofisi")} value={f.tenantId} onChange={(v) => setF((p) => (p ? { ...p, tenantId: v, branchIds: [], allDepartments: false } : p))} options={[["", tr("— chagua ofisi —")], ...(offices?.tenants ?? []).map((t) => [t._id, t.name] as [string, string])]} />
            )}
            {f.role !== "super_admin" && branches.length > 0 && (
              <div className="space-y-2 rounded-xl border p-3 md:col-span-2">
                <p className="text-sm font-medium">{tr("Idara anazoweza kufanyia kazi")}</p>
                {!myLimit && (
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" disabled={editingSelf} checked={f.allDepartments} onChange={(e) => setF((p) => (p ? { ...p, allDepartments: e.target.checked } : p))} />
                    {tr("Idara zote")}
                  </label>
                )}
                {!f.allDepartments && (
                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {branchChoices.map((b) => (
                      <label key={b._id} className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
                        <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" disabled={editingSelf} checked={f.branchIds.includes(b._id)}
                          onChange={(e) => setF((p) => (p ? { ...p, branchIds: e.target.checked ? [...p.branchIds, b._id] : p.branchIds.filter((x) => x !== b._id) } : p))} />
                        {b.name}
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {editingSelf ? tr("Huwezi kubadilisha idara za akaunti yako mwenyewe.")
                    : f.allDepartments ? tr("Anaweza kufanya kazi kwenye kila idara na kubadilisha idara kwa kitufe cha idara juu ya skrini. Chagua hapa chini menyu (Sales, Bills n.k.) anazoruhusiwa kuona.")
                    : f.branchIds.length > 1 ? tr("Anabadilisha kati ya idara hizi kwa kitufe cha idara juu ya skrini (mfano mhudumu anayeuza Bar na Jikoni). Kila wakati anaona na kuuza kwenye idara moja aliyoichagua.")
                    : f.branchIds.length === 1 ? tr("Amefungwa kwenye idara hii moja.")
                    : needsBranch ? tr("Tiki angalau idara moja, au washa 'Idara zote'.")
                    : tr("Hakuna idara iliyotikiwa: meneja/admin tu ndio wanaoweza kuacha hivi.")}
                </p>
              </div>
            )}
            {f.role !== "super_admin" && !editingSelf && (
              <div className="space-y-2 rounded-xl border p-3 md:col-span-2">
                <p className="text-sm font-medium">{tr("Menyu (sidebar) anazoweza kuona")}</p>
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={f.menuAll} onChange={(e) => setF((p) => (p ? { ...p, menuAll: e.target.checked } : p))} />{tr("Zote ambazo biashara ina")}</label>
                {!f.menuAll && <ModulePicker value={f.menu} onChange={(menu) => setF((p) => (p ? { ...p, menu } : p))} available={tenantModules} />}
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={f.ownDataOnly} onChange={(e) => setF((p) => (p ? { ...p, ownDataOnly: e.target.checked } : p))} />{tr("Aone mauzo na bili zake tu (dashboard yake binafsi)")}</label>
                <div className="space-y-1 border-t pt-2">
                  <p className="text-sm font-medium">{tr("Ruhusa maalum kwa mtumiaji huyu (juu ya role yake)")}</p>
                  {USER_GRANTABLE_PERMISSIONS.map((g) => (
                    <label key={g.key} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" disabled={!meSuperAdmin && SUPER_ADMIN_ONLY_PERMISSIONS.includes(g.key)} checked={f.extra.includes(g.key)} onChange={(e) => setF((p) => (p ? { ...p, extra: e.target.checked ? [...p.extra, g.key] : p.extra.filter((x) => x !== g.key) } : p))} />{tr(g.label)}</label>
                  ))}
                  <p className="text-xs text-muted-foreground">{tr("Ruhusa hii pia inaweza kutolewa kwa role nzima kupitia Role Management (Sales → Delete / cancel orders).")}</p>
                </div>
                <p className="text-xs text-muted-foreground">{tr("Mfano mhudumu: ruhusu Sales na Bills tu, na weka 'aone mauzo na bili zake tu'. Huduma ambazo biashara haijalipia hazionekani hapa.")}</p>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Button disabled={busy} onClick={() => void run(async () => {
              if (!f.name.trim() || (!editing && !f.username)) throw new Error(tr("Jina na username vinahitajika."));
              if (needsBranch) throw new Error(tr("Chagua idara za mtumiaji huyu (tiki moja au zaidi) au washa 'Idara zote'."));
              const tenantId = (f.tenantId || undefined) as Id<"tenants"> | undefined;
              // Department access: ticked departments (1 = tied to it, 2+ = switches between them) or all departments.
              const dept = editingSelf || branches.length === 0 ? {} : { branchIds: (f.allDepartments ? [] : f.branchIds) as Id<"branches">[], allDepartments: f.allDepartments };
              // New users: send ownDataOnly only when ticked, so a normal user can always be created even if the backend is a version behind.
              const access = f.role === "super_admin" ? {} : editing ? { ownDataOnly: f.ownDataOnly, extraPermissions: f.extra } : { ...(f.ownDataOnly ? { ownDataOnly: true } : {}), ...(f.extra.length ? { extraPermissions: f.extra } : {}) };
              const menu = f.menuAll ? {} : { menuAccess: f.menu };
              if (editing) {
                const original = (users ?? []).find((u) => u._id === f.id)?.username;
                // Username is changed first and atomically (login key + profile); if it fails nothing else is saved.
                if (!editingSelf && original && f.username && f.username !== original) await rename({ userId: f.id!, newUsername: f.username });
              }
              if (editing) await update({ userId: f.id!, name: f.name, role: f.role, tenantId, ...dept, ...(editingSelf ? {} : { ...access, ...(f.menuAll ? { clearMenuAccess: true } : menu) }) });
              else await create({ name: f.name, username: f.username, password: f.password, role: f.role, tenantId, ...dept, ...access, ...menu });
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
      <div><Button onClick={() => setF({ ...empty, tenantId: me?.tenantId ?? "", branchIds: myLimit && myLimit.length === 1 ? myLimit : [] })}>{tr("＋ Add User")}</Button></div>
      <section className="overflow-x-auto rounded-xl border">
        {!users ? <div className="p-4"><Loading /></div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr>{[tr("Jina"), tr("Username"), tr("Role"), tr("Ofisi"), tr("Branch"), tr("Hali"), tr("Vitendo")].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className="border-t">
                  <td className="p-3 font-medium">{u.name ?? "—"}</td><td className="p-3">{u.username ?? "—"}</td>
                  <td className="p-3">{roles?.find((r) => r.name === u.role)?.displayName ?? u.role}</td>
                  <td className="p-3">{tenantName(u.tenantId)}</td>
                  <td className="p-3">{!u.branchId && !u.allDepartments && !u.branchIds?.length && departmentRoles.includes(u.role) && (offices?.branches ?? []).some((b) => b.tenantId === u.tenantId && b.isActive)
                    ? <span className="font-medium text-rose-600" title={tr("Anaona data ya idara zote. Mhariri umchagulie idara, au washa 'Idara zote' kama ni makusudi.")}>{tr("Zote")} ⚠ {tr("(chagua idara)")}</span>
                    : u.allDepartments ? tr("Idara zote")
                    : u.branchIds?.length ? u.branchIds.map((id) => branchName(id)).join(", ")
                    : branchName(u.branchId)}</td>
                  <td className="p-3">{u.isActive ? tr("Active") : tr("Disabled")}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setF({ id: u._id, name: u.name ?? "", username: u.username ?? "", password: "", role: u.role, tenantId: u.tenantId ?? "", branchIds: u.branchIds?.length ? u.branchIds.map(String) : u.branchId && !u.branchPicked ? [String(u.branchId)] : [], allDepartments: u.allDepartments || (!u.branchId && !u.branchIds?.length && !departmentRoles.includes(u.role)), menuAll: u.menuAccess === null, menu: u.menuAccess ?? ALL_MODULE_KEYS, ownDataOnly: u.ownDataOnly, extra: u.extraPermissions })}>{tr("Modify")}</Button>
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
