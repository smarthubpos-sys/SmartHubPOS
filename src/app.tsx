import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/error-boundary.tsx";
import { DefaultProviders } from "./components/providers/default.tsx";
import AuthCallback from "./pages/auth/callback.tsx";
import AppLayout from "./pages/layout/Applayout.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
const Dashboard = lazy(() => import("./pages/dashboard/page.tsx"));
const SuperAdminPage = lazy(() => import("./pages/super-admin/page.tsx"));
const SalesPage = lazy(() => import("./pages/sales/page.tsx"));
const WaiterOrdersPage = lazy(() => import("./pages/waiter-orders/page.tsx"));
const StockPage = lazy(() => import("./pages/stock/page.tsx"));
const PurchasingPage = lazy(() => import("./pages/purchasing/page.tsx"));
const PayrollPage = lazy(() => import("./pages/payroll/page.tsx"));
const AccountsPage = lazy(() => import("./pages/accounts/page.tsx"));
const MaintenancePage = lazy(() => import("./pages/maintenance/page.tsx"));
const BillsPage = lazy(() => import("./pages/bills/page.tsx"));
const HRPage = lazy(() => import("./pages/hr/page.tsx"));
const NotificationsPage = lazy(() => import("./pages/notifications/page.tsx"));
const HelpPage = lazy(() => import("./pages/help/page.tsx"));

export default function App() {
  return (
    <DefaultProviders>
      <BrowserRouter>
        <ErrorBoundary>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<Index />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/super-admin" element={<SuperAdminPage />} />
            <Route path="/sales/*" element={<SalesPage />} />
            <Route path="/selling-point" element={<WaiterOrdersPage />} />
            <Route path="/waiter-orders" element={<Navigate to="/selling-point" replace />} />
            <Route path="/stock/*" element={<StockPage />} />
            <Route path="/purchasing/*" element={<PurchasingPage />} />
            <Route path="/payroll/*" element={<PayrollPage />} />
            <Route path="/accounts/*" element={<AccountsPage />} />
            <Route path="/maintenance/*" element={<MaintenancePage />} />
            <Route path="/bills" element={<BillsPage />} />
            <Route path="/hr" element={<HRPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/help" element={<HelpPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </DefaultProviders>
  );
}

