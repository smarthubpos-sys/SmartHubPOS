import { type ReactNode, type SelectHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils.ts";

export function PageHeader({ title, subtitle, actions, icon: Icon }: { title: string; subtitle?: string; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {Icon && <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/30"><Icon className="h-5 w-5" /></div>}
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/.04),0_10px_30px_-18px_rgb(40_40_120/.25)] md:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  blue: "from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-300",
  cyan: "from-cyan-500/15 to-cyan-500/5 text-cyan-600 dark:text-cyan-300",
  green: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-300",
  amber: "from-amber-500/20 to-amber-500/5 text-amber-600 dark:text-amber-300",
  rose: "from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-300",
  violet: "from-violet-500/15 to-violet-500/5 text-violet-600 dark:text-violet-300",
} as const;
export type Tone = keyof typeof TONES;

export function Stat({ label, value, sub, tone = "blue", icon: Icon }: { label: string; value: ReactNode; sub?: string; tone?: Tone; icon?: LucideIcon }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
      {Icon && <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br", TONES[tone])}><Icon className="h-4 w-4" /></div>}
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-base font-bold leading-tight">{value}</p>
        {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

const PILL = { green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", amber: "bg-amber-500/20 text-amber-700 dark:text-amber-300", rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300", blue: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", gray: "bg-muted text-muted-foreground" } as const;
export function Pill({ tone = "gray", children }: { tone?: keyof typeof PILL; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", PILL[tone])}>{children}</span>;
}

export function FormField({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1 text-sm", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function SelectBox({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}>{children}</select>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full text-left text-sm">
        <thead><tr className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">{head.map((h) => <th key={h} className="whitespace-nowrap p-2.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="[&_td]:p-2.5 [&_tr]:border-t [&_tr]:border-border/60">{children}</tbody>
      </table>
    </div>
  );
}


