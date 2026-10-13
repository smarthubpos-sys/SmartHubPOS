import { useNavigate, Routes, Route } from "react-router-dom";
import ModuleMenu from "@/pages/layout/_components/ModuleMenu.tsx";
import { FileText, List, User, BarChart2, Package, CreditCard, Receipt, TrendingDown, Activity, ShoppingBag, ClipboardCheck, ArrowLeftRight } from "lucide-react";
import ModuleWorkspace from "@/pages/layout/_components/ModuleWorkspace.tsx";
import SupplierWorkspace from "@/pages/purchasing/SupplierWorkspace.tsx";
import RegisterWorkspace from "@/pages/purchasing/RegisterWorkspace.tsx";
import { tr } from "@/lib/i18n.ts";

const purchasingMenuItems = [
  {
    section: tr("Purchase Operations"),
    items: [
      { label: tr("Purchase Entry"), icon: FileText, path: "/purchasing/entry", description: tr("Record new purchase invoices") },
      { label: tr("Purchase Orders"), icon: ShoppingBag, path: "/purchasing/orders", description: tr("Create and manage POs") },
      { label: tr("Goods Received Notes"), icon: ClipboardCheck, path: "/purchasing/grn", description: tr("Record goods received") },
      { label: tr("Purchase Returns"), icon: ArrowLeftRight, path: "/purchasing/returns", description: tr("Return goods to suppliers") },
      { label: tr("Supplier Management"), icon: User, path: "/purchasing/suppliers", description: tr("Manage supplier accounts") },
    ],
  },
  {
    section: tr("Purchase Reports"),
    items: [
      { label: tr("Purchase Invoice List"), icon: List, path: "/purchasing/reports/invoices", description: tr("All purchase invoices") },
      { label: tr("Supplier Statement"), icon: Receipt, path: "/purchasing/reports/supplier-statement", description: tr("Per-supplier statement") },
      { label: tr("Purchase Report"), icon: BarChart2, path: "/purchasing/reports/summary", description: tr("Purchase summary") },
      { label: tr("Purchase by Supplier"), icon: User, path: "/purchasing/reports/by-supplier", description: tr("Purchases per supplier") },
      { label: tr("Purchase by Product"), icon: Package, path: "/purchasing/reports/by-product", description: tr("Purchases per product") },
      { label: tr("Purchase Payment Report"), icon: CreditCard, path: "/purchasing/reports/payments", description: tr("Payment history") },
      { label: tr("Outstanding Supplier"), icon: TrendingDown, path: "/purchasing/reports/outstanding", description: tr("Unpaid balances") },
      { label: tr("Last Purchase Price"), icon: FileText, path: "/purchasing/reports/last-price", description: tr("Latest costs by product") },
      { label: tr("Purchase Analysis"), icon: Activity, path: "/purchasing/reports/analysis", description: tr("Purchase trends") },
    ],
  },
];

export default function PurchasingPage() {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route
        index
        element={
          <ModuleMenu
            title={tr("Purchasing")}
            sections={purchasingMenuItems}
            onClose={() => navigate("/dashboard")}
          />
        }
      />
      <Route path="suppliers" element={<SupplierWorkspace />} />
      <Route path="entry" element={<ModuleWorkspace module="purchasing" />} />
      <Route path="*" element={<RegisterWorkspace />} />
    </Routes>
  );
}
