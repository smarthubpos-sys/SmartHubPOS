import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, Loading, NoAccess, PageShell, TextField, Toggle, useMaintenanceSettings, useRun } from "./_shared";
import { tr } from "@/lib/i18n.ts";

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const change = useAction(api.maintenance.changeOwnPassword);
  const { busy, run } = useRun();
  const [cur, setCur] = useState(""); const [n1, setN1] = useState(""); const [n2, setN2] = useState("");
  return (
    <div className="grid gap-3">
      <TextField label={tr("Password ya sasa")} type="password" value={cur} onChange={setCur} />
      <TextField label={tr("Password mpya")} type="password" value={n1} onChange={setN1} />
      <TextField label={tr("Rudia password mpya")} type="password" value={n2} onChange={setN2} />
      <Button disabled={busy} onClick={() => void run(async () => {
        if (n1 !== n2) throw new Error(tr("Password mpya hazifanani."));
        await change({ currentPassword: cur, newPassword: n1 });
        setCur(""); setN1(""); setN2(""); onDone?.();
      }, tr("Password imebadilishwa."))}>{tr("Badilisha password")}</Button>
    </div>
  );
}

export default function SecurityPage() {
  const s = useMaintenanceSettings();
  const save = useMutation(api.maintenance.saveSetting);
  const { busy, run } = useRun();
  const [f, setF] = useState<{ min: string; timeout: string; force: boolean } | null>(null);
  if (!s) return <PageShell title={tr("User Security Settings")}><Loading /></PageShell>;
  const sec: any = s.app.security ?? {};
  const form = f ?? { min: String(sec.minPasswordLength ?? 10), timeout: String(sec.sessionTimeoutMinutes ?? 30), force: sec.requirePasswordChangeForNewUsers ?? true };
  const ok = s.canEdit["maintenance.security"];
  return (
    <PageShell title={tr("User Security Settings")} subtitle={tr("Sera ya password na session")}>
      {!ok && <NoAccess permission="maintenance.security" />}
      <Card title={tr("Sera ya usalama")}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={tr("Urefu wa chini wa password")} type="number" value={form.min} onChange={(v) => setF({ ...form, min: v })} hint={tr("Inatumika kwa watumiaji wapya, reset na kubadilisha password (8–64).")} disabled={!ok} />
          <TextField label={tr("Idle timeout (dakika)")} type="number" value={form.timeout} onChange={(v) => setF({ ...form, timeout: v })} hint={tr("Mtumiaji anatolewa nje bila shughuli. 0 = imezimwa.")} disabled={!ok} />
        </div>
        <Toggle label={tr("Mtumiaji mpya abadilishe password anapoingia kwa mara ya kwanza")} checked={form.force} onChange={(v) => setF({ ...form, force: v })} disabled={!ok} />
        <Button disabled={busy || !ok} onClick={() => void run(() => save({ key: "security", value: { minPasswordLength: Number(form.min), sessionTimeoutMinutes: Number(form.timeout), requirePasswordChangeForNewUsers: form.force } }))}>{tr("Hifadhi sera")}</Button>
      </Card>
      <Card title={tr("Badilisha password yangu")}><ChangePasswordForm /></Card>
    </PageShell>
  );
}
