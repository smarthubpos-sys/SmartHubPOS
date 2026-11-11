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
import { errorText, tr } from "@/lib/i18n.ts";

type Form = { id?: Id<"users">; name: string; username: string; password: string; role: string; tenantId: string; branchIds: string[]; allDepartments: boolean; menuAll: boolean; menu: string[]; ownDataOnly: boolean; pin: string; pinLoginEnabled: boolean; hasPin: boolean; staffCode: string; extra: string[] };
/** Switches given to ONE user on top of his role (the server checks that the giver has them himself; Super Admin always has all). */
const USER_SWITCHES: { key: string; label: string; hint: string }[] = [
  { key: "sales.edit", label: "Edit invoice", hint: "Anaweza kurekebisha invoice zilizohifadhiwa (bidhaa, idadi, bei)." },
  { key: "sales.void", label: "Cancel / Delete invoice", hint: "Anaweza kufuta au kubatilisha invoice; stock inarudi na malipo yanarudishwa." },
  { key: "sales.print", label: "Print invoice", hint: "Anaweza kuchapisha invoice na risiti." },
];
const empty: Form = { name: "", username: "", password: "", role: "cashier", tenantId: "", branchIds: [], allDepartments: false, menuAll: true, menu: ALL_MODULE_KEYS, ownDataOnly: false, pin: "", pinLoginEnabled: false, hasPin: false, staffCode: "", extra: [] };

