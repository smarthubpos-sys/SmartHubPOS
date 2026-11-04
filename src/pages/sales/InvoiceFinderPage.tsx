import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n.ts";
import InvoiceFinder from "@/pages/sales/InvoiceFinder.tsx";

/** Sales > Invoice Finder: nothing is listed until the user searches; the invoice found then shows Print / Edit / Cancel by his rights. */
export default function InvoiceFinderPage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <div className="print:hidden"><Button variant="outline" onClick={() => navigate("/sales")}>{tr("← Sales")}</Button><h1 className="mt-3 text-2xl font-bold">{tr("Invoice Finder")}</h1></div>
      <InvoiceFinder />
    </div>
  );
}
