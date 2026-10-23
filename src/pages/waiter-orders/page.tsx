import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tr, errorText } from "@/lib/i18n.ts";

const waiterApi = (api as any).waiterOrders;

type Line = { productId: string; qty: string };

export default function WaiterOrdersPage() {
  const user = useQuery(api.users.getCurrentUser);
  const business = useQuery(api.tenants.current);
  const products = useQuery(api.products.listActive);
  const orders = useQuery(waiterApi.list);
  const sendOrder = useMutation(waiterApi.send);
  const markHandled = useMutation(waiterApi.markHandled);

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

  async function send() {
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
      await sendOrder({
        customerName: customer.trim(),
        tableNumber: table.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map(line => ({
          productId: line.productId as any,
          qty: Number(line.qty),
        })),
      });
      toast.success(tr("Oda imetumwa kwa cashier."));
      setCustomer("");
      setTable("");
      setNotes("");
      setLines([{ productId: "", qty: "1" }]);
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kutuma oda.")));
    } finally {
      setBusy(false);
    }
  }

  async function accept(orderId: string) {
    try {
      await markHandled({ orderId: orderId as any });
      toast.success(tr("Oda imepokelewa."));
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kupokea oda.")));
    }
  }

  function printOrder(order: any) {
    const content = [
      "SMARTHUB POS - ODA",
      `Mteja: ${order.customerName}`,
      `Meza: ${order.tableNumber || "-"}`,
      `Waiter: ${order.waiterName}`,
      "------------------------------",
      ...order.lines.map((line: any) =>
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
          {tr("Tuma oda kwa cashier bila kutengeneza invoice au kupunguza stock.")}
        </p>
      </header>

      {business?.waiterOrdersEnabled === true && !cashier && <section className="space-y-4 rounded-xl border p-4 sm:p-5">
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
          {business?.waiterOrderMode === "print" && <Button disabled={busy} onClick={() => {
            const fakeOrder = {
              customerName: customer || "-",
              tableNumber: table,
              waiterName: user?.name || user?.username || "Waiter",
              lines: lines.map(line => {
                const product = (products ?? []).find(p => p._id === line.productId);
                const qty = Number(line.qty) || 0;
                return { productName: product?.name || "-", qty, lineTotal: qty * (product?.sellingPrice ?? 0) };
              }),
              total,
              notes,
            };
            printOrder(fakeOrder);
          }}>{tr("Print")}</Button>}
          {business?.waiterOrderMode !== "print" && <Button disabled={busy} onClick={() => void send()}>{busy ? tr("Inatuma...") : tr("Send")}</Button>}
        </div>
      </section>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{cashier ? tr("Foleni ya cashier") : tr("Oda nilizotuma")}</h2>
        {(orders ?? []).map((order: any) => <article key={order._id} className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{order.customerName} {order.tableNumber ? `· ${tr("Meza")} ${order.tableNumber}` : ""}</h3>
              <p className="text-sm text-muted-foreground">{tr("Waiter")}: {order.waiterName} · {new Date(order.createdAt).toLocaleString()}</p>
              <p className="text-sm">{tr("Hali")}: {order.status === "pending" ? tr("Inasubiri cashier") : tr("Imepokelewa")}</p>
            </div>
            <strong>{Number(order.total).toLocaleString()}</strong>
          </div>
          <ul className="space-y-1 text-sm">
            {order.lines.map((line: any, i: number) => <li key={i}>
              {line.productName} × {line.qty} — {Number(line.lineTotal).toLocaleString()}
            </li>)}
          </ul>
          {order.notes && <p className="text-sm">{tr("Maelezo")}: {order.notes}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => printOrder(order)}>{tr("Print")}</Button>
            {cashier && order.status === "pending" && <Button onClick={() => void accept(order._id)}>{tr("Pokea oda")}</Button>}
          </div>
        </article>)}
        {orders && orders.length === 0 && <p className="rounded-xl border p-5 text-sm text-muted-foreground">{tr("Hakuna oda bado.")}</p>}
      </section>
    </div>
  );
}