export default function UsersPage() {
  const { user: me } = useAuth();
  const users = useQuery(api.maintenance.listUsers, {});
  // Needs only user-management permission (listRoles also needs Role Management, so a staff member given only "add users" could not open this page).
  const roles = useQuery(api.maintenance.listAssignableRoles, {});
  const offices = useQuery(api.maintenance.listOffices, {});
  const quota = useQuery(api.maintenance.userQuota, {});
  const seatsFull = !!quota && quota.max !== null && quota.used >= quota.max; // the Super Admin sets the limit; a business administrator cannot go past it
  const create = useAction(api.maintenance.createUser);
  const reset = useAction(api.maintenance.resetUserPassword);
  const setStaffPin = useAction(api.maintenance.setStaffPin);
  const update = useMutation(api.maintenance.updateUser);
  const setStaffCode = useMutation(api.maintenance.setStaffCode);
  const rename = useMutation(api.maintenance.renameUsername);
  const { busy, run } = useRun();
  const [f, setF] = useState<Form | null>(null);
  const set = (k: keyof Form, v: string) => setF((p) => (p ? { ...p, [k]: v } : p));
  const isSuper = ["super_admin", "superadmin"].includes(String(me?.role ?? "").toLowerCase().replace(/[\s-]+/g, "_"));
  // A user administrator can only give roles that carry no more than he has himself (the one the edited user already has stays visible).
  // Every role of the business is listed; the ones above his own rights are marked and the server still refuses them.
  const roleOptions = (roles ?? []).filter((r) => isSuper || r.name !== "super_admin").map((r) => [r.name, isSuper || r.assignable || r.name === f?.role ? r.displayName : `${r.displayName} ${tr("(juu ya ruhusa zako)")}`] as [string, string]);
  // Super Admin is never handed out; it only shows when the account being edited already is one.
  if (isSuper && String(f?.role ?? "").toLowerCase().replace(/[\s-]+/g, "_").replace("superadmin", "super_admin") === "super_admin") roleOptions.unshift(["super_admin", tr("Super Admin")]);
  const tenantName = (id?: string) => offices?.tenants.find((t) => t._id === id)?.name ?? "—";
  const branchName = (id?: string) => offices?.branches.find((b) => b._id === id)?.name ?? tr("Zote");
  const branches = (offices?.branches ?? []).filter((b) => b.tenantId === (f?.tenantId || me?.tenantId));
  const tenantModules = offices?.tenants.find((t) => t._id === (f?.tenantId || me?.tenantId))?.modules ?? undefined; // what this business has paid for
  const editingSelf = !!f?.id && String(f.id) === String(me?._id);
  // A user tied to ONE department can only create/manage users of that same department.
  // A user tied to one department, or given a few, can only give those same departments to others. null = no limit.
  const myLimit: string[] | null = isSuper ? null : me?.branchIds && me.branchIds.length > 1 ? me.branchIds.map(String) : me?.branchId && !me?.branchPicked ? [String(me.branchId)] : null;
  const departmentRoles = ["cashier", "accountant", "viewer"];
  const pinOnlyRole = !!f && ["waiter", "waitress"].includes(f.role.trim().toLowerCase()); // waiters / waitresses are registered with a PIN, not a password // these must always belong to one department when the business has departments
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
            {!editing && !pinOnlyRole && <TextField label={tr("Password ya kuanzia")} type="password" value={f.password} onChange={(v) => set("password", v)} />}
            <SelectField label={tr("Role")} value={f.role} onChange={(v) => set("role", v)} options={roleOptions} />
            <TextField label={tr("Staff code (kwa cashier kutafuta mauzo)")} value={f.staffCode} onChange={(v) => set("staffCode", v.toUpperCase())} hint={tr("Herufi/namba 2-20, ya kipekee kwa biashara. Cashier huiandika kuona mauzo na kupokea malipo ya mhudumu huyu.")} />
            <div className="space-y-2 rounded-xl border p-3 md:col-span-2">
                {pinOnlyRole ? (
                  <p className="text-sm font-medium">{tr("Mhudumu huingia kwa PIN tu (hana password).")}</p>
                ) : (
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={f.pinLoginEnabled} onChange={(e) => setF((p) => (p ? { ...p, pinLoginEnabled: e.target.checked } : p))} />
                    {tr("Ruhusu kuingia kwa Staff PIN")}
                  </label>
                )}
                <TextField label={pinOnlyRole && !f.hasPin ? tr("PIN ya tarakimu 4 hadi 6") : tr("PIN mpya ya tarakimu 4 hadi 6 (hiari ikiwa tayari ipo)")} type="password" value={f.pin} onChange={(v) => setF((p) => (p ? { ...p, pin: v.replace(/\D/g, "").slice(0, 6) } : p))} hint={f.hasPin ? tr("Acha wazi ili kubakiza PIN iliyopo. Weka PIN mpya ili kuibadilisha.") : tr("PIN haitahifadhiwa kama maandishi ya kawaida.")} />
                <p className="text-xs text-muted-foreground">{tr("PIN ni ya kipekee kwenye mfumo mzima: mfumo unamtambua mtu kwa PIN yake peke yake, kwa hiyo hairuhusiwi PIN ile ile kwa watu wawili.")}</p>
              </div>
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
            {f.role === "super_admin" && <p className="rounded-xl border p-3 text-sm md:col-span-2">{tr("Super Admin ana ruhusa zote (Edit, Cancel/Delete, Print) kila wakati; hazizimwi.")}</p>}
            {f.role !== "super_admin" && !editingSelf && (
              <div className="space-y-2 rounded-xl border p-3 md:col-span-2">
                <p className="text-sm font-medium">{tr("Ruhusa za invoice (kwa mtumiaji huyu pekee)")}</p>
                {USER_SWITCHES.map((sw) => (
                  <label key={sw.key} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1 h-4 w-4 cursor-pointer accent-primary" checked={f.extra.includes(sw.key)}
                      onChange={(e) => setF((p) => (p ? { ...p, extra: e.target.checked ? [...new Set([...p.extra, sw.key])] : p.extra.filter((k) => k !== sw.key) } : p))} />
                    <span>{tr(sw.label)}<span className="block text-xs text-muted-foreground">{tr(sw.hint)}</span></span>
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">{tr("Unaweza kutoa tu ruhusa ulizonazo wewe mwenyewe. Zinaongezwa juu ya ruhusa za role yake.")}</p>
              </div>
            )}
            {f.role !== "super_admin" && !editingSelf && (
              <div className="space-y-2 rounded-xl border p-3 md:col-span-2">
                <p className="text-sm font-medium">{tr("Menyu (sidebar) anazoweza kuona")}</p>
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={f.menuAll} onChange={(e) => setF((p) => (p ? { ...p, menuAll: e.target.checked } : p))} />{tr("Zote ambazo biashara ina")}</label>
                {!f.menuAll && <ModulePicker value={f.menu} onChange={(menu) => setF((p) => (p ? { ...p, menu } : p))} available={tenantModules} />}
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={f.ownDataOnly} onChange={(e) => setF((p) => (p ? { ...p, ownDataOnly: e.target.checked } : p))} />{tr("Aone mauzo na bili zake tu (dashboard yake binafsi)")}</label>
                <p className="border-t pt-2 text-xs text-muted-foreground">{tr("Ruhusa za kawaida za kazi zinadhibitiwa kupitia Role Management; hapa unaweza kuongeza ruhusa za invoice kwa mtu mmoja, na kuchagua sidebar.")}</p>
                <p className="text-xs text-muted-foreground">{tr("Mfano mhudumu: ruhusu Sales na Bills tu, na weka 'aone mauzo na bili zake tu'. Huduma ambazo biashara haijalipia hazionekani hapa.")}</p>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Button disabled={busy} onClick={() => void run(async () => {
              if (!f.name.trim() || (!editing && !f.username)) throw new Error(tr("Jina na username vinahitajika."));
              if (needsBranch) throw new Error(tr("Chagua idara za mtumiaji huyu (tiki moja au zaidi) au washa 'Idara zote'."));
              if (f.pin && !/^\d{4,6}$/.test(f.pin)) throw new Error(tr("PIN lazima iwe tarakimu 4 hadi 6."));
              if (pinOnlyRole && !f.pin && !f.hasPin) throw new Error(tr("Mhudumu husajiliwa kwa PIN: weka PIN ya tarakimu 4 hadi 6."));
              if (f.pinLoginEnabled && !f.pin && !f.hasPin) throw new Error(tr("Weka PIN ya tarakimu 4 hadi 6 kabla ya kuruhusu Staff PIN."));
              const pinLogin = pinOnlyRole ? true : f.pinLoginEnabled;
              const tenantId = (f.tenantId || undefined) as Id<"tenants"> | undefined;
              // Department access: ticked departments (1 = tied to it, 2+ = switches between them) or all departments.
              const dept = editingSelf || branches.length === 0 ? {} : { branchIds: (f.allDepartments ? [] : f.branchIds) as Id<"branches">[], allDepartments: f.allDepartments };
              // New users: send ownDataOnly only when ticked, so a normal user can always be created even if the backend is a version behind.
              const access = f.role === "super_admin" ? {} : editing ? { ownDataOnly: f.ownDataOnly } : { ...(f.ownDataOnly ? { ownDataOnly: true } : {}) };
              const menu = f.menuAll ? {} : { menuAccess: f.menu };
              if (editing) {
                const original = (users ?? []).find((u) => u._id === f.id)?.username;
                // Username is changed first and atomically (login key + profile); if it fails nothing else is saved.
                if (!editingSelf && original && f.username && f.username !== original) await rename({ userId: f.id!, newUsername: f.username });
              }
              let savedUserId: Id<"users">;
              if (editing) {
                await update({ userId: f.id!, name: f.name, role: f.role, tenantId, ...dept, ...(editingSelf ? {} : { ...access, extraPermissions: f.extra, ...(f.menuAll ? { clearMenuAccess: true } : menu) }) });
                savedUserId = f.id!;
              } else {
                const createdId = await create({ name: f.name, username: f.username, ...(pinOnlyRole ? {} : { password: f.password }), role: f.role, tenantId, ...dept, ...access, ...menu, ...(f.extra.length ? { extraPermissions: f.extra } : {}), ...(f.pin ? { pin: f.pin, pinLoginEnabled: pinLogin } : {}) });
                savedUserId = createdId as Id<"users">;
              }
              if (editing) { // a new user's PIN was already saved (and checked for duplicates) together with the account
                try { await setStaffPin({ userId: savedUserId, ...(f.pin ? { pin: f.pin } : {}), enabled: pinLogin }); }
                catch (e) { throw new Error(errorText(e), { cause: e }); }
              }
              if (f.staffCode.trim() || editing) {
                try { await setStaffCode({ userId: savedUserId, staffCode: f.staffCode }); }
                catch (e) { throw new Error(`${tr("Staff code haikuhifadhiwa: ")}${errorText(e)}`.trim(), { cause: e }); }
              }
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
      <div className="flex flex-wrap items-center gap-3"><Button disabled={seatsFull && !isSuper} onClick={() => setF({ ...empty, tenantId: me?.tenantId ?? "", branchIds: myLimit && myLimit.length === 1 ? myLimit : [] })}>{tr("＋ Add User")}</Button>{quota && quota.max !== null && <span className="text-sm text-muted-foreground">{tr("Watumiaji: {0} / {1}", [quota.used, quota.max])}{seatsFull ? ` · ${tr("Kikomo kimefikiwa. Wasiliana na Super Admin akuongezee.")}` : ""}</span>}</div>
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
                      <Button size="sm" variant="outline" onClick={() => setF({ id: u._id, name: u.name ?? "", username: u.username ?? "", password: "", role: u.role, tenantId: u.tenantId ?? "", branchIds: u.branchIds?.length ? u.branchIds.map(String) : u.branchId && !u.branchPicked ? [String(u.branchId)] : [], allDepartments: u.allDepartments || (!u.branchId && !u.branchIds?.length && !departmentRoles.includes(u.role)), menuAll: u.menuAccess === null, menu: u.menuAccess ?? ALL_MODULE_KEYS, ownDataOnly: u.ownDataOnly, pin: "", pinLoginEnabled: u.pinLoginEnabled, hasPin: u.hasPin, staffCode: u.staffCode ?? "", extra: u.extraPermissions ?? [] })}>{tr("Modify")}</Button>
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
