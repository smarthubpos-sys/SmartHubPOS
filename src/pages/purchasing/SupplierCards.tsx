import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CreditCard, ShoppingBag, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { formatNumber, localDate } from "@/lib/format.ts";
import { tr } from "@/lib/i18n.ts";

function Card({ icon: Icon, label, value, note, tone, to }: { icon: LucideIcon; label: string; value: string; note?: string; tone?: "warn"; to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)} className="group flex flex-col items-start gap-1 rounded-xl border border-border/70 bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className={`h-4 w-4 ${tone === "warn" ? "text-destructive" : ""}`} />{label}</span>
      <span className={`text-xl font-bold tabular-nums ${tone === "warn" ? "text-destructive" : "text-foreground"}`}>{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </button>
  );
}

function Cards() {
  const navigate = useNavigate();
  const today = localDate();
  const monthStart = `${today.slice(0, 8)}01`;
  const d = useQuery(api.purchaseReports.supplierSummary, { today, monthStart });
  if (!d) return <div className="mb-6 h-24 animate-pulse rounded-xl bg-muted/40" />;
  const m = (n: number) => `${d.header.currencySymbol} ${formatNumber(n, d.header.decimalPlaces)}`;
  return (
    <div className="mb-6 space-y-3">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tr("Wasambazaji na malipo")}</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card icon={Wallet} label={tr("Tunadaiwa jumla")} value={m(d.payable)} note={tr("Wasambazaji {0}", [String(d.owedCount)])} to="/purchasing/reports/outstanding" />
        <Card icon={AlertTriangle} label={tr("Zilizopitiwa na muda")} value={m(d.overdue)} note={tr("Invoice {0}", [String(d.overdueCount)])} tone={d.overdue > 0 ? "warn" : undefined} to="/purchasing/reports/outstanding" />
        <Card icon={ShoppingBag} label={tr("Manunuzi mwezi huu")} value={m(d.boughtMonth)} to="/purchasing/reports/by-supplier" />
        <Card icon={CreditCard} label={tr("Malipo mwezi huu")} value={m(d.paidMonth)} note={tr("Malipo {0}", [String(d.paidCount)])} to="/purchasing/reports/payments" />
        <Card icon={Users} label={tr("Wasambazaji wanaodaiwa")} value={String(d.owedCount)} to="/purchasing/reports/supplier-statement" />
      </div>
      {(d.topOwed.length > 0 || d.recentPayments.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-card p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">{tr("Tunaowadai zaidi")}</p>
            {d.topOwed.length === 0 ? <p className="text-sm text-muted-foreground">{tr("Hakuna deni la msambazaji.")}</p> : d.topOwed.map((s) => (
              <button type="button" key={s.supplierId} onClick={() => navigate("/purchasing/reports/supplier-statement")} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"><span className="truncate">{s.name}</span><span className="tabular-nums font-medium">{m(s.balance)}</span></button>
            ))}
          </div>
          <div className="rounded-xl border border-border/70 bg-card p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">{tr("Malipo ya karibuni kwa wasambazaji")}</p>
            {d.recentPayments.length === 0 ? <p className="text-sm text-muted-foreground">{tr("Bado hakuna malipo.")}</p> : d.recentPayments.map((p, i) => (
              <button type="button" key={`${p.reference}-${i}`} onClick={() => navigate("/purchasing/reports/payments")} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"><span className="truncate">{p.supplierName} <span className="text-xs text-muted-foreground">{p.date}</span></span><span className="tabular-nums font-medium">{m(p.amount)}</span></button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown only to people who may view purchase reports (the server enforces it too). */
export default function SupplierCards() {
  const permissions = useQuery(api.maintenance.myPermissions, {});
  if (!permissions?.includes("purchasing.reports.view")) return null;
  return <Cards />;
}
