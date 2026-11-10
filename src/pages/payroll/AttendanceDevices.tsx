import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Copy, Cpu } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useSubmit } from "@/components/use-submit.ts";
import { Empty, Panel, Pill, Table } from "@/components/page-kit.tsx";
import { getLocale, tr } from "@/lib/i18n.ts";

/** The Convex "site" address the bridge program sends touches to (not the app address). The bridge adds /attendance/punches itself. */
function siteUrl() {
  const site = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
  const cloud = import.meta.env.VITE_CONVEX_URL as string | undefined;
  return (site || (cloud ? cloud.replace(".convex.cloud", ".convex.site") : "")).replace(/\/+$/, "");
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success(tr("Imenakiliwa.")); }
  catch { toast.error(tr("Imeshindikana kunakili. Chagua maandishi uyanakili kwa mkono.")); }
}

function Devices() {
  const devices = useQuery(api.attendanceDevices.list, {});
  const create = useMutation(api.attendanceDevices.create);
  const setActive = useMutation(api.attendanceDevices.setActive);
  const newKey = useMutation(api.attendanceDevices.newKey);
  const { busy, run } = useSubmit();
  const [name, setName] = useState("");
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const endpoint = siteUrl();

  return (
    <Panel title={tr("Mashine za alama ya kidole")}>
      <p className="mb-3 text-sm text-muted-foreground">{tr("Mashine ya kidole ikishawekwa, mfanyakazi anagusa tu na mfumo unamtambua. Namba yake kwenye mashine iwe sawa na Employee Code yake.")}</p>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={tr("Jina la mashine (mfano: Mlango Mkuu)")} />
        <Button disabled={busy || name.trim().length < 2} onClick={() => void run(async () => { const r = await create({ name }); setShown({ name: name.trim(), key: r.key }); setName(""); }, tr("Mashine imesajiliwa. Nakili ufunguo sasa."))}><Cpu className="mr-2 h-4 w-4" />{tr("Sajili mashine")}</Button>
      </div>

      {shown && (
        <div className="mt-4 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{shown.name}: {tr("Ufunguo huu unaonekana mara moja tu. Ukiupoteza, tengeneza mpya.")}</p>
          {([[tr("Anwani ya mfumo (SMARTHUB_ENDPOINT)"), endpoint], [tr("Ufunguo wa mashine (SMARTHUB_DEVICE_KEY)"), shown.key]] as const).map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-background/70 p-2 text-xs">{value}</code><Button size="sm" variant="outline" onClick={() => void copy(value)}><Copy className="mr-1 h-3.5 w-3.5" />{tr("Nakili")}</Button></div>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setShown(null)}>{tr("Funga")}</Button>
        </div>
      )}

      <div className="mt-4">
        {!devices || devices.length === 0 ? <Empty>{tr("Bado hakuna mashine.")}</Empty> : (
          <Table head={[tr("Mashine"), tr("Hali"), tr("Mawasiliano ya mwisho"), ""]}>
            {devices.map((d) => (
              <tr key={d._id}>
                <td className="font-medium">{d.name}</td>
                <td>{d.isActive ? <Pill tone="green">{tr("Inafanya kazi")}</Pill> : <Pill tone="amber">{tr("Imezimwa")}</Pill>}</td>
                <td className="whitespace-nowrap">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString(getLocale()) : tr("Bado haijawasiliana")}</td>
                <td className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setActive({ deviceId: d._id, isActive: !d.isActive }), d.isActive ? tr("Mashine imezimwa.") : tr("Mashine imewashwa."))}>{d.isActive ? tr("Zima") : tr("Washa")}</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(tr("Ufunguo wa zamani utaacha kufanya kazi mara moja, na programu ya mashine itahitaji ufunguo mpya. Endelea?"))) void run(async () => { const r = await newKey({ deviceId: d._id }); setShown({ name: d.name, key: r.key }); }, tr("Ufunguo mpya umetengenezwa. Wa zamani umeacha kufanya kazi.")); }}>{tr("Ufunguo mpya")}</Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Panel>
  );
}

/** Shown only to people who may manage payroll (the server enforces it too). */
export default function AttendanceDevices() {
  const permissions = useQuery(api.maintenance.myPermissions, {});
  if (!permissions?.includes("payroll.manage")) return null;
  return <Devices />;
}
