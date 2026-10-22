import { useNavigate, Routes, Route } from "react-router-dom";
import ModuleMenu from "@/pages/layout/_components/ModuleMenu.tsx";
import { ShoppingCart, CreditCard, UserPlus, List, FileText, BarChart2, Receipt, Users, Package, Tag, Activity, User, X } from "lucide-react";
import InvoiceEntry from "@/pages/sales/InvoiceEntry.tsx";
import WaiterOrdersPage from "@/pages/waiter-orders/page.tsx";
import SalesClients from "@/pages/sales/SalesClients.tsx";
import SalesRegister from "@/pages/sales/SalesRegister.tsx";
import { tr } from "@/lib/i18n.ts";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

const salesMenuItems = [
  {
    section: tr("Main Functions"),
    items: [
      { label: tr("Invoicing"), icon: FileText, path: "/sales/invoicing", description: tr("Create and manage sales invoices") },
      { label: tr("Add / Modify Client"), icon: UserPlus, path: "/sales/clients", description: tr("Manage customer accounts") },
    ],
  },
  {
    section: tr("Sales Reports"),
    items: [
      { label: tr("List of Clients"), icon: List, path: "/sales/clients/list", description: tr("All clients") },
      { label: tr("Invoice Report"), icon: Receipt, path: "/sales/reports/invoices", description: tr("Invoice listing") },
      { label: tr("Summary Sales Report"), icon: BarChart2, path: "/sales/reports/summary", description: tr("Sales summary") },
      { label: tr("Client Statement"), icon: User, path: "/sales/reports/client-statement", description: tr("Per-client statement") },
      { label: tr("Sales Analysis"), icon: Activity, path: "/sales/reports/analysis", description: tr("Sales analysis") },
      { label: tr("Sales Tax Report"), icon: FileText, path: "/sales/reports/tax", description: tr("Tax summary") },
      { label: tr("Sales Payment Report"), icon: CreditCard, path: "/sales/reports/payments", description: tr("Payment history") },
      { label: tr("Sales by Client"), icon: Users, path: "/sales/reports/by-client", description: tr("Sales per client") },
      { label: tr("Sales by Product"), icon: Package, path: "/sales/reports/by-product", description: tr("Sales per product") },
      { label: tr("Client Sales Product"), icon: Tag, path: "/sales/reports/client-product", description: tr("Products per client") },
      { label: tr("Product Sales by Client"), icon: Tag, path: "/sales/reports/product-client", description: tr("Clients per product") },
      { label: tr("Staff Sales Report"), icon: Users, path: "/sales/reports/staff", description: tr("Sales by staff") },
      { label: tr("Sold Item Report"), icon: ShoppingCart, path: "/sales/reports/sold-items", description: tr("Sold items history") },
      { label: tr("Sales by Supplier"), icon: Package, path: "/sales/reports/by-supplier", description: tr("Supplier-linked sales") },
      { label: tr("Sales Source Report"), icon: Activity, path: "/sales/reports/source", description: tr("By sales source") },
    ],
  },
];


export default function SalesPage() {
  const navigate = useNavigate();

  const myPerms = useQuery(api.maintenance.myPermissions, {});
  const canViewReports = !!myPerms?.includes("sales.reports.view");

  const visibleSalesMenuItems = salesMenuItems
    .map((section) =>
      section.section === tr("Sales Reports")
        ? {
            ...section,
            items: section.items.filter(
              (item) =>
                item.path === "/sales/clients/list" || canViewReports
            ),
          }
        : section
    )
    .filter((section) => section.items.length > 0);

  return (
    <Routes>
      <Route
        index
        element={
          <ModuleMenu
            title={tr("Sales")}
            sections={visibleSalesMenuItems}
            onClose={() => navigate("/dashboard")}
          />
        }
      />
      <Route path="invoicing" element={<InvoiceEntry />} />
      <Route path="waiter-orders" element={<WaiterOrdersPage />} />
      <Route path="clients" element={<SalesClients />} />
      <Route path="*" element={<SalesRegister />} />
    </Routes>
  );
}
