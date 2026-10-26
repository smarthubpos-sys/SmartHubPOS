import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n.ts";

export function PageShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Button variant="outline" onClick={() => navigate("/maintenance")} className="cursor-pointer">
        <ArrowLeft className="mr-2 h-4 w-4" />  {tr("Rudi Maintenance")}
      </Button>
      <header>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </header>
      {children}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      {title && <h2 className="font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function TextField(p: { label: string; value: string | number | undefined; onChange: (v: string) => void; type?: string; hint?: string; placeholder?: string; disabled?: boolean }) {
  return (
    <Field label={p.label} hint={p.hint}>
      <Input type={p.type ?? "text"} autoComplete={p.type === "password" ? "new-password" : undefined} step={p.type === "number" ? "any" : undefined} value={p.value ?? ""} placeholder={p.placeholder} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)} />
    </Field>
  );
}

export function SelectField(p: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; hint?: string; disabled?: boolean }) {
  return (
    <Field label={p.label} hint={p.hint}>
      <select className="h-10 rounded-md border bg-background px-3 text-sm" value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)}>
        {p.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </Field>
  );
}

export function Toggle({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
}


export function NoAccess({ permission }: { permission: string }) {
  return <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{tr("Huna ruhusa ya kubadilisha ukurasa huu (")}<code>{permission}</code>{tr("). Unaweza kuona tu.")}</p>;
}

export function Loading() {
  return <p className="text-sm text-muted-foreground">{tr("Inapakia…")}</p>;
}
