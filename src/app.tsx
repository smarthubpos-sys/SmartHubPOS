import { BrowserRouter, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/error-boundary.tsx";
import { DefaultProviders } from "./components/providers/default.tsx";
import AuthCallback from "./pages/auth/callback.tsx";
import AppLayout from "./pages/layout/Applayout.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Dashboard from "./pages/dashboard/page.tsx";
import SuperAdminPage from "./pages/super-admin/page.tsx";
import SalesPage from "./pages/sales/page.tsx";
import StockPage from "./pages/stock/page.tsx";
import PurchasingPage from "./pages/purchasing/page.tsx";
import PayrollPage from "./pages/payroll/page.tsx";
import AccountsPage from "./pages/accounts/page.tsx";
import MaintenancePage from "./pages/maintenance/page.tsx";
import BillsPage from "./pages/bills/page.tsx";
import HRPage from "./pages/hr/page.tsx";
import NotificationsPage from "./pages/notifications/page.tsx";
import HelpPage from "./pages/help/page.tsx";

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
