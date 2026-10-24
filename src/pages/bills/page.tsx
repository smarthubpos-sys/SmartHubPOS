import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { MessageCircle, Printer, Receipt, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, PageHeader, Panel, Pill, SelectBox, Stat, Table } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { formatDate } from "@/lib/format.ts";
import { tr, errorText } from "@/lib/i18n.ts";
import { toast } from "sonner";
import BillSheet from "@/components/BillSheet.tsx";

/**
 * Bills = customer bills built from Sales invoices.
 * The cashier picks a customer, ticks the invoices (1, 2, 3 ...) and prints ONE bill for the ticked ones.
 * Running costs (rent, electricity, water ...) are recorded in Accounts > Expense Payments instead.
 */
export default function BillsPage() {
  const clients = useQuery(api.clients.list, {});
  const { money } = useMoney();
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showBill, setShowBill] = useState(false);
  const [billInvoiceIds, setBillInvoiceIds] = useState<Id<"invoices">[]>([]);
  const [creatingBill, setCreatingBill] = useState(false);
  const access = useQuery(api.customerBills.access);
  const createBill = useMutation(api.customerBills.create);
  const [allDepts, setAllDepts] = useState(true);
  const [deptFilter, setDeptFilter] = useState("");
  const combine = !!access?.allDepartments && allDepts; // permission "bills.all_departments"
  const [printToken, setPrintToken] = useState(0);
  const [paper, setPaper] = useState<"80mm" | "58mm" | "A4">(() => { const saved = localStorage.getItem("smarthub-print-paper"); return saved === "58mm" || saved === "A4" ? saved : "80mm"; });
  const [whatsappEnabled, setWhatsappEnabled] = useState(() => localStorage.getItem("smarthub-bill-whatsapp-enabled") !== "false");

  const invoices = useQuery(api.customerBills.invoicesForClient, clientId ? { clientId: clientId as Id<"clients">, onlyOpen, allDepartments: combine } : "skip");
  const history = useQuery(api.customerBills.historyForClient, clientId ? { clientId: clientId as Id<"clients"> } : "skip");
  const needle = search.trim().toLowerCase();
  const visibleClients = useMemo(
    () => (clients ?? []).filter((c) => c.isActive && (!needle || c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle))).slice(0, 200),
    [clients, needle],
  );

  const list = (invoices ?? []).filter((i) => !combine || !deptFilter || i.department === deptFilter);
  const eligible = list.filter((i) => i.eligible);
  const chosen = eligible.filter((i) => picked.has(String(i._id)));
  const sum = (k: "total" | "amountPaid" | "outstanding") => chosen.reduce((n, i) => n + i[k], 0);
  const pill = (s: string) => s === "paid" ? <Pill tone="green">{tr("Imelipwa")}</Pill> : s === "partial" ? <Pill tone="amber">{tr("Imelipwa kiasi")}</Pill> : <Pill tone="blue">{tr("Haijalipwa")}</Pill>;

  const resetSelection = () => { setPicked(new Set()); setShowBill(false); setBillInvoiceIds([]); };
  const toggle = (id: string) => {
    if (list.some((i) => String(i._id) === id && !i.eligible)) return;
    setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const allPicked = eligible.length > 0 && chosen.length === eligible.length;
  async function startBill(shouldPrint: boolean) {
    if (creatingBill || chosen.length === 0) return;
    const ids = chosen.map((i) => i._id);
    setCreatingBill(true);
    try {
      await createBill({ invoiceIds: ids });
      setBillInvoiceIds(ids);
      setPicked(new Set());
      setShowBill(true);
      if (shouldPrint) setPrintToken((n) => n + 1);
      toast.success(tr("Invoice zimehifadhiwa kwenye bili."));
    } catch (error) {
      toast.error(errorText(error, tr("Imeshindikana kuunda bili. Hakuna invoice iliyowekwa kwenye bili.")));
    } finally {
      setCreatingBill(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="print:hidden space-y-4">
        <PageHeader icon={Receipt} title={tr("Bills")} subtitle={tr("Bili za wateja: chagua mteja, weka alama kwenye invoice unazotaka, kisha chapisha bili.")} />

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
          <Stat label={tr("Invoice zilizochaguliwa")} value={`${chosen.length} / ${eligible.length}`} icon={Receipt} tone="violet" />
          <Stat label={tr("Jumla ya bili")} value={money(sum("total"))} icon={Wallet} tone="blue" />
          <Stat label={tr("Deni la bili")} value={money(sum("outstanding"))} icon={Wallet} tone="amber" />
        </div>

        <Panel>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label={tr("Tafuta mteja")}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Jina au msimbo wa mteja")} /></FormField>
            <FormField label={tr("Mteja")}>
              <SelectBox value={clientId} onChange={(e) => { setClientId(e.target.value); resetSelection(); }}>
                <option value="">{tr("-- Chagua --")}</option>
                {visibleClients.map((c) => <option key={c._id} value={c._id}>{c.name} ({c.code})</option>)}
              </SelectBox>
            </FormField>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyOpen} onChange={(e) => { setOnlyOpen(e.target.checked); resetSelection(); }} />{tr("Zenye deni tu")}</label>
            {access?.allDepartments && (
              <>
                <label className="flex items-end gap-2 pb-2 text-sm md:col-span-2"><input type="checkbox" checked={allDepts} onChange={(e) => { setAllDepts(e.target.checked); setDeptFilter(""); resetSelection(); }} />{tr("Unganisha invoice za idara zote (Jikoni, Bar, Lounge…)")}</label>
                {combine && (
                  <FormField label={tr("Idara")}>
                    <SelectBox value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); resetSelection(); }}>
                      <option value="">{tr("Idara zote")}</option>
                      {access.departments.map((d) => <option key={d._id} value={d.name}>{d.name}</option>)}
                    </SelectBox>
                  </FormField>
                )}
              </>
            )}
          </div>
        </Panel>

        <Panel
          title={tr("Invoice za mteja")}
          actions={clientId && list.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { setPicked(allPicked ? new Set() : new Set(eligible.map((i) => String(i._id)))); setShowBill(false); setBillInvoiceIds([]); }}>{allPicked ? tr("Ondoa zote") : tr("Chagua zote")}</Button>
              <Button size="sm" variant="outline" disabled={chosen.length === 0 || creatingBill} onClick={() => void startBill(false)}>{tr("Send")}</Button>
              <label className="flex items-center gap-1 text-xs">{tr("Printer")}<select className="h-8 rounded-md border bg-background px-2" value={paper} onChange={(e) => { const v = e.target.value as "80mm" | "58mm" | "A4"; setPaper(v); localStorage.setItem("smarthub-print-paper", v); }}><option value="80mm">80mm</option><option value="58mm">58mm</option><option value="A4">A4</option></select></label>
              <Button size="sm" disabled={chosen.length === 0 || creatingBill} onClick={() => void startBill(true)}><Printer className="mr-1 h-4 w-4" />{creatingBill ? tr("Inahifadhi...") : tr("Print")}</Button>
            </div>
          ) : undefined}
        >
          {!clientId ? <Empty>{tr("Chagua mteja ili kuona invoice zake.")}</Empty>
            : invoices === undefined ? <Empty>{tr("Inapakia…")}</Empty>
            : list.length === 0 ? <Empty>{tr("Mteja huyu hana invoice.")}</Empty>
            : (
              <Table head={["", tr("Invoice"), ...(combine ? [tr("Idara")] : []), tr("Tarehe"), tr("Jumla"), tr("Imelipwa"), tr("Deni"), tr("Hali")]}>
                {list.map((i) => (
                  <tr key={i._id} className={!i.eligible ? "opacity-70" : "cursor-pointer"} onClick={() => { if (i.eligible) { toggle(String(i._id)); setShowBill(false); setBillInvoiceIds([]); } }}>
                    <td className="w-8"><input type="checkbox" aria-label={i.invoiceNo} checked={picked.has(String(i._id))} disabled={!i.eligible} onChange={() => { toggle(String(i._id)); setShowBill(false); setBillInvoiceIds([]); }} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="whitespace-nowrap font-medium">{i.invoiceNo}</td>
                    {combine && <td className="whitespace-nowrap">{i.department}</td>}
                    <td className="whitespace-nowrap">{formatDate(i.date)}</td>
                    <td className="whitespace-nowrap">{money(i.total)}</td>
                    <td className="whitespace-nowrap">{money(i.amountPaid)}</td>
                    <td className="whitespace-nowrap">{money(i.outstanding)}</td>
                    <td>{i.status === "cancelled" ? <Pill tone="rose">{tr("Imebatilishwa")}</Pill> : i.alreadyBilled ? <Pill tone="amber">{tr("Tayari kwenye bili")}</Pill> : pill(i.paymentStatus)}</td>
                  </tr>
                ))}
              </Table>
            )}
        </Panel>
      </div>

      {clientId && history && history.length > 0 && <Panel title={tr("Bili zilizopita")}>
        <div className="space-y-2">
          {history.map((bill) => <div key={bill._id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <div>
              <p className="font-medium">{bill.invoiceNos.join(", ")}</p>
              <p className="text-muted-foreground">{formatDate(bill.createdAt.slice(0, 10))} · {bill.status === "issued" ? tr("Imeundwa") : tr("Imebatilishwa")}</p>
              {!bill.printable && <p className="text-xs text-muted-foreground">{tr("Bili hii ina invoice iliyobatilishwa au haiwezi kuchapishwa tena.")}</p>}
            </div>
            <Button size="sm" variant="outline" disabled={!bill.printable} onClick={() => { setBillInvoiceIds(bill.invoiceIds); setShowBill(true); setPicked(new Set()); }}>{tr("Fungua bili")}</Button>
          </div>)}
        </div>
      </Panel>}

      {showBill && billInvoiceIds.length > 0 && <BillSheet invoiceIds={billInvoiceIds} printToken={printToken} paper={paper} whatsappEnabled={whatsappEnabled} setWhatsappEnabled={(value) => { setWhatsappEnabled(value); localStorage.setItem("smarthub-bill-whatsapp-enabled", String(value)); }} />}
    </div>
  );
}
