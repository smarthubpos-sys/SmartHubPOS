import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { resolvePaper } from "@/lib/print-policy.ts";
import { MessageCircle, Printer, Receipt, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, PageHeader, Panel, Pill, SelectBox, Stat, Table } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { formatDate, localDate } from "@/lib/format.ts";
import { tr, errorText } from "@/lib/i18n.ts";
import { toast } from "sonner";
import BillSheet from "@/components/BillSheet.tsx";
import BillsPanel from "@/pages/waiter-orders/BillsPanel.tsx";
import ErrorBoundary from "@/components/error-boundary.tsx";

/**
 * Bills = customer bills built from Sales invoices.
 * The cashier picks a customer, ticks the invoices (1, 2, 3 ...) and prints ONE bill for the ticked ones.
 * Running costs (rent, electricity, water ...) are recorded in Accounts > Expense Payments instead.
 */
function BillsPageBody() {
  const clients = useQuery(api.clients.list, {});
  const { money } = useMoney();
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [billDate, setBillDate] = useState(() => localDate()); // without a customer, the date is all the cashier has to pick (empty = recent days)
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [showBilled, setShowBilled] = useState(false); // invoices already put on a bill leave the list; tick to see them again
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showBill, setShowBill] = useState(false);
  const [billInvoiceIds, setBillInvoiceIds] = useState<Id<"invoices">[]>([]);
  const [creatingBill, setCreatingBill] = useState(false);
  const access = useQuery(api.customerBills.access);
  const business = useQuery(api.tenants.current);
  const createBill = useMutation(api.customerBills.create);
  const [allDepts, setAllDepts] = useState(true);
  const [deptFilter, setDeptFilter] = useState("");
  const combine = !!access?.allDepartments && allDepts; // permission "bills.all_departments"
  const billSettings = useQuery(api.maintenance.getSettings, {});
  const [paperPick, setPaper] = useState<"80mm" | "58mm" | "A4" | null>(null); // a choice made on this screen only; otherwise the business setting
  const paper: "80mm" | "58mm" | "A4" = paperPick ?? resolvePaper((billSettings?.app?.hardware as { paperWidth?: string } | undefined)?.paperWidth);
  const [whatsappEnabled, setWhatsappEnabled] = useState(() => localStorage.getItem("smarthub-bill-whatsapp-enabled") !== "false");

  const invoices = useQuery(api.customerBills.invoicesForClient, clientId ? { clientId: clientId as Id<"clients">, onlyOpen, allDepartments: combine } : "skip");
  const recent = useQuery(api.customerBills.recentInvoices, clientId ? "skip" : { onlyOpen, allDepartments: combine, date: billDate || undefined }); // no customer chosen: newest invoices of the department(s)
  const history = useQuery(api.customerBills.historyForClient, clientId ? { clientId: clientId as Id<"clients"> } : "skip");
  const needle = search.trim().toLowerCase();
  const visibleClients = useMemo(
    () => (clients ?? []).filter((c) => c.isActive && (!needle || c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle))).slice(0, 200),
    [clients, needle],
  );

  type BillRow = NonNullable<typeof invoices>[number] & { clientId?: Id<"clients">; clientName?: string; customerKey?: string };
  const source = (clientId ? invoices : recent) as BillRow[] | undefined;
  const list = (source ?? []).filter((i) => (!combine || !deptFilter || i.department === deptFilter) && (showBilled || !i.alreadyBilled));
  // without a chosen customer a bill still belongs to ONE customer: once an invoice is ticked, other customers' invoices wait
  const pickedKey = !clientId ? list.find((i) => picked.has(String(i._id)))?.customerKey : undefined;
  const otherCustomer = (i: BillRow) => !clientId && !!pickedKey && i.customerKey !== pickedKey;
  const eligible = list.filter((i) => i.eligible && !otherCustomer(i));
  const chosen = eligible.filter((i) => picked.has(String(i._id)));
  const sum = (k: "total" | "amountPaid" | "outstanding") => chosen.reduce((n, i) => n + i[k], 0);
  const pill = (s: string) => s === "paid" ? <Pill tone="green">{tr("Imelipwa")}</Pill> : s === "partial" ? <Pill tone="amber">{tr("Imelipwa kiasi")}</Pill> : <Pill tone="blue">{tr("Haijalipwa")}</Pill>;

  // a click on the customer's name in the list opens all his invoices (his record in the user's own department)
  const chooseCustomer = (i: BillRow) => {
    const mine = (clients ?? []).find((c) => String(c._id) === String(i.clientId)) ?? (clients ?? []).find((c) => c.name.trim().toLowerCase().replace(/\s+/g, " ") === i.customerKey);
    if (!mine) { toast.info(tr("Mteja huyu hayuko kwenye idara yako; weka alama kwenye invoice zake hapa chini.")); return; }
    setClientId(String(mine._id)); resetSelection();
  };
  const resetSelection = () => { setPicked(new Set()); setShowBill(false); setBillInvoiceIds([]); };
  const toggle = (id: string) => {
    if (list.some((i) => String(i._id) === id && (!i.eligible || otherCustomer(i)))) return;
    setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const allPicked = eligible.length > 0 && chosen.length === eligible.length;
  async function startBill() {
    if (creatingBill || chosen.length === 0) return;
    const ids = chosen.map((i) => i._id);
    setCreatingBill(true);
    try {
      await createBill({ invoiceIds: ids });
      setBillInvoiceIds(ids);
      setPicked(new Set());
      setShowBill(true);
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
        <PageHeader icon={Receipt} title={tr("Bills")} subtitle={tr("Bili za wateja: invoice za hivi karibuni zinaonekana bila kuchagua mteja; weka alama kwenye invoice unazotaka, kisha chapisha bili.")} />

        {business && (business.waiterOrdersEnabled !== false || business.waiterEnabled === true || business.waitressEnabled === true) && <ErrorBoundary inline><BillsPanel /></ErrorBoundary>}

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
          <Stat label={tr("Invoice zilizochaguliwa")} value={`${chosen.length} / ${eligible.length}`} icon={Receipt} tone="violet" />
          <Stat label={tr("Jumla ya bili")} value={money(sum("total"))} icon={Wallet} tone="blue" />
          <Stat label={tr("Deni la bili")} value={money(sum("outstanding"))} icon={Wallet} tone="amber" />
        </div>

        <Panel>
          <div className="grid gap-3 md:grid-cols-3">
            {!clientId && (
              <FormField label={tr("Tarehe")}>
                <div className="flex items-center gap-2">
                  <Input type="date" value={billDate} onChange={(e) => { setBillDate(e.target.value); resetSelection(); }} />
                  {billDate && <Button type="button" size="sm" variant="outline" onClick={() => { setBillDate(""); resetSelection(); }}>{tr("Siku zote")}</Button>}
                </div>
              </FormField>
            )}
            <FormField label={tr("Tafuta mteja")}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Jina au msimbo wa mteja")} /></FormField>
            <FormField label={tr("Mteja")}>
              <SelectBox value={clientId} onChange={(e) => { setClientId(e.target.value); resetSelection(); }}>
                <option value="">{tr("-- Chagua --")}</option>
                {visibleClients.map((c) => <option key={c._id} value={c._id}>{c.name} ({c.code})</option>)}
              </SelectBox>
            </FormField>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyOpen} onChange={(e) => { setOnlyOpen(e.target.checked); resetSelection(); }} />{tr("Zenye deni tu")}</label>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={showBilled} onChange={(e) => { setShowBilled(e.target.checked); resetSelection(); }} />{tr("Onyesha invoice zilizokwisha kwenye bili")}</label>
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
          {!clientId && <p className="mt-2 text-xs text-muted-foreground">{tr("Huhitaji kuchagua mteja: chagua tarehe tu (na idara zote kama inahitajika). Bili moja ni ya mteja mmoja: ukiweka alama kwenye invoice ya mteja, za wateja wengine zinasubiri.")}</p>}
        </Panel>

        <Panel
          title={clientId ? tr("Invoice za mteja") : billDate ? `${tr("Invoice za tarehe")} ${formatDate(billDate)}` : tr("Invoice za hivi karibuni")}
          actions={list.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {clientId && <Button size="sm" variant="outline" onClick={() => { setPicked(allPicked ? new Set() : new Set(eligible.map((i) => String(i._id)))); setShowBill(false); setBillInvoiceIds([]); }}>{allPicked ? tr("Ondoa zote") : tr("Chagua zote")}</Button>}
              <Button size="sm" variant="outline" disabled={chosen.length === 0 || creatingBill} onClick={() => void startBill()}>{tr("Send")}</Button>
              <label className="flex items-center gap-1 text-xs">{tr("Printer")}<select className="h-8 rounded-md border bg-background px-2" value={paper} onChange={(e) => { const v = e.target.value as "80mm" | "58mm" | "A4"; setPaper(v); }}><option value="80mm">80mm</option><option value="58mm">58mm</option><option value="A4">A4</option></select></label>
              <Button size="sm" disabled={chosen.length === 0 || creatingBill} onClick={() => void startBill()}><Printer className="mr-1 h-4 w-4" />{creatingBill ? tr("Inahifadhi...") : tr("Print")}</Button>
            </div>
          ) : undefined}
        >
          {source === undefined ? <Empty>{tr("Inapakia…")}</Empty>
            : list.length === 0 ? <Empty>{clientId ? tr("Mteja huyu hana invoice.") : billDate ? tr("Hakuna invoice za tarehe hii.") : tr("Hakuna invoice za hivi karibuni.")}</Empty>
            : (
              <Table head={["", tr("Invoice"), ...(!clientId ? [tr("Mteja")] : []), ...(combine ? [tr("Idara")] : []), tr("Tarehe"), tr("Jumla"), tr("Imelipwa"), tr("Deni"), tr("Hali")]}>
                {list.map((i) => (
                  <tr key={i._id} className={!i.eligible || otherCustomer(i) ? "opacity-50" : "cursor-pointer"} onClick={() => { if (i.eligible && !otherCustomer(i)) { toggle(String(i._id)); setShowBill(false); setBillInvoiceIds([]); } }}>
                    <td className="w-8"><input type="checkbox" aria-label={i.invoiceNo} checked={picked.has(String(i._id))} disabled={!i.eligible || otherCustomer(i)} onChange={() => { toggle(String(i._id)); setShowBill(false); setBillInvoiceIds([]); }} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="whitespace-nowrap font-medium">{i.invoiceNo}</td>
                    {!clientId && <td className="min-w-28 break-words"><button type="button" className="text-left underline decoration-dotted" title={tr("Chagua mteja huyu")} onClick={(e) => { e.stopPropagation(); chooseCustomer(i); }}>{i.clientName}</button></td>}
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

      {showBill && billInvoiceIds.length > 0 && <BillSheet invoiceIds={billInvoiceIds} paper={paper} onPrinted={() => { setShowBill(false); setBillInvoiceIds([]); setPicked(new Set()); toast.success(tr("Bili imechapishwa na kuondolewa kwenye orodha. Fungua tena kupitia \"Bili zilizopita\".")); }} whatsappEnabled={whatsappEnabled} setWhatsappEnabled={(value) => { setWhatsappEnabled(value); localStorage.setItem("smarthub-bill-whatsapp-enabled", String(value)); }} />}
    </div>
  );
}

/** The Super Admin can switch customer bills off for a business (Edit business > "Bili za wateja"). */
export default function BillsPage() {
  const business = useQuery(api.tenants.current);
  if (business?.customerBillsEnabled === false) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader icon={Receipt} title={tr("Bills")} subtitle={tr("Bili za wateja")} />
        <Panel><p className="py-6 text-center text-sm text-muted-foreground">{tr("Biashara hii imezuiwa kutengeneza bili za wateja. Wasiliana na Super Admin.")}</p></Panel>
      </div>
    );
  }
  return <BillsPageBody />;
}
