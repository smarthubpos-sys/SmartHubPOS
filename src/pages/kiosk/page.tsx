import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Fingerprint, KeyRound, LogIn, LogOut, XCircle } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { tzOffset } from "@/lib/format.ts";
import { useMoney } from "@/hooks/use-money.ts";
import { errorText, getLocale, tr } from "@/lib/i18n.ts";
import { biometricError, biometricSupported, getAssertion } from "@/lib/webauthn.ts";

type Result = { ok: boolean; text: string } | null;
type Session = { challenge: string; credentialIds: string[]; employeeName: string };

/**
 * Shared work device. Step 1: the employee types his Staff PIN or employee number. Step 2: he confirms with the fingerprint of the
 * device. The server ties the fingerprint to the person named in step 1, so a colleague's name cannot be picked from a list.
 */
export default function KioskPage() {
  const identify = useMutation(api.kiosk.identify);
  const authenticate = useMutation(api.biometric.authenticate);
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const { money } = useMoney();
  const [kind, setKind] = useState<"in" | "out">("in");
  const [identifier, setIdentifier] = useState("");
  const [show, setShow] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [now, setNow] = useState(new Date());
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);

  const reset = () => { setSession(null); setIdentifier(""); setShow(false); setResult(null); setBusy(false); };

  // After a finished sign-in the screen clears itself for the next person (and the typed number never stays on screen).
  useEffect(() => {
    if (!result?.ok) return;
    const t = window.setTimeout(reset, 6000);
    return () => window.clearTimeout(t);
  }, [result]);
  // A person who walked away in the middle of step 2 does not leave his name on the screen.
  useEffect(() => {
    if (!session || busy || result?.ok) return;
    const t = window.setTimeout(reset, 100_000);
    return () => window.clearTimeout(t);
  }, [session, busy, result]);
  useEffect(() => {
    if (!confirmExit) return;
    const t = window.setTimeout(() => setConfirmExit(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmExit]);

  async function next(e: FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || busy) return;
    setResult(null);
    setBusy(true);
    try {
      const r = await identify({ identifier });
      if (!r.ok) { setResult({ ok: false, text: tr(r.message) }); setIdentifier(""); return; }
      setSession({ challenge: r.challenge, credentialIds: r.credentialIds, employeeName: r.employeeName });
    } catch (err) { setResult({ ok: false, text: errorText(err, "Imeshindikana. Jaribu tena.") }); }
    finally { setBusy(false); }
  }

  async function confirmFingerprint() {
    if (!session || busy) return;
    setResult(null);
    if (!biometricSupported()) { setResult({ ok: false, text: tr("Kifaa au kivinjari hiki hakitumii alama ya kidole/uso. Tumia HTTPS na kivinjari cha kisasa.") }); return; }
    setBusy(true);
    try {
      let assertion;
      try { assertion = await getAssertion(session.challenge, session.credentialIds); } catch (err) { throw biometricError(err); }
      const r = await authenticate({ challenge: session.challenge, ...assertion, kind, tzOffset: tzOffset() });
      if (kind === "in") {
        setResult((r.lateMinutes ?? 0) > 0
          ? { ok: false, text: tr("{0}: umeingia saa {1}, umechelewa dakika {2} (ulitakiwa {3}). Utakatwa {4}.", [r.employeeName, r.time, r.lateMinutes ?? 0, r.scheduledStart ?? "", money(r.lateDeduction ?? 0)]) }
          : { ok: true, text: tr("{0}: umeingia kazini saa {1}.", [r.employeeName, r.time]) });
        // A late arrival is told the amount, then the screen also clears for the next person.
        if ((r.lateMinutes ?? 0) > 0) window.setTimeout(reset, 9000);
      } else {
        setResult({ ok: true, text: tr("{0}: umetoka kazini saa {1} (masaa {2}).", [r.employeeName, r.time, r.hoursWorked ?? 0]) });
      }
      setSession(null);
      setIdentifier("");
    } catch (err) { setResult({ ok: false, text: errorText(err, "Uthibitisho wa alama umeshindikana.") }); }
    finally { setBusy(false); }
  }

  const exit = () => {
    if (!confirmExit) { setConfirmExit(true); return; }
    void signOut().finally(() => navigate("/", { replace: true }));
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 p-4">
      <div className="text-center">
        <p className="text-5xl font-bold tabular-nums tracking-tight">{now.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
        <p className="mt-1 text-sm text-muted-foreground">{now.toLocaleDateString(getLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>

      <div className="mx-auto flex w-fit gap-1 rounded-xl bg-muted p-1" role="tablist">
        {(["in", "out"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} disabled={busy || !!session} onClick={() => setKind(k)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-medium disabled:cursor-not-allowed ${kind === k ? "bg-card shadow" : "text-muted-foreground"}`}>
            {k === "in" ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}{k === "in" ? tr("Ingia kazini") : tr("Toka kazini")}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        {!session ? (
          <form onSubmit={(e) => void next(e)} className="space-y-3" autoComplete="off">
            <label htmlFor="kiosk-id" className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" />{tr("Weka PIN au namba yako ya mfanyakazi")}</label>
            <div className="relative">
              <Input id="kiosk-id" name="sh-kiosk-id" autoFocus required maxLength={32} value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                type={show ? "text" : "password"} autoComplete="new-password" autoCapitalize="characters" autoCorrect="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true"
                className="h-12 pr-11 text-center text-xl tracking-widest" aria-label={tr("PIN au namba ya mfanyakazi")} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-1.5 flex w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label={show ? tr("Ficha nenosiri") : tr("Onyesha nenosiri")}>
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <Button type="submit" disabled={busy || !identifier.trim()} className="h-12 w-full text-base">{busy ? tr("Inatafuta…") : tr("Endelea")}</Button>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-lg font-semibold">{tr("Habari {0}", [session.employeeName])}</p>
            <p className="text-sm text-muted-foreground">{tr("Thibitisha kwa alama ya kidole chako kwenye kifaa hiki.")}</p>
            <button type="button" disabled={busy} onClick={() => void confirmFingerprint()}
              className="group mx-auto flex h-32 w-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-xl shadow-primary/40 transition active:scale-95 disabled:opacity-60">
              <Fingerprint className="h-10 w-10" />
              <span className="text-sm font-semibold">{busy ? tr("Inathibitisha…") : kind === "in" ? tr("Ingia kazini") : tr("Toka kazini")}</span>
            </button>
            <Button type="button" variant="ghost" disabled={busy} onClick={reset}><ArrowLeft className="mr-2 h-4 w-4" />{tr("Ghairi")}</Button>
          </div>
        )}
      </div>

      {result && (
        <div role="status" className={`flex items-center justify-center gap-2 rounded-xl p-3 text-sm font-medium ${result.ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/15 text-rose-700 dark:text-rose-300"}`}>
          {result.ok ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}<span>{result.text}</span>
        </div>
      )}

      <button type="button" onClick={exit} className="mx-auto cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline">
        {confirmExit ? tr("Bonyeza tena kuthibitisha") : tr("Toka kwenye mfumo")}
      </button>
    </div>
  );
}
