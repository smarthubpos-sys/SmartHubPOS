import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { tr, errorText } from "@/lib/i18n.ts";
import { PICK_BUSINESS_FLAG } from "@/lib/business-session.ts";

const PIN_USER_KEY = "smarthub.pinUsername"; // last staff username used with PIN on this device, so the waiter only taps the PIN next time

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
      const normalizedUsername = username.trim().toLowerCase();
      formData.set("username", normalizedUsername);
      if (loginMode === "pin") {
        formData.set("pin", pin);
        await signIn("staffPin", formData);
      } else {
        formData.set("flow", firstSetup ? "signUp" : "signIn");
        formData.set("email", `${normalizedUsername}@login.smarthub.invalid`);
        formData.set("password", password);
        await signIn("password", formData);
      }
      if (loginMode === "pin") { try { window.localStorage.setItem(PIN_USER_KEY, normalizedUsername); } catch { /* ignore */ } }
      try { window.sessionStorage.setItem(PICK_BUSINESS_FLAG, "1"); } catch { /* ignore */ }
      if (loginMode !== "pin") setUsername("");
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

  return (
    <form onSubmit={submit} className="grid gap-3">
      <label className="grid gap-1 text-sm text-blue-100">
        
        {tr("Jina la mtumiaji")}
        <Input autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} placeholder={tr("Jina la mtumiaji")} />
      </label>
      {loginMode === "password" ? (
        <label className="grid gap-1 text-sm text-blue-100">
          {tr("Nenosiri")}
          <span className="relative block">
            <Input className="pr-16" type={showPassword ? "text" : "password"} autoComplete={firstSetup ? "new-password" : "current-password"} required minLength={firstSetup ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr("Nenosiri")} />
            <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-2 flex w-9 items-center justify-center rounded-md text-blue-100 transition hover:bg-white/10" aria-label={showPassword ? tr("Ficha nenosiri") : tr("Onyesha nenosiri")} title={showPassword ? tr("Ficha nenosiri") : tr("Onyesha nenosiri")}>
              {showPassword ? <EyeOff size={19} strokeWidth={1.8} /> : <Eye size={19} strokeWidth={1.8} />}
            </button>
          </span>
        </label>
      ) : (
        <div className="grid gap-2 text-sm text-blue-100">
          <label className="grid gap-1">{tr("PIN ya wafanyakazi")}
            <Input inputMode="numeric" autoComplete="one-time-code" type="password" required minLength={4} maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" />
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((digit) => <Button key={digit} type="button" variant="outline" disabled={busy || pin.length >= 4} onClick={() => setPin((p) => (p.length < 4 ? p + digit : p))}>{digit}</Button>)}
            <Button type="button" variant="outline" disabled={busy || !pin} onClick={() => setPin("")}>{tr("Futa")}</Button>
            <Button type="button" variant="outline" disabled={busy || pin.length >= 4} onClick={() => setPin((p) => (p.length < 4 ? p + "0" : p))}>0</Button>
            <Button type="button" variant="outline" disabled={busy || !pin} onClick={() => setPin((p) => p.slice(0, -1))}>⌫</Button>
          </div>
        </div>
      )}
      <Button type="button" variant="outline" className="w-full" disabled={busy || firstSetup} onClick={() => { const next = loginMode === "password" ? "pin" : "password"; setLoginMode(next); setPassword(""); setPin(""); setError(""); if (next === "pin" && !username) { try { setUsername(window.localStorage.getItem(PIN_USER_KEY) ?? ""); } catch { /* ignore */ } } }}>
        {loginMode === "password" ? tr("Staff PIN") : tr("Ingia kwa username na password")}
      </Button>
      {error && <p role="alert" className="rounded-lg bg-red-900/40 p-3 text-sm text-red-100">{error}</p>}
      <Button type="submit" disabled={isLoading || busy || (loginMode === "pin" && pin.length !== 4)} className="w-full">
        {firstSetup && loginMode === "password" ? tr("Fungua akaunti ya msimamizi") : tr("Ingia")}
      </Button>
    </form>
  );
}

