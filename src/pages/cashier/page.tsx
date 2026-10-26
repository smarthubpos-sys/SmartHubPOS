import { useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/convex/_generated/api";
import ErrorBoundary from "@/components/error-boundary.tsx";
import { tr } from "@/lib/i18n.ts";
import WaiterCollection from "@/pages/waiter-orders/WaiterCollection.tsx";
import StaffSettlement from "@/pages/waiter-orders/StaffSettlement.tsx";
import WaiterDirectory from "@/pages/waiter-orders/WaiterDirectory.tsx";
import SellingPoint from "@/pages/waiter-orders/SellingPoint.tsx";

/** Cashier desk: receive money from waiters (per order or per staff code) and see each waiter's sales and debts. Never for waiters or Super Admin. */
export default function CashierPage() {
  const user = useQuery(api.users.getCurrentUser);
  const business = useQuery(api.tenants.current);
  // Counter selling switch: ON = the cashier sells to his own walk-in customers here; OFF = back to receiving money from waiters.
  const switchKey = `smarthub-cashier-counter-sales-${String(user?._id ?? "")}`;
  const [sellOverride, setSellOverride] = useState<boolean | null>(null);
  const stored = (() => { try { return localStorage.getItem(switchKey) === "1"; } catch { return false; } })();
  const selling = sellOverride ?? stored;
  const setSelling = (on: boolean) => { setSellOverride(on); try { localStorage.setItem(switchKey, on ? "1" : "0"); } catch { /* the choice is only remembered when storage works */ } };
  const role = String(user?.role ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (user === undefined || business === undefined) return null;
  const blocked = ["waiter", "waitress", "super_admin", "superadmin"].includes(role) || business?.canManageWaiterOrders !== true;
  if (blocked) return <div className="rounded-xl border p-6 text-sm text-muted-foreground" role="alert">{tr("Ukurasa huu ni wa cashier pekee.")}</div>;
  return (
    <div className="mx-auto max-w-7xl space-y-4 overflow-x-hidden p-2 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{tr("Cashier")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{selling ? tr("Mauzo ya counter: chagua bidhaa, pokea malipo na uchapishe risiti.") : tr("Pokea fedha kutoka kwa wahudumu, weka malipo na uone madeni yao.")}</p>
        </div>
        {business?.waiterOrdersEnabled !== false && <div className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm font-medium">
          <span>{tr("Mauzo ya counter")}</span>
          <button type="button" role="switch" aria-checked={selling} aria-label={tr("Mauzo ya counter")} onClick={() => setSelling(!selling)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${selling ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${selling ? "left-[22px]" : "left-0.5"}`} />
          </button>
          <span className="text-xs text-muted-foreground">{selling ? tr("Imewashwa") : tr("Imezimwa")}</span>
        </div>}
        <Link to="/selling-point" className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">{tr("Foleni ya oda")}</Link>
      </header>
      {selling && business?.waiterOrdersEnabled !== false
        ? <ErrorBoundary inline><SellingPoint counter /></ErrorBoundary>
        : <ErrorBoundary inline><WaiterCollection /></ErrorBoundary>}
      {business?.canViewSales && <>
        <ErrorBoundary inline><StaffSettlement /></ErrorBoundary>
        <ErrorBoundary inline><WaiterDirectory /></ErrorBoundary>
      </>}
    </div>
  );
}
