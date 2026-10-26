import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/convex/_generated/api";
import ErrorBoundary from "@/components/error-boundary.tsx";
import { tr } from "@/lib/i18n.ts";
import WaiterCollection from "@/pages/waiter-orders/WaiterCollection.tsx";
import StaffSettlement from "@/pages/waiter-orders/StaffSettlement.tsx";
import WaiterDirectory from "@/pages/waiter-orders/WaiterDirectory.tsx";

/** Cashier desk: receive money from waiters (per order or per staff code) and see each waiter's sales and debts. Never for waiters or Super Admin. */
export default function CashierPage() {
  const user = useQuery(api.users.getCurrentUser);
  const business = useQuery(api.tenants.current);
  const role = String(user?.role ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (user === undefined || business === undefined) return null;
  const blocked = ["waiter", "waitress", "super_admin", "superadmin"].includes(role) || business?.canManageWaiterOrders !== true;
  if (blocked) return <div className="rounded-xl border p-6 text-sm text-muted-foreground" role="alert">{tr("Ukurasa huu ni wa cashier pekee.")}</div>;
  return (
    <div className="mx-auto max-w-7xl space-y-4 overflow-x-hidden p-2 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{tr("Cashier")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tr("Pokea fedha kutoka kwa wahudumu, weka malipo na uone madeni yao.")}</p>
        </div>
        <Link to="/selling-point" className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">{tr("Foleni ya oda")}</Link>
      </header>
      <ErrorBoundary inline><WaiterCollection /></ErrorBoundary>
      {business?.canViewSales && <>
        <ErrorBoundary inline><StaffSettlement /></ErrorBoundary>
        <ErrorBoundary inline><WaiterDirectory /></ErrorBoundary>
      </>}
    </div>
  );
}
