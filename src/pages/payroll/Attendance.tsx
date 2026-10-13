import { useEffect, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Fingerprint, LogIn, LogOut, ScanFace, XCircle } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Empty, FormField, PageHeader, Panel, Pill, SelectBox, Table, useSubmit } from "@/components/page-kit.tsx";
import { localDate, tzOffset } from "@/lib/format.ts";
import { errorText, getLocale, tr } from "@/lib/i18n.ts";
import { biometricError, biometricSupported, getAssertion, platformBiometricAvailable } from "@/lib/webauthn.ts";

type Result = { ok: boolean; text: string } | null;

/** Staff sign in / sign out with fingerprint, Face ID or Windows Hello (WebAuthn), with a manager-only manual fallback. */
export default function AttendancePage({ kind: initial }: { kind: "in" | "out" }) {
  const navigate = useNavigate();
  const convex = useConvex();
  const [kind, setKind] = useState<"in" | "out">(initial);
  const [employeeId, setEmployeeId] = useState("");
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [platform, setPlatform] = useState<boolean | null>(null);
  const today = useQuery(api.attendance.today, { date: localDate() });
  const authOptions = useMutation(api.biometric.authOptions);
  const authenticate = useMutation(api.biometric.authenticate);
  const recordManual = useMutation(api.attendance.recordManual);
  const { run } = useSubmit();

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { void platformBiometricAvailable().then(setPlatform); }, []);
  useEffect(() => setKind(initial), [initial]);

  const verb = (k: "in" | "out") => (k === "in" ? tr("Ingia kazini") : tr("Toka kazini"));

  async function biometric() {
    setResult(null);
    if (!biometricSupported()) { setResult({ ok: false, text: tr("Kifaa au kivinjari hiki hakitumii alama ya kidole/uso. Tumia HTTPS na kivinjari cha kisasa.") }); return; }
    setBusy(true);
    try {
      const { challenge } = await authOptions({});
      const ids = employeeId ? await convex.query(api.biometric.credentialIds, { employeeId: employeeId as never }) : [];
      let assertion;
      try { assertion = await getAssertion(challenge, ids); } catch (e) { throw biometricError(e); }
      const r = await authenticate({ challenge, ...assertion, kind, tzOffset: tzOffset() });
      setResult({ ok: true, text: kind === "in" ? tr("{0}: umeingia kazini saa {1}.", [r.employeeName, r.time]) : tr("{0}: umetoka kazini saa {1} (masaa {2}).", [r.employeeName, r.time, (r as { hoursWorked?: number }).hoursWorked ?? 0]) });
    } catch (e) { setResult({ ok: false, text: errorText(e, "Uthibitisho wa alama umeshindikana.") }); }
    finally { setBusy(false); }
  }

  const present = (today ?? []).filter((r) => r.signInTime).length;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Button variant="outline" onClick={() => navigate("/payroll")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Payroll")}</Button>
      <PageHeader icon={Fingerprint} title={kind === "in" ? tr("Staff Sign In") : tr("Staff Sign Out")} subtitle={tr("Thibitisha kwa alama ya kidole, uso (Face ID) au Windows Hello.")} />

      <Panel className="text-center">
        <p className="text-4xl font-bold tabular-nums tracking-tight md:text-5xl">{now.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
        <p className="mt-1 text-sm text-muted-foreground">{now.toLocaleDateString(getLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        <div className="mx-auto mt-4 flex w-fit gap-1 rounded-xl bg-muted p-1">
          {(["in", "out"] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium ${kind === k ? "bg-card shadow" : "text-muted-foreground"}`}>{k === "in" ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}{verb(k)}</button>)}
        </div>
        <div className="mt-5">
          <button disabled={busy} onClick={() => void biometric()} className="group mx-auto flex h-36 w-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-xl shadow-primary/40 transition hover:scale-105 disabled:opacity-60" aria-label={verb(kind)}>
            <span className="flex gap-1"><Fingerprint className="h-9 w-9" /><ScanFace className="h-9 w-9" /></span>
            <span className="text-sm font-semibold">{busy ? tr("Inathibitisha…") : verb(kind)}</span>
          </button>
          {platform === false && <p className="mt-3 text-xs text-amber-600">{tr("Kifaa hiki hakina kisoma kidole/uso kilichowashwa, au hutumii HTTPS.")}</p>}
        </div>
        {result && <div className={`mx-auto mt-5 flex max-w-md items-center justify-center gap-2 rounded-xl p-3 text-sm font-medium ${result.ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/15 text-rose-700 dark:text-rose-300"}`}>{result.ok ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}<span>{result.text}</span></div>}
      </Panel>

      <Panel title={tr("Chaguo la ziada")}>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label={tr("Mfanyakazi (hiari)")} hint={tr("Acha wazi ili mfumo umtambue kwa alama yake.")}>
            <SelectBox value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">{tr("-- Select --")}</option>{(today ?? []).map((e) => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}</SelectBox>
          </FormField>
          <div className="flex items-end md:col-span-2">
            <Button variant="outline" disabled={!employeeId} onClick={() => void run(async () => { const r = await recordManual({ employeeId: employeeId as never, kind, tzOffset: tzOffset() }); setResult({ ok: true, text: tr("{0}: imerekodiwa saa {1} (bila alama).", [r.employeeName, r.time]) }); }, tr("Imerekodiwa."))}>{tr("Rekodi bila alama (meneja)")}</Button>
          </div>
        </div>
      </Panel>

      <Panel title={tr("Mahudhurio ya leo")} actions={<Pill tone="green">{tr("Waliopo: {0}", [present])}</Pill>}>
        {!today || today.length === 0 ? <Empty>{tr("Bado hakuna mfanyakazi.")}</Empty> : (
          <Table head={[tr("Mfanyakazi"), tr("Muda wa kuingia"), tr("Muda wa kutoka"), tr("Masaa"), tr("Hali")]}>
            {today.map((r) => <tr key={r.employeeId}><td className="font-medium">{r.name}</td><td>{r.signInTime ?? "-"}</td><td>{r.signOutTime ?? "-"}</td><td>{r.hoursWorked ?? "-"}</td><td>{r.signInTime ? (r.signOutTime ? <Pill>{tr("Ametoka")}</Pill> : <Pill tone="green">{tr("Yupo kazini")}</Pill>) : <Pill tone="amber">{tr("Hajaingia")}</Pill>}</td></tr>)}
          </Table>
        )}
      </Panel>
    </div>
  );
}
