import { useMaintenanceSettings, useRun } from "./helpers.ts";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PERMISSION_BUNDLES, PERMISSION_GROUPS, togglePermission } from "@/convex/permissions";
import { Button } from "@/components/ui/button";
import { Card, Loading, PageShell, TextField } from "./_shared";
import { tr } from "@/lib/i18n.ts";

type Draft = { name: string; displayName: string; permissions: string[]; isSystem: boolean; isNew: boolean };

export default function RolesPage() {
  const roles = useQuery(api.maintenance.listRoles, {});
  const settings = useMaintenanceSettings();
  const save = useMutation(api.maintenance.saveRole);
  const del = useMutation(api.maintenance.deleteRole);
  const { busy, run } = useRun();
  const [d, setD] = useState<Draft | null>(null);
  const can = settings?.canEdit["maintenance.roles"] ?? false;
  const toggle = (key: string) => setD((p) => (p ? { ...p, permissions: togglePermission(p.permissions, key) } : p));

  if (d) {
    return (
      <PageShell title={d.isNew ? tr("Role mpya") : tr("Role: {0}", [d.displayName])} subtitle={tr("Chagua ruhusa (permissions) za role hii")}>
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label={tr("Jina la ndani")} value={d.name} onChange={(v) => setD({ ...d, name: v.toLowerCase().replace(/\s+/g, "_") })} disabled={!d.isNew} hint={tr("herufi ndogo, namba, underscore")} />
            <TextField label={tr("Jina la kuonyesha")} value={d.displayName} onChange={(v) => setD({ ...d, displayName: v })} />
          </div>
        </Card>
        {PERMISSION_GROUPS.map((g) => (
          <Card key={g.group} title={g.group}>
            <div className="grid gap-2 md:grid-cols-2">
              {g.items.map((i) => (
                <label key={i.key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={d.permissions.includes(i.key)} onChange={() => toggle(i.key)} />
                  <span>{i.label}<span className="block font-mono text-xs text-muted-foreground">{i.key}</span>{PERMISSION_BUNDLES[i.key] && <span className="block text-xs text-muted-foreground">{tr("Inajumuisha ripoti zake zote (ticked pamoja)")}</span>}</span>
                </label>
              ))}
            </div>
          </Card>
        ))}
        <div className="flex gap-3">
          <Button disabled={busy} onClick={() => void run(async () => { await save({ name: d.name, displayName: d.displayName, permissions: d.permissions }); setD(null); })}>{tr("Hifadhi role")}</Button>
          <Button variant="outline" onClick={() => setD(null)}>{tr("Ghairi")}</Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={tr("Role Management")} subtitle={tr("Bainisha role na ruhusa zake. Super Admin ana ruhusa zote kila wakati.")}>
      {!can && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{tr("Super Admin pekee ndiye anaweza kubadilisha role.")}</p>}
      {can && <div><Button onClick={() => setD({ name: "", displayName: "", permissions: [], isSystem: false, isNew: true })}>{tr("＋ Role mpya")}</Button></div>}
      <section className="overflow-x-auto rounded-xl border">
        {!roles ? <div className="p-4"><Loading /></div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">{tr("Role")}</th><th className="p-3">{tr("Aina")}</th><th className="p-3">{tr("Permissions")}</th><th className="p-3">{tr("Vitendo")}</th></tr></thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.name} className="border-t">
                  <td className="p-3"><div className="font-medium">{r.displayName}</div><div className="font-mono text-xs text-muted-foreground">{r.name}</div></td>
                  <td className="p-3">{r.isSystem ? (r.customized ? tr("System (imebadilishwa)") : tr("System")) : tr("Custom")}</td>
                  <td className="p-3">{r.permissions.length}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setD({ ...r, permissions: [...r.permissions], isNew: false })}>{can ? tr("Hariri") : tr("Angalia")}</Button>
                      {can && (r.customized) && <Button size="sm" variant="outline" onClick={() => { if (confirm(r.isSystem ? tr("Rudisha kwenye mipangilio ya awali?") : tr("Futa role hii?"))) void run(() => del({ name: r.name }), r.isSystem ? tr("Imerudishwa.") : tr("Imefutwa.")); }}>{r.isSystem ? tr("Reset") : tr("Futa")}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </PageShell>
  );
}
