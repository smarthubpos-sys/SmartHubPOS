import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tr } from "@/lib/i18n.ts";
import { printWaiterOrder } from "@/lib/print-waiter-order.ts";

const money = (n: number) => Number(n).toLocaleString();
const STATUS: Record<string, string> = { pending: "Inasubiri cashier", accepted: "Imepokelewa", printed: "Imechapishwa" };

/** Bills: orders grouped by table (orders without a table go under "Bila meza"); tick one or many, the total is recomputed on the server; print never touches stock or payments. */
export default function BillsPanel() {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const orders = useQuery(api.waiterOrders.listForBills, { table: search });
  const summary = useQuery(api.waiterOrders.billSummary, picked.length ? { orderIds: picked as Id<"waiterOrders">[] } : "skip");
  const user = useQuery(api.users.getCurrentUser);
  const settings = useQuery(api.maintenance.getSettings, {});
  const hw = (settings?.app?.hardware ?? {}) as { printerSource?: string; receiptPrinter?: string; paperWidth?: string };

  const groups = new Map<string, NonNullable<typeof orders>>();
  for (const o of orders ?? []) { const k = o.tableNumber?.trim() || ""; groups.set(k, [...(groups.get(k) ?? []), o]); }
  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  async function printBill() {
    if (!summary) return;
    const ok = await printWaiterOrder({ customerName: "", waiterName: user?.name ?? user?.username ?? "", tableNumber: summary.tables.join(", ") || undefined, total: summary.total, lines: summary.lines.map((l) => ({ productName: l.productName, qty: l.qty, lineTotal: l.lineTotal })) }, hw.printerSource === "installed" ? hw.receiptPrinter : undefined, hw.paperWidth);
    if (ok) toast.success(tr("Bili imechapishwa. Hakuna mauzo, malipo wala stock vilivyobadilika."));
  }

  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <h2 className="text-lg font-semibold">{tr("Bills")}</h2>
      <Input placeholder={tr("Tafuta kwa namba ya meza au jina")} value={search} onChange={(e) => setSearch(e.target.value)} />
      {[...groups.entries()].map(([table, rows]) => (
        <div key={table || "none"} className="space-y-1 rounded-xl border p-2">
          <div className="flex items-center justify-between text-sm font-semibold"><span>{table ? `${tr("Meza")} ${table}` : tr("Bila meza")}</span>
            <button type="button" className="text-xs underline" onClick={() => setPicked((p) => [...new Set([...p, ...rows.map((r) => String(r._id))])])}>{tr("Chagua zote")}</button></div>
          {rows.map((o) => (
            <label key={o._id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted">
              <input type="checkbox" className="h-5 w-5" checked={picked.includes(String(o._id))} onChange={() => toggle(String(o._id))} />
              <span className="flex-1 text-sm">{new Date(o.createdAt).toLocaleTimeString()} · {o.lines.map((l) => `${l.productName}×${l.qty}`).join(", ")}<span className="block text-xs text-muted-foreground">{tr(STATUS[o.status] ?? o.status)}</span></span>
              <strong className="tabular-nums">{money(o.total)}</strong>
            </label>
          ))}
        </div>
      ))}
      {orders && orders.length === 0 && <p className="text-sm text-muted-foreground">{tr("Hakuna bili bado.")}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-lg font-bold">{tr("Jumla ya zilizochaguliwa")} ({picked.length}): {money(summary?.total ?? 0)}</span>
        <div className="flex gap-2"><Button variant="outline" disabled={!picked.length} onClick={() => setPicked([])}>{tr("Futa uchaguzi")}</Button>
          <Button disabled={!picked.length || !summary} onClick={() => void printBill()}>{tr("Chapisha bili")}</Button></div>
      </div>
    </section>
  );
}
