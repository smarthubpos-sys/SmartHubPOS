import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tr, errorText } from "@/lib/i18n.ts";

const waiterApi = api.waiterOrders;

type Order = Doc<"waiterOrders">;
type PrintableOrder = Pick<Order, "customerName" | "waiterName" | "total"> & { tableNumber?: string; notes?: string; lines: Array<{ productName: string; qty: number; lineTotal: number }> };
type Line = { productId: string; qty: string };

export default function WaiterOrdersPage() {
  const user = useQuery(api.users.getCurrentUser);
  const business = useQuery(api.tenants.current);
  const products = useQuery(api.products.listActive);
  const orders = useQuery(waiterApi.list);
  const placeOrder = useMutation(waiterApi.place);
  const markHandled = useMutation(waiterApi.markHandled);
  const sendToCashier = useMutation(waiterApi.sendToCashier);
  const markPrinted = useMutation(waiterApi.markPrinted);

  const [customer, setCustomer] = useState("");
  const [table, setTable] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", qty: "1" }]);
  const [busy, setBusy] = useState(false);

  const total = useMemo(() => lines.reduce((sum, line) => {
    const product = (products ?? []).find(p => p._id === line.productId);
    return sum + (product?.sellingPrice ?? 0) * Math.max(0, Number(line.qty) || 0);
  }, 0), [lines, products]);

  const role = String(user?.role ?? "").toLowerCase();
  const cashier = ["cashier", "manager", "admin", "administrator", "owner", "business_owner", "super_admin", "superadmin"].includes(role);

  // Waiter and Waitress each follow their own switch (Super Admin > Edit Business); other roles need at least one on.
  const roleEnabled = role === "waitress" ? business?.waitressEnabled === true : role === "waiter" ? business?.waiterEnabled === true : business?.waiterOrdersEnabled === true;

  async function place() {
    if (!customer.trim()) {
      toast.error(tr("Weka jina la mteja."));
      return;
    }
    if (lines.some(line => !line.productId || !(Number(line.qty) > 0))) {
      toast.error(tr("Chagua bidhaa na kiasi sahihi kwa kila mstari."));
      return;
    }
    setBusy(true);
    try {
      await placeOrder({
        customerName: customer.trim(),
        tableNumber: table.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map(line => ({
          productId: line.productId as Id<"products">,
          qty: Number(line.qty),
        })),
      });
      toast.success(tr("Oda imewekwa. Stock imepungua. Sasa chagua Send au Print."));
      setCustomer("");
      setTable("");
      setNotes("");
      setLines([{ productId: "", qty: "1" }]);
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kuweka oda.")));
    } finally {
      setBusy(false);
    }
  }

  async function send(orderId: string) {
    try {
      await sendToCashier({ orderId: orderId as Id<"waiterOrders"> });
      toast.success(tr("Oda imetumwa kwa cashier."));
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kutuma oda.")));
    }
  }

  async function printPlaced(order: Order) {
    printOrder(order);
    try { await markPrinted({ orderId: order._id }); } catch { /* printing already happened; the record is only informational */ }
  }

  async function receiveAndPrint(order: Order) {
    try {
      await markHandled({ orderId: order._id });
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kupokea oda.")));
      return;
    }
    toast.success(tr("Oda imepokelewa. Mhudumu amearifiwa."));
    printOrder(order);
  }

  function printOrder(order: PrintableOrder) {
    const content = [
      "SMARTHUB POS - ODA",
      `Mteja: ${order.customerName}`,
      `Meza: ${order.tableNumber || "-"}`,
      `Waiter: ${order.waiterName}`,
      "------------------------------",
      ...order.lines.map((line) =>
        `${line.productName} x ${line.qty} = ${Number(line.lineTotal).toLocaleString()}`
      ),
      "------------------------------",
      `JUMLA: ${Number(order.total).toLocaleString()}`,
      order.notes ? `Maelezo: ${order.notes}` : "",
    ].filter(Boolean).join("\n");

    const win = window.open("", "_blank", "width=420,height=650");
    if (!win) {
      toast.error(tr("Ruhusu popup ili kuchapisha oda."));
      return;
    }
    win.document.write(`<html><head><title>Oda</title><style>body{font:14px monospace;padding:20px;white-space:pre-wrap}</style></head><body></body></html>`);
    win.document.body.textContent = content;
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-3 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">{tr("Waiter Orders")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr("Weka oda (stock inapungua hapa tu), kisha Send kwa cashier au Print. Send na Print havipunguzi stock.")}
        </p>
      </header>

      {roleEnabled && !cashier && <section className="space-y-4 rounded-xl border p-4 sm:p-5">
        <h2 className="font-semibold">{tr("Oda mpya")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">{tr("Jina la mteja")}
            <Input value={customer} onChange={e => setCustomer(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">{tr("Namba ya meza (hiari)")}
            <Input value={table} onChange={e => setTable(e.target.value)} />
          </label>
        </div>
        <div className="space-y-3">
          {lines.map((line, index) => <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_110px_auto]">
            <select className="h-10 min-w-0 rounded-md border bg-background px-3"
              value={line.productId}
              onChange={e => setLines(old => old.map((x, i) => i === index ? { ...x, productId: e.target.value } : x))}>
              <option value="">{tr("-- Chagua bidhaa --")}</option>
              {(products ?? []).map(product => <option key={product._id} value={product._id}>
                {product.name} — {Number(product.sellingPrice).toLocaleString()}
              </option>)}
            </select>
            <Input aria-label={tr("Kiasi")} type="number" min="0.001" step="any" value={line.qty}
              onChange={e => setLines(old => old.map((x, i) => i === index ? { ...x, qty: e.target.value } : x))} />
            <Button variant="outline" disabled={lines.length === 1}
              onClick={() => setLines(old => old.filter((_, i) => i !== index))}>{tr("Ondoa")}</Button>
          </div>)}
        </div>
        <Button variant="outline" onClick={() => setLines(old => [...old, { productId: "", qty: "1" }])}>
          {tr("Ongeza bidhaa")}
        </Button>
        <label className="grid gap-1 text-sm">{tr("Maelezo (hiari)")}
          <Input value={notes} onChange={e => setNotes(e.target.value)} />
        </label>
        <p className="text-lg font-bold">{tr("Jumla")}: {total.toLocaleString()}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void place()}>{busy ? tr("Inaweka...") : tr("Weka Order")}</Button>
        </div>
      </section>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{cashier ? tr("Foleni ya cashier") : tr("Oda nilizotuma")}</h2>
        {(orders ?? []).map((order) => <article key={order._id} className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{order.customerName} {order.tableNumber ? `· ${tr("Meza")} ${order.tableNumber}` : ""}</h3>
              <p className="text-sm text-muted-foreground">{tr("Waiter")}: {order.waiterName} · {new Date(order.createdAt).toLocaleString()}</p>
              <p className="text-sm">{tr("Hali")}: {order.status === "placed" ? tr("Imewekwa (haijatumwa)") : order.status === "pending" ? tr("Inasubiri cashier") : tr("Imepokelewa")}</p>
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
            {!cashier && order.status === "placed" && <Button onClick={() => void send(order._id)}>{tr("Send")}</Button>}
            {/* Cashier Print = receive + print: the waiter is notified that the order was received. Waiter Print only prints. */}
            {cashier
              ? (order.status === "pending" || order.status === "accepted") && <Button onClick={() => void receiveAndPrint(order)}>{tr("Print")}</Button>
              : <Button variant="outline" onClick={() => void printPlaced(order)}>{tr("Print")}</Button>}
          </div>
        </article>)}
        {orders && orders.length === 0 && <p className="rounded-xl border p-5 text-sm text-muted-foreground">{tr("Hakuna oda bado.")}</p>}
      </section>
    </div>
  );
}
