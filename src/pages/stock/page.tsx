import { useNavigate, Routes, Route } from "react-router-dom";
import ModuleMenu from "@/pages/layout/_components/ModuleMenu.tsx";
import { Package, Sliders, FolderTree, Hash, ArrowLeftRight, BarChart2, Tag, TrendingUp, ClipboardList, Calendar, Barcode, AlertTriangle, X, History, FileSpreadsheet } from "lucide-react";
import StockWorkspace from "@/pages/stock/StockWorkspace.tsx";
import StockImport from "@/pages/stock/StockImport.tsx";
import { tr } from "@/lib/i18n.ts";

const stockMenuItems = [
  {
    section: tr("Stock Management"),
    items: [
      { label: tr("Add / Modify Stock"), icon: Package, path: "/stock/products", description: tr("Manage product catalog") },
      { label: tr("Import from Excel"), icon: FileSpreadsheet, path: "/stock/import", description: tr("Upload products with an Excel file") },
      { label: tr("Quantity Adjustment"), icon: Sliders, path: "/stock/adjustment", description: tr("Adjust stock quantities") },
      { label: tr("Group Maintenance"), icon: FolderTree, path: "/stock/groups", description: tr("Product groups and categories") },
      { label: tr("Item Quantity"), icon: Hash, path: "/stock/item-quantity", description: tr("Current stock levels") },
      { label: tr("Transaction Quantity"), icon: ArrowLeftRight, path: "/stock/transactions", description: tr("Stock movements") },
      { label: tr("Item History"), icon: History, path: "/stock/item-history", description: tr("Full item movement history") },
    ],
  },
  {
    section: tr("Stock Reports"),
    items: [
      { label: tr("Quantity Report"), icon: BarChart2, path: "/stock/reports/quantity", description: tr("Stock quantity report") },
      { label: tr("Selling Price Report"), icon: Tag, path: "/stock/reports/prices", description: tr("Product price list") },
      { label: tr("Stock Earning Report"), icon: TrendingUp, path: "/stock/reports/earnings", description: tr("Profit by item") },
      { label: tr("Stock Taking Report"), icon: ClipboardList, path: "/stock/reports/stock-take", description: tr("Count vs system") },
      { label: tr("Expired Date Report"), icon: Calendar, path: "/stock/reports/expiry", description: tr("Expiring items") },
      { label: tr("Serial Number Report"), icon: Hash, path: "/stock/reports/serials", description: tr("Serial numbers") },
      { label: tr("Print Stock Barcodes"), icon: Barcode, path: "/stock/barcodes", description: tr("Print labels") },
      { label: tr("Stock Reorder Report"), icon: AlertTriangle, path: "/stock/reports/reorder", description: tr("Items below reorder level") },
      { label: tr("Out of Stock Report"), icon: X, path: "/stock/reports/out-of-stock", description: tr("Zero stock items") },
    ],
  },
];

export default function StockPage() {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route
        index
        element={
          <ModuleMenu
            title={tr("Stock Management")}
            sections={stockMenuItems}
            onClose={() => navigate("/dashboard")}
          />
        }
      />
      <Route path="import" element={<StockImport />} />
      <Route path="*" element={<StockWorkspace />} />
    </Routes>
  );
}
