import { useNavigate, Routes, Route } from "react-router-dom";
import ModuleMenu from "@/pages/layout/_components/ModuleMenu.tsx";
import { BookOpen, Edit, ArrowLeftRight, FileText, RefreshCw, DollarSign, List, BarChart2, TrendingUp, Activity, Users, CreditCard, Calendar, Settings, PiggyBank } from "lucide-react";
import ModuleWorkspace from "@/pages/layout/_components/ModuleWorkspace.tsx";
import CapitalPage from "@/pages/accounts/CapitalPage.tsx";
import ExpensesPage from "@/pages/accounts/ExpensesPage.tsx";
import { tr } from "@/lib/i18n.ts";

const accountsMenuItems = [
  {
    section: tr("Accounting"),
    items: [
      { label: tr("Mapokezi ya Mtaji"), icon: PiggyBank, path: "/accounts/capital", description: tr("Mtaji, mkopo wa benki, mkurugenzi") },
      { label: tr("Chart of Accounts"), icon: List, path: "/accounts/chart", description: tr("Account structure") },
      { label: tr("Journal Entries"), icon: Edit, path: "/accounts/journals", description: tr("Manual double-entry postings") },
      { label: tr("Inter-account Posting"), icon: ArrowLeftRight, path: "/accounts/transfer", description: tr("Transfer between accounts") },
      { label: tr("Expense Payments"), icon: DollarSign, path: "/accounts/expenses", description: tr("Pango, umeme, maji, kodi na matumizi mengine") },
      { label: tr("Bank Reconciliation"), icon: RefreshCw, path: "/accounts/reconciliation", description: tr("Match bank statements") },
      { label: tr("Financial Period Management"), icon: Calendar, path: "/accounts/periods", description: tr("Open/close periods") },
    ],
  },
  {
    section: tr("Reports"),
    items: [
      { label: tr("General Ledger"), icon: BookOpen, path: "/accounts/reports/ledger", description: tr("Full account ledger") },
      { label: tr("Trial Balance"), icon: BarChart2, path: "/accounts/reports/trial-balance", description: tr("Debit/credit balance") },
      { label: tr("Balance Sheet"), icon: FileText, path: "/accounts/reports/balance-sheet", description: tr("Assets vs liabilities") },
      { label: tr("Profit and Loss"), icon: TrendingUp, path: "/accounts/reports/profit-loss", description: tr("Income statement") },
      { label: tr("Trading Account"), icon: Activity, path: "/accounts/reports/trading", description: tr("Trading account") },
      { label: tr("Cash Flow Report"), icon: DollarSign, path: "/accounts/reports/cash-flow", description: tr("Cash movement") },
      { label: tr("Accounts Receivable"), icon: Users, path: "/accounts/reports/receivable", description: tr("Customer balances") },
      { label: tr("Accounts Payable"), icon: CreditCard, path: "/accounts/reports/payable", description: tr("Supplier balances") },
      { label: tr("List of Accounts"), icon: List, path: "/accounts/reports/accounts-list", description: tr("All accounts") },
    ],
  },
];

export default function AccountsPage() {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route
        index
        element={
          <ModuleMenu
            title={tr("Accounts")}
            sections={accountsMenuItems}
            onClose={() => navigate("/dashboard")}
          />
        }
      />
      <Route path="capital" element={<CapitalPage />} />
      <Route path="expenses" element={<ExpensesPage />} />
      <Route path="*" element={<ModuleWorkspace module="accounts" />} />
    </Routes>
  );
}
