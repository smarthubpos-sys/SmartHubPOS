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
      formData.set("flow", firstSetup ? "signUp" : "signIn");
      const normalizedUsername = username.trim().toLowerCase();
      formData.set("username", normalizedUsername);
      formData.set("email", `${normalizedUsername}@login.smarthub.invalid`);
      formData.set("password", password);
      await signIn("password", formData);
      try { window.sessionStorage.setItem(PICK_BUSINESS_FLAG, "1"); } catch { /* ignore */ }
      setUsername("");
      setPassword("");
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
      <label className="grid gap-1 text-sm text-blue-100">
        
        {tr("Nenosiri")}
        <span className="relative block">
          <Input className="pr-16" type={showPassword ? "text" : "password"} autoComplete={firstSetup ? "new-password" : "current-password"} required minLength={firstSetup ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr("Nenosiri")} />
          <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-2 flex w-9 items-center justify-center rounded-md text-blue-100 transition hover:bg-white/10" aria-label={showPassword ? tr("Ficha nenosiri") : tr("Onyesha nenosiri")} title={showPassword ? tr("Ficha nenosiri") : tr("Onyesha nenosiri")}>
            {showPassword ? <EyeOff size={19} strokeWidth={1.8} /> : <Eye size={19} strokeWidth={1.8} />}
          </button>
        </span>
      </label>
      {error && <p role="alert" className="rounded-lg bg-red-900/40 p-3 text-sm text-red-100">{error}</p>}
      <Button type="submit" disabled={isLoading || busy} className="w-full">
        
        {firstSetup ? tr("Fungua akaunti ya msimamizi") : tr("Ingia")}
      </Button>
      <button type="button" className="text-xs text-blue-100 underline" onClick={() => { setFirstSetup((v) => !v); setError(""); }}>
        {firstSetup ? tr("Rudi kwenye kuingia") : tr("Usajili wa kwanza wa msimamizi")}
      </button>
    </form>
  );
}
