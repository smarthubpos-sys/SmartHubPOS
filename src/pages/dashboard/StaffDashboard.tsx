import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DollarSign, Plus, Receipt, ShoppingCart, TrendingUp } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import AdsCarousel from "@/components/ads-carousel.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Panel, Pill, Stat } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { compact, formatDate, localDate } from "@/lib/format.ts";
import { getLocale, tr, trValue } from "@/lib/i18n.ts";

const RANGES = [7, 30];
const tip = { contentStyle: { borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12 } };

/**
 * Personal dashboard for staff set to "own data only" (e.g. waiters): their own sales and bills, nothing else.
 * It is a different screen from the business dashboard, so no business-wide figures are ever requested for them.
 */
export default function StaffDashboard() {
  const [days, setDays] = useState(7);
  const today = localDate();
  const from = useMemo(() => localDate(-(days - 1)), [days]);
  const me = useQuery(api.dashboard.getMyDashboard, { from, today });
  const user = useQuery(api.users.getCurrentUser);
  const business = useQuery(api.tenants.current);
  const { money } = useMoney();
  const navigate = useNavigate();
  const canSell = !business?.modules || business.modules.includes("sales");
  const canBill = !business?.modules || business.modules.includes("bills");
  const isCashier = String(user?.role ?? "").toLowerCase().replace(/[ _-]/g, "") === "cashier";

  const tiles = [
    { label: tr("Mauzo yangu ya leo"), value: me && money(me.today.sales), icon: TrendingUp, tone: "blue" as const },
    { label: tr("Fedha nilizopokea leo"), value: me && money(me.today.collected), icon: DollarSign, tone: "green" as const },
    { label: tr("Invoice nilizotoa leo"), value: me && String(me.today.invoices), icon: ShoppingCart, tone: "violet" as const },
    { label: tr("Bili zangu zilizo wazi"), value: me && String(me.openBills), icon: Receipt, tone: "amber" as const },
    { label: tr("Deni kwenye mauzo yangu"), value: me && money(me.range.outstanding), icon: Receipt, tone: "rose" as const },
    { label: tr("Mauzo yangu (kipindi)"), value: me && money(me.range.sales), icon: TrendingUp, tone: "cyan" as const },
  ];
  const daily = (me?.daily ?? []).map((d) => ({ ...d, label: d.date.slice(5) }));

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <AdsCarousel />
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">{tr("Dashboard yangu")}{user?.name ? ` · ${user.name}` : ""}</h2>
          <p className="text-xs text-muted-foreground md:text-sm">{new Date().toLocaleDateString(getLocale(), { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSell && <button onClick={() => navigate("/sales")} className="inline-flex cursor-pointer items-center gap-1 rounded-xl bg-gradient-to-r from-primary to-accent px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-md shadow-primary/30 transition hover:opacity-90"><Plus className="h-3.5 w-3.5" />{tr("New Invoice")}</button>}
          {isCashier && canSell && <button onClick={() => navigate("/sales/payments")} className="inline-flex cursor-pointer items-center gap-1 rounded-xl border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-muted">{tr("Cashier — Pokea Malipo")}</button>}
          {canBill && <button onClick={() => navigate("/bills")} className="inline-flex cursor-pointer items-center gap-1 rounded-xl border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-muted">{tr("Bills")}</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        {tiles.map((t) => t.value === undefined || t.value === null
          ? <Skeleton key={t.label} className="h-[58px] rounded-2xl" />
          : <Stat key={t.label} label={t.label} value={t.value} icon={t.icon} tone={t.tone} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={tr("Mauzo yangu")}
          actions={<div className="flex gap-1 rounded-lg bg-muted p-0.5">{RANGES.map((r) => <button key={r} onClick={() => setDays(r)} className={`cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium ${days === r ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{tr("Siku {0}", [r])}</button>)}</div>}>
          {!me ? <Skeleton className="h-48 w-full" /> : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ left: -12, right: 8, top: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={compact} stroke="var(--muted-foreground)" />
                  <Tooltip {...tip} formatter={(v) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="sales" name={tr("Mauzo")} stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.2} />
                  <Area type="monotone" dataKey="collected" name={tr("Fedha zilizopokelewa")} stroke="var(--chart-3)" strokeWidth={2} fillOpacity={0} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title={tr("Mauzo na bili zangu za hivi karibuni")} actions={<Receipt className="h-4 w-4 text-muted-foreground" />}>
          {me === undefined ? <Skeleton className="h-48 w-full" /> : me.recent.length === 0 ? <p className="py-14 text-center text-sm text-muted-foreground">{tr("Bado hujafanya mauzo kwenye kipindi hiki.")}</p> : (
            <ul className="divide-y divide-border/60">
              {me.recent.map((inv) => (
                <li key={inv._id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{inv.invoiceNo} · {inv.clientName}</p><p className="text-[11px] text-muted-foreground">{formatDate(inv.invoiceDate)}</p></div>
                  <div className="text-right"><p className="text-sm font-semibold">{money(inv.total)}</p><Pill tone={inv.paymentStatus === "paid" ? "green" : inv.paymentStatus === "partial" ? "amber" : "rose"}>{trValue(inv.paymentStatus)}</Pill></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
