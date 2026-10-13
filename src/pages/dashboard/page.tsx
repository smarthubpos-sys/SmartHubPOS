import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Clock, DollarSign, Package, Plus, ShoppingCart, TrendingUp, Truck, Users, Receipt } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import AdsCarousel from "@/components/ads-carousel.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Panel, Pill, Stat } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { compact, formatDate, localDate } from "@/lib/format.ts";
import { getLocale, tr, trValue } from "@/lib/i18n.ts";
import StaffDashboard from "./StaffDashboard.tsx";

const RANGES = [7, 30, 90];
const tip = { contentStyle: { borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12 } };

/** Staff (waiters/cashiers set to "own data only") get a personal dashboard; everyone else gets the business dashboard. */
export default function Dashboard() {
  const business = useQuery(api.tenants.current);
  return business?.ownDataOnly ? <StaffDashboard /> : <BusinessDashboard />;
}

function BusinessDashboard() {
  const [days, setDays] = useState(30);
  const today = localDate();
  const from = useMemo(() => localDate(-(days - 1)), [days]);
  const metrics = useQuery(api.dashboard.getMetrics, { date: today });
  const charts = useQuery(api.dashboard.getCharts, { from, today });
  const settings = useQuery(api.dashboard.getSettings);
  const { money } = useMoney();
  const navigate = useNavigate();
  const business = useQuery(api.tenants.current);
  const touch = useMutation(api.stats.touch);
  // Keeps the pre-computed numbers fresh in the background (does nothing when they already are).
  useEffect(() => {
    const run = () => void Promise.resolve(touch({})).catch(() => undefined);
    run();
    const t = window.setInterval(run, 120_000);
    return () => window.clearInterval(t);
  }, [touch]);
  const preparing = metrics?.ready === false || charts?.ready === false; // first-time calculation for this business

  const tiles = [
    { label: tr("Today's Sales"), value: metrics && money(metrics.todaySales), icon: TrendingUp, tone: "blue" as const },
    { label: tr("Cash Received"), value: metrics && money(metrics.todayCash), icon: DollarSign, tone: "green" as const },
    { label: tr("Today's Purchases"), value: metrics && money(metrics.todayPurchaseTotal), icon: Truck, tone: "violet" as const },
    { label: tr("Outstanding Receivables"), value: metrics && money(metrics.totalOutstandingCustomer), icon: ShoppingCart, tone: "amber" as const },
    { label: tr("Outstanding Payables"), value: metrics && money(metrics.totalOutstandingSupplier), icon: Users, tone: "rose" as const },
    { label: tr("Inventory Value"), value: metrics && money(metrics.inventoryValue), icon: Package, tone: "cyan" as const },
    { label: tr("Low Stock Items"), value: metrics && String(metrics.lowStockItems), icon: AlertTriangle, tone: "amber" as const },
    { label: tr("Out of Stock"), value: metrics && String(metrics.outOfStockItems), icon: Clock, tone: "rose" as const },
  ];
  const quick = [
    { label: tr("New Invoice"), path: "/sales", module: "sales" },
    { label: tr("New Purchase"), path: "/purchasing", module: "purchasing" },
    { label: tr("Stock Lookup"), path: "/stock", module: "stock" },
    { label: tr("Bills"), path: "/bills", module: "bills" },
  ].filter((q) => !business?.modules || business.modules.includes(q.module));

  const daily = (charts?.daily ?? []).map((d) => ({ ...d, label: d.date.slice(5) }));
  const stockPie = charts ? [
    { name: tr("Zenye stoo"), value: charts.stockHealth.ok, color: "var(--chart-3)" },
    { name: tr("Zinazoisha"), value: charts.stockHealth.low, color: "var(--chart-4)" },
    { name: tr("Zilizoisha"), value: charts.stockHealth.out, color: "var(--chart-5)" },
  ].filter((x) => x.value > 0) : [];
  const owed = charts ? [
    { name: tr("Madeni ya wateja"), value: charts.receivable, color: "var(--chart-2)" },
    { name: tr("Madeni ya wasambazaji"), value: charts.payable, color: "var(--chart-5)" },
    { name: tr("Bili zinazodaiwa"), value: charts.billsDue, color: "var(--chart-4)" },
  ] : [];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <AdsCarousel />
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">{settings?.companyName ?? "SmartHubPOS"}</h2>
          <p className="text-xs text-muted-foreground md:text-sm">{new Date().toLocaleDateString(getLocale(), { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quick.map((q, i) => (
            <button key={q.path} onClick={() => navigate(q.path)} className={`inline-flex cursor-pointer items-center gap-1 rounded-xl px-3 py-1.5 text-sm font-medium transition hover:opacity-90 ${i === 0 ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md shadow-primary/30" : "border bg-card hover:bg-muted"}`}>
              {i === 0 && <Plus className="h-3.5 w-3.5" />}{q.label}
            </button>
          ))}
        </div>
      </div>

      {preparing && <p className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="status">{tr("Inaandaa takwimu za biashara yako kwa mara ya kwanza… zitaonekana ndani ya sekunde chache.")}</p>}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {tiles.map((t) => t.value === undefined || t.value === null
          ? <Skeleton key={t.label} className="h-[58px] rounded-2xl" />
          : <Stat key={t.label} label={t.label} value={t.value} icon={t.icon} tone={t.tone} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={tr("Mauzo na manunuzi")}
          actions={<div className="flex gap-1 rounded-lg bg-muted p-0.5">{RANGES.map((r) => <button key={r} onClick={() => setDays(r)} className={`cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium ${days === r ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{tr("Siku {0}", [r])}</button>)}</div>}>
          {!charts ? <Skeleton className="h-56 w-full" /> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ left: -12, right: 8, top: 6 }}>
                  <defs>
                    <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
                    <linearGradient id="gBuy" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={compact} stroke="var(--muted-foreground)" />
                  <Tooltip {...tip} formatter={(v) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="sales" name={tr("Mauzo")} stroke="var(--chart-1)" strokeWidth={2} fill="url(#gSales)" />
                  <Area type="monotone" dataKey="purchases" name={tr("Manunuzi")} stroke="var(--chart-2)" strokeWidth={2} fill="url(#gBuy)" />
                  <Area type="monotone" dataKey="collected" name={tr("Fedha zilizopokelewa")} stroke="var(--chart-3)" strokeWidth={2} fillOpacity={0} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title={tr("Hali ya stoo")}>
          {!charts ? <Skeleton className="h-56 w-full" /> : stockPie.length === 0 ? <p className="py-16 text-center text-sm text-muted-foreground">{tr("Bado hakuna bidhaa.")}</p> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stockPie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={3} stroke="none">
                    {stockPie.map((s) => <Cell key={s.name} fill={s.color} />)}
                  </Pie>
                  <Tooltip {...tip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={tr("Bidhaa zinazouzwa zaidi")}>
          {!charts ? <Skeleton className="h-48 w-full" /> : charts.topProducts.length === 0 ? <p className="py-14 text-center text-sm text-muted-foreground">{tr("Hakuna mauzo kwenye kipindi hiki.")}</p> : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.topProducts} layout="vertical" margin={{ left: 4, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={compact} stroke="var(--muted-foreground)" />
                  <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <Tooltip {...tip} formatter={(v) => money(Number(v))} />
                  <Bar dataKey="total" name={tr("Mauzo")} radius={[0, 8, 8, 0]} fill="var(--chart-1)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title={tr("Madeni na bili")}>
          {!charts ? <Skeleton className="h-48 w-full" /> : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={owed} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={compact} stroke="var(--muted-foreground)" />
                  <Tooltip {...tip} formatter={(v) => money(Number(v))} />
                  <Bar dataKey="value" name={tr("Kiasi")} radius={[8, 8, 0, 0]}>{owed.map((o) => <Cell key={o.name} fill={o.color} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title={tr("Recent Sales")} actions={<Receipt className="h-4 w-4 text-muted-foreground" />}>
          {metrics === undefined ? <Skeleton className="h-48 w-full" /> : metrics.recentInvoices.length === 0 ? <p className="py-14 text-center text-sm text-muted-foreground">{tr("No recent invoices")}</p> : (
            <ul className="divide-y divide-border/60">
              {metrics.recentInvoices.map((inv) => (
                <li key={inv._id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{inv.invoiceNo}</p><p className="text-[11px] text-muted-foreground">{formatDate(inv.invoiceDate)}</p></div>
                  <div className="text-right"><p className="text-sm font-semibold">{money(inv.total)}</p><Pill tone={inv.paymentStatus === "paid" ? "green" : inv.paymentStatus === "partial" ? "amber" : "rose"}>{trValue(inv.paymentStatus)}</Pill></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={tr("Recent Purchases")}>
        {metrics === undefined ? <Skeleton className="h-16 w-full" /> : metrics.recentPurchases.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{tr("No recent purchases")}</p> : (
          <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.recentPurchases.map((p) => (
              <div key={p._id} className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{p.internalRef}</p><p className="text-[11px] text-muted-foreground">{formatDate(p.purchaseDate)}</p></div>
                <div className="text-right"><p className="text-sm font-semibold">{money(p.total)}</p><Pill tone={p.paymentStatus === "paid" ? "green" : p.paymentStatus === "partial" ? "amber" : "rose"}>{trValue(p.paymentStatus)}</Pill></div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
