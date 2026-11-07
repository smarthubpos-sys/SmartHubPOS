import { useQuery } from "convex/react";
import { Download } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { tr, trValue } from "@/lib/i18n.ts";
import { downloadOrderExcel } from "@/lib/po-excel.ts";
import ReportSheet, { DataTable, type Column } from "@/pages/purchasing/reports/ReportSheet.tsx";

const m = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A Purchase Order as a printable A4 sheet (Print / PDF) and an Excel file, ready to send to the supplier. */
export default function PurchaseOrderSheet({ orderId }: { orderId: Id<"purchaseOrders"> }) {
  const header = useQuery(api.purchaseReports.reportHeader, {});
  const order = useQuery(api.purchasing.orderDetails, { orderId });
  if (!header || !order) return <p className="p-4 text-sm text-muted-foreground">{tr("Inapakia…")}</p>;
  type Line = (typeof order.lines)[number] & { no: number };
  const rows: Line[] = order.lines.map((l, i) => ({ ...l, no: i + 1 }));
  const columns: Column<Line>[] = [
    { key: "no", label: "#", align: "center" },
    { key: "itemCode", label: "Code" },
    { key: "productName", label: "Bidhaa" },
    { key: "unit", label: "Unit" },
    { key: "qtyOrdered", label: "Quantity", align: "right", render: (r) => m(r.qtyOrdered) },
    { key: "unitCost", label: "Cost", align: "right", render: (r) => m(r.unitCost) },
    { key: "lineTotal", label: "Total", align: "right", render: (r) => m(r.lineTotal) },
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={() => void downloadOrderExcel(header.name, order)}><Download className="mr-1 h-4 w-4" />{tr("Save to Excel")}</Button>
      </div>
      <ReportSheet header={header} title={tr("Purchase Order")} period={`${order.orderRef} · ${order.orderDate}`}
        kpis={[{ label: tr("Supplier"), value: order.supplier.name }, { label: tr("Expected"), value: order.expectedDelivery || "—" }, { label: tr("Hali"), value: trValue(order.status) }, { label: tr("Jumla"), value: m(order.total) }]}>
        <DataTable columns={columns} rows={rows} totals={{ productName: tr("JUMLA"), lineTotal: m(order.total) }} />
        {order.notes && <p className="mt-3 text-xs text-slate-600">{tr("Maelezo")}: {order.notes}</p>}
      </ReportSheet>
    </div>
  );
}
