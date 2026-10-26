import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { tr, errorText } from "@/lib/i18n.ts";
import { PICK_BUSINESS_FLAG } from "@/lib/business-session.ts";


export function SignInButton() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginMode, setLoginMode] = useState<"password" | "pin">("password");
  const [pin, setPin] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [firstSetup, setFirstSetup] = useState(false); // one-time creation of the initial Super Admin (only the SUPER_ADMIN_USERNAME is accepted by the server)
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      if (loginMode === "pin") {
        formData.set("pin", pin); // PIN only: the system recognises the person by the PIN itself
        await signIn("staffPin", formData);
      } else {
        const normalizedUsername = username.trim().toLowerCase();
        formData.set("username", normalizedUsername);
        formData.set("flow", firstSetup ? "signUp" : "signIn");
        formData.set("email", `${normalizedUsername}@login.smarthub.invalid`);
        formData.set("password", password);
        await signIn("password", formData);
      }
      try { window.sessionStorage.setItem(PICK_BUSINESS_FLAG, "1"); } catch { /* ignore */ }
      setUsername("");
      setPassword("");
      setPin("");
      navigate("/dashboard", { replace: true });
    } catch (e) {
      setError(errorText(e, "Imeshindikana kuingia."));
    } finally {
      setBusy(false);
    }
  }

  if (isAuthenticated) {
    return (
      <Button className="w-full" disabled={isLoading || busy} onClick={async () => { await signOut(); navigate("/", { replace: true }); }}>
        
        {tr("Toka kwenye mfumo")}
      </Button>
    );
  }

  if (loginMode === "pin") {
    const MAX_PIN = 6;
    const press = (digit: string) => setPin((p) => (p.length < MAX_PIN ? p + digit : p));
    const keyClass = "h-11 rounded-xl bg-white text-lg font-bold text-slate-900 shadow-sm transition hover:bg-slate-200 active:scale-95 disabled:opacity-60";
    return (
      <form onSubmit={submit} className="mx-auto grid w-full max-w-[17rem] gap-3">
        <div className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white/10 px-3" aria-label={tr("PIN ya wafanyakazi")} role="img">
          {pin.length === 0
            ? <span className="text-sm text-blue-100/80">{tr("Weka PIN yako")}</span>
            : Array.from({ length: pin.length }).map((_, i) => <span key={i} className="h-3 w-3 rounded-full bg-white" />)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((digit) => (
            <button key={digit} type="button" className={keyClass} disabled={busy || pin.length >= MAX_PIN} onClick={() => press(digit)}>{digit}</button>
          ))}
          <button type="button" className="h-11 rounded-xl bg-amber-300 text-sm font-bold text-slate-900 transition hover:bg-amber-200 active:scale-95 disabled:opacity-60" disabled={busy || !pin} onClick={() => setPin("")}>{tr("Futa")}</button>
          <button type="button" className={keyClass} disabled={busy || pin.length >= MAX_PIN} onClick={() => press("0")}>0</button>
          <button type="button" className="h-11 rounded-xl bg-sky-300 text-lg font-bold text-slate-900 transition hover:bg-sky-200 active:scale-95 disabled:opacity-60" disabled={busy || !pin} onClick={() => setPin((p) => p.slice(0, -1))} aria-label={tr("Futa tarakimu ya mwisho")}>⌫</button>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-900/40 p-2 text-center text-sm text-red-100">{error}</p>}
        <Button type="submit" disabled={isLoading || busy || pin.length < 4} className="h-11 w-full">{tr("Ingia")}</Button>
        <button type="button" className="text-center text-xs text-blue-100 underline-offset-2 hover:underline" disabled={busy} onClick={() => { setLoginMode("password"); setPin(""); setError(""); }}>{tr("Ingia kwa username na password")}</button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <label className="grid gap-1 text-sm text-blue-100">
        
        {tr("Jina la mtumiaji")}
        <Input autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} placeholder={tr("Jina la mtumiaji")} />
      </label>
      <label className="grid gap-1 text-sm text-blue-100">
        {tr("Nenosiri")}
        <span className="relative block">
          <Input className="pr-16" type={showPassword ? "text" : "password"} autoComplete={firstSetup ? "new-password" : "current-password"} required minLength={firstSetup ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr("Nenosiri")} />
          <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-2 flex w-9 items-center justify-center rounded-md text-blue-100 transition hover:bg-white/10" aria-label={showPassword ? tr("Ficha nenosiri") : tr("Onyesha nenosiri")} title={showPassword ? tr("Ficha nenosiri") : tr("Onyesha nenosiri")}>
            {showPassword ? <EyeOff size={19} strokeWidth={1.8} /> : <Eye size={19} strokeWidth={1.8} />}
          </button>
        </span>
      </label>
      <Button type="button" variant="outline" className="w-full" disabled={busy || firstSetup} onClick={() => { setLoginMode("pin"); setPassword(""); setPin(""); setError(""); }}>
        {tr("Staff PIN")}
      </Button>
      {error && <p role="alert" className="rounded-lg bg-red-900/40 p-3 text-sm text-red-100">{error}</p>}
      <Button type="submit" disabled={isLoading || busy} className="w-full">
        {firstSetup ? tr("Fungua akaunti ya msimamizi") : tr("Ingia")}
      </Button>
    </form>
  );
}

