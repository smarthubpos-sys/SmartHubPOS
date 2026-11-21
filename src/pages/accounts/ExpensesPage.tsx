import { useSubmit } from "@/components/use-submit.ts";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, Plus, Receipt, Wallet, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { useNavigate } from "react-router-dom";
import { FileBarChart } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, PageHeader, Panel, Pill, SelectBox, Stat, Table } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { formatDate, localDate } from "@/lib/format.ts";
import { methodArgs, pickMethodKey, usePaymentMethods } from "@/hooks/use-payment-methods.ts";
import { tr } from "@/lib/i18n.ts";

const catLabel = (c: string) => ({ rent: tr("Kodi ya pango"), electricity: tr("Umeme"), water: tr("Maji"), internet: tr("Intaneti / simu"), tax: tr("Kodi na leseni"), transport: tr("Usafiri"), other: tr("Nyingine") } as Record<string, string>)[c] ?? c;
const methodLabel = (m: string) => ({ cash: tr("Fedha taslimu"), bank: tr("Benki"), mobile: tr("Pesa za simu") } as Record<string, string>)[m] ?? m;

export default function ExpensesPage() {
  const bills = useQuery(api.bills.list);
  const create = useMutation(api.bills.create);
  const pay = useMutation(api.bills.pay);
  const unpay = useMutation(api.bills.unpayBill);
  const approve = useMutation(api.bills.approve);
  const rights = useQuery(api.bills.rights); // who may approve: a manager, or a person given "accounts.approve"
  const voidBill = useMutation(api.bills.voidBill);
  const update = useMutation(api.bills.update);
  const addExpenseAccount = useMutation(api.bills.addExpenseAccount);
  const expenseAccounts = useQuery(api.bills.expenseAccounts); // the expense accounts of this business's Chart of Accounts
  const { money } = useMoney();
  const methods = usePaymentMethods();
  const { busy, run } = useSubmit();
  const navigate = useNavigate();
  const [dayDone, setDayDone] = useState(false); // "I finished entering today's expenses" -> offers the day report
  const today = localDate();
  const [filter, setFilter] = useState<"open" | "overdue" | "paid" | "all">("open");
  const [showForm, setShowForm] = useState(false);
  const [payFor, setPayFor] = useState<Id<"bills"> | null>(null);
  const [editId, setEditId] = useState<Id<"bills"> | null>(null); // set while a saved bill is being edited
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const blank = { vendor: "", category: "", accountId: "", billNumber: "", billDate: today, dueDate: localDate(14), amount: "", notes: "" };
  const [f, setF] = useState(blank);
  const [p, setP] = useState({ amount: "", method: "cash", date: today, reference: "" });
  const payments = useQuery(api.bills.payments, payFor ? { billId: payFor } : "skip");

  const list = useMemo(() => bills ?? [], [bills]);
  const status = (b: (typeof list)[number]) => b.status === "void" ? "void" : b.status === "paid" ? "paid" : b.approvedAt ? "approved" : b.dueDate < today ? "overdue" : b.status;
  const open = list.filter((b) => ["unpaid", "partial"].includes(b.status));
  const owed = open.reduce((s, b) => s + b.amount - b.paidAmount, 0);
  const overdue = open.filter((b) => b.dueDate < today);
  const soon = open.filter((b) => b.dueDate >= today && b.dueDate <= localDate(7));
  const paidThisMonth = list.reduce((s, b) => s + (b.status === "void" ? 0 : b.paidAmount), 0);
  const shown = useMemo(() => list.filter((b) => filter === "all" ? true : filter === "open" ? ["unpaid", "partial"].includes(b.status) : filter === "overdue" ? ["unpaid", "partial"].includes(b.status) && b.dueDate < today : b.status === "paid"), [list, filter, today]);
  const current = list.find((b) => b._id === payFor);

  const pill = (s: string) => s === "paid" ? <Pill tone="green">{tr("Imelipwa")}</Pill> : s === "overdue" ? <Pill tone="rose">{tr("Imechelewa")}</Pill> : s === "partial" ? <Pill tone="amber">{tr("Imelipwa kiasi")}</Pill> : s === "void" ? <Pill>{tr("Imebatilishwa")}</Pill> : s === "approved" ? <Pill tone="green">{tr("Imeidhinishwa")}</Pill> : <Pill tone="blue">{tr("Haijalipwa")}</Pill>;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader icon={Receipt} title={tr("Matumizi ya kawaida (Expenses)")} subtitle={tr("Matumizi ya biashara: pango, umeme, maji, kodi na nyinginezo. Malipo yanaingia kwenye hesabu kiotomatiki.")}
        actions={<Button onClick={() => { setEditId(null); setF(blank); setShowForm((v) => !v); }}><Plus className="mr-1 h-4 w-4" />{tr("Matumizi mapya")}</Button>} />

      <Panel title={tr("Maliza siku")}>
        <div className="flex flex-wrap items-center gap-3">
          <Switch id="day-done" checked={dayDone} onCheckedChange={setDayDone} />
          <label htmlFor="day-done" className="cursor-pointer text-sm font-medium">{tr("Nimemaliza kuingiza matumizi ya siku")}</label>
          {dayDone && <Button onClick={() => navigate(`/accounts/period-report?period=day&date=${today}&auto=1`)}><FileBarChart className="mr-1 h-4 w-4" />{tr("Unda ripoti ya siku")}</Button>}
          <Button variant="outline" onClick={() => navigate("/accounts/period-report")}>{tr("Ripoti ya mwezi / mwaka")}</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{tr("Washa kitufe hiki ukimaliza kuingiza matumizi ya leo, kisha bonyeza kuunda ripoti ya siku (mauzo, marejesho, matumizi na faida). Unaweza pia kuchagua mwezi au mwaka, na idara moja au zote.")}</p>
      </Panel>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat label={tr("Deni la bili")} value={money(owed)} icon={Wallet} tone="amber" />
        <Stat label={tr("Zilizochelewa")} value={`${overdue.length} · ${money(overdue.reduce((s, b) => s + b.amount - b.paidAmount, 0))}`} icon={AlertTriangle} tone="rose" />
        <Stat label={tr("Zinazokaribia (siku 7)")} value={soon.length} icon={Receipt} tone="violet" />
        <Stat label={tr("Jumla iliyolipwa")} value={money(paidThisMonth)} icon={CheckCircle2} tone="green" />
      </div>

      {showForm && (
        <Panel title={editId ? tr("Hariri bili") : tr("Matumizi mapya")}>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label={tr("Mtoa huduma / anayedai")}><Input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></FormField>
            <FormField label={tr("Aina ya bili (account ya matumizi)")}>
              <SelectBox value={f.accountId || (f.category ? "__legacy__" : "")} onChange={(e) => { if (e.target.value === "__new__") setAddingCat(true); else if (e.target.value !== "__legacy__") setF({ ...f, accountId: e.target.value }); }}>
                <option value="">{tr("Chagua account ya matumizi...")}</option>
                {(expenseAccounts ?? []).map((a) => <option key={a._id} value={a._id}>{a.code} · {a.name}</option>)}
                {!f.accountId && f.category && <option value="__legacy__">{catLabel(f.category)}</option>}
                <option value="__new__">{tr("＋ Ongeza account mpya ya matumizi...")}</option>
              </SelectBox>
              {expenseAccounts && expenseAccounts.length === 0 && <p className="mt-1 text-xs text-muted-foreground">{tr("Hakuna account ya matumizi kwenye Chart of Accounts. Ongeza kwa \"＋\" au kwenye Chart of Accounts.")}</p>}
              {addingCat && (
                <div className="mt-2 flex gap-2">
                  <Input autoFocus placeholder={tr("Mf. Mishahara, Matangazo")} value={newCat} onChange={(e) => setNewCat(e.target.value)} />
                  <Button size="sm" disabled={busy || newCat.trim().length < 2} onClick={async () => { const res = await run(() => addExpenseAccount({ name: newCat }), tr("Account ya matumizi imeongezwa kwenye Chart of Accounts.")); if (res) { setF({ ...f, accountId: String(res.accountId) }); setNewCat(""); setAddingCat(false); } }}>{tr("Ongeza")}</Button>
                  <Button size="sm" variant="outline" onClick={() => { setNewCat(""); setAddingCat(false); }}>{tr("Cancel")}</Button>
                </div>
              )}
            </FormField>
            <FormField label={tr("Namba ya bili (hiari)")}><Input value={f.billNumber} onChange={(e) => setF({ ...f, billNumber: e.target.value })} /></FormField>
            <FormField label={tr("Tarehe ya bili")}><Input type="date" value={f.billDate} onChange={(e) => setF({ ...f, billDate: e.target.value })} /></FormField>
            <FormField label={tr("Tarehe ya mwisho kulipa")}><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></FormField>
            <FormField label={tr("Kiasi")}><Input type="number" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></FormField>
            <FormField label={tr("Maelezo (hiari)")} className="md:col-span-3"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || !f.vendor.trim() || !f.amount || (!f.accountId && !(editId && f.category))} onClick={async () => { const body = { vendor: f.vendor, category: f.category || "other", expenseAccountId: f.accountId ? (f.accountId as Id<"accounts">) : undefined, billNumber: f.billNumber || undefined, billDate: f.billDate, dueDate: f.dueDate, amount: Number(f.amount), notes: f.notes || undefined }; const ok = await run(() => editId ? update({ billId: editId, ...body }) : create(body)); if (ok) { setF(blank); setEditId(null); setShowForm(false); } }}>{editId ? tr("Hifadhi mabadiliko") : tr("Hifadhi bili")}</Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); setF(blank); }}>{tr("Cancel")}</Button>
          </div>
        </Panel>
      )}

      {current && (
        <Panel title={`${tr("Lipa bili")} ${current.billNumber} — ${current.vendor}`} actions={<button className="cursor-pointer rounded-md p-1 hover:bg-muted" onClick={() => setPayFor(null)} aria-label={tr("Funga")}><X className="h-4 w-4" /></button>}>
          <p className="mb-3 text-sm text-muted-foreground">{tr("Deni lililobaki: {0}", [money(current.amount - current.paidAmount)])}</p>
          <div className="grid gap-3 md:grid-cols-4">
            <FormField label={tr("Kiasi")}><Input type="number" min="0" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></FormField>
            <FormField label={tr("Njia ya malipo")}><SelectBox value={pickMethodKey(methods, p.method)} onChange={(e) => setP({ ...p, method: e.target.value })}>{methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</SelectBox></FormField>
            <FormField label={tr("Tarehe")}><Input type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} /></FormField>
            <FormField label={tr("Namba ya rejea (hiari)")}><Input value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} /></FormField>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy || !p.amount} onClick={async () => { const ok = await run(() => pay({ billId: current._id, amount: Number(p.amount), ...methodArgs(methods, pickMethodKey(methods, p.method)), paymentDate: p.date, reference: p.reference || undefined }), tr("Malipo yamehifadhiwa.")); if (ok) { setP({ ...p, amount: "", reference: "" }); if (Number(p.amount) >= current.amount - current.paidAmount) setPayFor(null); } }}>{tr("Hifadhi Malipo")}</Button>
            <Button variant="outline" onClick={() => setP({ ...p, amount: String(current.amount - current.paidAmount) })}>{tr("Lipa deni lote")}</Button>
          </div>
          {payments && payments.length > 0 && <div className="mt-4"><Table head={[tr("Tarehe"), tr("Kiasi"), tr("Njia ya malipo"), tr("Namba ya rejea"), ""]}>{payments.map((x) => <tr key={x._id} className={x.voided ? "text-muted-foreground line-through" : ""}><td>{formatDate(x.paymentDate)}</td><td>{money(x.amount)}</td><td>{methodLabel(x.method)}</td><td>{x.reference}</td><td className="text-right no-underline">{x.voided ? <span className="text-xs">{tr("Imerudishwa")}</span> : <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm(tr("Rudisha malipo ya {0}? Fedha itarudi kwenye njia ya malipo na bili itadaiwa tena.", [money(x.amount)]))) void run(() => unpay({ paymentId: x._id }), tr("Malipo yamerudishwa.")); }}>{tr("Rudisha (Unpay)")}</Button>}</td></tr>)}</Table></div>}
        </Panel>
      )}

      <Panel>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {([["open", tr("Zinazodaiwa")], ["overdue", tr("Zilizochelewa")], ["paid", tr("Zilizolipwa")], ["all", tr("Zote")]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium ${filter === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>{label}</button>
          ))}
        </div>
        {shown.length === 0 ? <Empty>{tr("Hakuna bili kwenye orodha hii.")}</Empty> : (
          <Table head={[tr("Namba"), tr("Mtoa huduma"), tr("Aina ya bili"), tr("Tarehe ya mwisho"), tr("Kiasi"), tr("Imelipwa"), tr("Hali"), ""]}>
            {shown.map((b) => (
              <tr key={b._id}>
                <td className="whitespace-nowrap font-medium">{b.billNumber}</td><td>{b.vendor}</td><td>{catLabel(b.category)}</td>
                <td className="whitespace-nowrap">{formatDate(b.dueDate)}</td><td className="whitespace-nowrap">{money(b.amount)}</td><td className="whitespace-nowrap">{money(b.paidAmount)}</td>
                <td>{pill(status(b))}</td>
                <td className="whitespace-nowrap text-right">
                  {b.status !== "void" && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditId(b._id); setF({ vendor: b.vendor, category: b.category, accountId: b.expenseAccountId ? String(b.expenseAccountId) : "", billNumber: b.billNumber, billDate: b.billDate, dueDate: b.dueDate, amount: String(b.amount), notes: b.notes ?? "" }); setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{tr("Hariri")}</Button>}
                  {["unpaid", "partial"].includes(b.status) && !b.approvedAt && rights?.canApprove && <Button size="sm" disabled={busy} onClick={() => { if (window.confirm(tr("Idhinisha matumizi haya? Hali yake itakuwa Imeidhinishwa na itabaki kwenye orodha."))) void run(() => approve({ billId: b._id }), tr("Matumizi yameidhinishwa.")); }}>{tr("Idhinisha")}</Button>}
                  {b.status === "unpaid" && <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => { if (window.confirm(tr("Batilisha bili hii?"))) void run(() => voidBill({ billId: b._id }), tr("Bili imebatilishwa.")); }}>{tr("Batilisha")}</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
