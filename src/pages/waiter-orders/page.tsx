import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { tr, errorText } from "@/lib/i18n.ts";
import { brandingFromSettings } from "@/lib/receipt-branding.ts";
import { Link } from "react-router-dom";
import SellingPoint from "./SellingPoint.tsx";
import WaiterDirectory from "./WaiterDirectory.tsx";
import StaffSettlement from "./StaffSettlement.tsx";
import ErrorBoundary from "@/components/error-boundary.tsx";
import { printWaiterOrder, qzPrinterFrom, type PrintableOrder } from "@/lib/print-waiter-order.ts";

const waiterApi = api.waiterOrders;

type Order = Doc<"waiterOrders">;

export default function WaiterOrdersPage() {
  const user = useQuery(api.users.getCurrentUser);
  const business = useQuery(api.tenants.current);
  const orders = useQuery(waiterApi.list);
  const markHandled = useMutation(waiterApi.markHandled);
  const sendToCashier = useMutation(waiterApi.sendToCashier);
  const markPrinted = useMutation(waiterApi.markPrinted);
  const cancelOrder = useMutation(waiterApi.cancel);
  const settings = useQuery(api.maintenance.getSettings, {});
  const branding = brandingFromSettings(settings as Parameters<typeof brandingFromSettings>[0]);
  const hardware = (settings?.app?.hardware ?? {}) as { printerSource?: string; receiptPrinter?: string; paperWidth?: string };

  const role = String(user?.role ?? "").toLowerCase();
  // Cashier = any non-waiter role that may manage waiter orders (custom role names such as "Kassa" included), plus the built-in names.
  const isWaiterRole = role === "waiter" || role === "waitress";
  const superAdmin = ["super_admin", "superadmin"].includes(role.replace(/[\s-]+/g, "_"));
  const cashier = !isWaiterRole && !superAdmin && (["cashier", "manager", "admin", "administrator", "owner", "business_owner", "super_admin", "superadmin"].includes(role) || business?.canManageWaiterOrders === true);

  // Waiter and Waitress each follow their own switch (Super Admin > Edit Business); other roles need at least one on.
  const roleEnabled = superAdmin || role === "waitress" ? business?.waitressEnabled === true : role === "waiter" ? business?.waiterEnabled === true : business?.waiterOrdersEnabled === true;

  async function send(orderId: string) {
    try {
      await sendToCashier({ orderId: orderId as Id<"waiterOrders"> });
      toast.success(tr("Oda imetumwa kwa cashier."));
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kutuma oda.")));
    }
  }

  async function printPlaced(order: Order) {
    if (settings === undefined) { toast.message(tr("Mipangilio ya printer bado inapakia. Jaribu tena baada ya sekunde chache.")); return; }
    const printed = await printWaiterOrder(order, qzPrinterFrom(hardware), hardware.paperWidth, branding);
    if (!printed) return;
    try {
      await markPrinted({ orderId: order._id });
      toast.success(tr("Oda imechapishwa kupitia QZ Tray."));
    } catch (error) {
      toast.error(errorText(error, tr("Oda imechapishwa, lakini hali yake haikuhifadhiwa. Jaribu kusasisha ukurasa.")));
    }
  }

  async function remove(order: Order) {
    if (!window.confirm(tr("Futa oda hii? Stock ya mauzo haijapunguzwa na oda hii."))) return;
    try {
      await cancelOrder({ orderId: order._id });
      toast.success(tr("Oda imefutwa."));
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kufuta oda.")));
    }
  }

  async function receiveAndPrint(order: Order) {
    if (settings === undefined) { toast.message(tr("Mipangilio ya printer bado inapakia. Jaribu tena baada ya sekunde chache.")); return; }
    const printed = await printWaiterOrder(order, qzPrinterFrom(hardware), hardware.paperWidth, branding);
    if (!printed) return;
    try {
      await markHandled({ orderId: order._id });
      toast.success(tr("Oda imechapishwa na kupokelewa. Mhudumu amearifiwa."));
    } catch (error) {
      toast.error(errorText(error, tr("Oda imechapishwa, lakini hali yake haikuhifadhiwa. Jaribu tena.")));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 overflow-x-hidden p-2 sm:p-4">
      <header>
        <h1 className="text-2xl font-bold">{tr("Selling Point")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr("Chagua kundi, gusa bidhaa, kisha Send au Print. Stock inapunguzwa mara moja tu, Send/Print ikibonyezwa.")}
        </p>
      </header>

      {roleEnabled && !cashier && <SellingPoint />}

      {cashier && <section className="space-y-3">
        <h2 className="text-lg font-semibold">{tr("Foleni ya cashier")}</h2>
        {(orders ?? []).map((order) => <article key={order._id} className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{order.customerName} {order.tableNumber ? `· ${tr("Meza")} ${order.tableNumber}` : ""}</h3>
              <p className="text-sm text-muted-foreground">{tr("Waiter")}: {order.waiterName} · {new Date(order.createdAt).toLocaleString()}</p>
              <p className="text-sm">{tr("Hali")}: {order.status === "cancelled" ? tr("Imefutwa") : order.status === "placed" ? tr("Imewekwa (haijatumwa)") : order.status === "printed" ? tr("Imechapishwa na waiter") : order.status === "pending" ? tr("Inasubiri cashier") : tr("Imepokelewa")}</p>
            </div>
            <strong>{Number(order.total).toLocaleString()}</strong>
          </div>
          <ul className="space-y-1 text-sm">
            {order.lines.map((line, i) => <li key={i}>
              {line.productName} × {line.qty} — {Number(line.lineTotal).toLocaleString()}
            </li>)}
          </ul>
          {order.notes && <p className="text-sm">{tr("Maelezo")}: {order.notes}</p>}
          <div className="flex flex-wrap gap-2">
            {!cashier && business?.waiterOrderMode !== "print" && order.status === "placed" && <Button onClick={() => void send(order._id)}>{tr("Send")}</Button>}
            {business?.canVoidInvoice && order.status !== "cancelled" && <Button variant="outline" onClick={() => void remove(order)}>{tr("Futa oda")}</Button>}
            {/* Cashier Print = receive + print: the waiter is notified that the order was received. Waiter Print only prints. */}
            {order.status === "cancelled" ? null : cashier
              ? (order.status === "pending" || order.status === "accepted") && <Button onClick={() => void receiveAndPrint(order)}>{tr("Print")}</Button>
              : business?.waiterOrderMode === "print" && (order.status === "placed" || order.status === "printed") ? <Button variant="outline" onClick={() => void printPlaced(order)}>{tr("Print")}</Button> : null}
          </div>
        </article>)}
        {orders && orders.length === 0 && <p className="rounded-xl border p-5 text-sm text-muted-foreground">{tr("Hakuna oda bado.")}</p>}
      </section>}
      {/* Waiter orders are handed off to the cashier queue; do not duplicate them below the selling screen. */}
      {/* Each optional panel has its own boundary: one panel failing (e.g. a Convex function not deployed yet) must not blank the whole page. */}
      {/* Waiter bills live under the sidebar "Bills" menu (not duplicated here). */}
      {cashier && business?.canViewSales && role !== "super_admin" && role !== "superadmin" && <>
        <ErrorBoundary inline><StaffSettlement /></ErrorBoundary>
        <ErrorBoundary inline><WaiterDirectory /></ErrorBoundary>
      </>}
      {cashier && <Link to="/cashier" className="inline-flex rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">{tr("Pokea fedha za wahudumu → Cashier")}</Link>}
    </div>
  );
}
