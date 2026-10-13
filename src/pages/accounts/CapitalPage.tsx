import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Banknote, Landmark, PiggyBank } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Empty, FormField, PageHeader, Panel, Pill, SelectBox, Stat, Table, useSubmit } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { formatDate, localDate } from "@/lib/format.ts";
import { methodArgs, pickMethodKey, usePaymentMethods } from "@/hooks/use-payment-methods.ts";
import { tr } from "@/lib/i18n.ts";

const LOAN = ["bank_loan", "director_loan", "other_loan"];
const sourceLabel = (k: string) => ({
  owner_capital: tr("Mtaji wa mmiliki wa biashara"),
  director_capital: tr("Mtaji wa mkurugenzi"),
  shareholder: tr("Mtaji wa mwenyehisa"),
  grant: tr("Ruzuku / msaada"),
  other: tr("Chanzo kingine cha mtaji"),
  bank_loan: tr("Mkopo kutoka benki"),
  director_loan: tr("Mkopo kutoka kwa mkurugenzi"),
  other_loan: tr("Mkopo mwingine"),
} as Record<string, string>)[k] ?? k;
const nameLabel = (k: string) => k === "bank_loan" ? tr("Jina la benki") : k.startsWith("director") ? tr("Jina la mkurugenzi") : k === "shareholder" ? tr("Jina la mwenyehisa") : tr("Jina la aliyetoa / chanzo");
const methodLabel = (m: string) => ({ cash: tr("Fedha taslimu"), bank: tr("Benki"), mobile: tr("Pesa za simu") } as Record<string, string>)[m] ?? m;

export default function CapitalPage() {
  const navigate = useNavigate();
  const receipts = useQuery(api.capital.list);
  const receive = useMutation(api.capital.receive);
  const { money } = useMoney();
  const methods = usePaymentMethods();
  const { busy, run } = useSubmit();
  const blank = { date: localDate(), amount: "", sourceType: "owner_capital", sourceName: "", method: "bank", reference: "", interest: "", term: "", notes: "" };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank, v: string) => setF((p) => ({ ...p, [k]: v }));
  const isLoan = LOAN.includes(f.sourceType);

  const list = receipts ?? [];
  const equity = list.filter((r) => !LOAN.includes(r.sourceType)).reduce((s, r) => s + r.amount, 0);
  const loans = list.filter((r) => LOAN.includes(r.sourceType)).reduce((s, r) => s + r.amount, 0);

  async function submit() {
    const ok = await run(() => receive({
      receiptDate: f.date, amount: Number(f.amount), sourceType: f.sourceType, sourceName: f.sourceName, depositMethod: methodArgs(methods, pickMethodKey(methods, f.method, "bank")).method, depositMethodId: methodArgs(methods, pickMethodKey(methods, f.method, "bank")).methodId,
      reference: f.reference || undefined, notes: f.notes || undefined,
      interestRate: isLoan && f.interest ? Number(f.interest) : undefined, termMonths: isLoan && f.term ? Number(f.term) : undefined,
    }), tr("Mtaji umepokelewa na kuingizwa kwenye hesabu."));
    if (ok) setF({ ...blank, date: f.date });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Button variant="outline" onClick={() => navigate("/accounts")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Uhasibu")}</Button>
      <PageHeader icon={PiggyBank} title={tr("Mapokezi ya Mtaji")} subtitle={tr("Rekodi mtaji wa kuanzisha au kuongeza biashara, na uonyeshe umetoka wapi.")} />

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        <Stat label={tr("Jumla iliyopokelewa")} value={money(equity + loans)} icon={Banknote} tone="blue" />
        <Stat label={tr("Mtaji (Equity)")} value={money(equity)} icon={PiggyBank} tone="green" />
        <Stat label={tr("Mikopo (Deni)")} value={money(loans)} icon={Landmark} tone="amber" />
      </div>

      <Panel title={tr("Pokea mtaji mpya")}>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label={tr("Tarehe")}><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></FormField>
          <FormField label={tr("Kiasi")}><Input type="number" min="0" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></FormField>
          <FormField label={tr("Mtaji umetoka wapi?")}>
            <SelectBox value={f.sourceType} onChange={(e) => set("sourceType", e.target.value)}>
              <optgroup label={tr("Mtaji wa wamiliki")}>
                {["owner_capital", "director_capital", "shareholder", "grant", "other"].map((k) => <option key={k} value={k}>{sourceLabel(k)}</option>)}
              </optgroup>
              <optgroup label={tr("Mikopo")}>
                {LOAN.map((k) => <option key={k} value={k}>{sourceLabel(k)}</option>)}
              </optgroup>
            </SelectBox>
          </FormField>
          <FormField label={nameLabel(f.sourceType)}><Input value={f.sourceName} onChange={(e) => set("sourceName", e.target.value)} placeholder={f.sourceType === "bank_loan" ? "CRDB, NMB..." : ""} /></FormField>
          <FormField label={tr("Fedha zimeingia wapi?")}>
            <SelectBox value={pickMethodKey(methods, f.method, "bank")} onChange={(e) => set("method", e.target.value)}>{methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</SelectBox>
          </FormField>
          <FormField label={tr("Namba ya rejea (hiari)")}><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></FormField>
          {isLoan && <>
            <FormField label={tr("Riba kwa mwaka (%)")}><Input type="number" min="0" value={f.interest} onChange={(e) => set("interest", e.target.value)} /></FormField>
            <FormField label={tr("Muda wa kulipa (miezi)")}><Input type="number" min="0" value={f.term} onChange={(e) => set("term", e.target.value)} /></FormField>
          </>}
          <FormField label={tr("Maelezo (hiari)")} className={isLoan ? "" : "md:col-span-2"}><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></FormField>
        </div>
        <p className="mt-3 rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
          {isLoan ? tr("Mkopo unaingia kwenye hesabu kama Deni (Liability) la kulipwa baadaye.") : tr("Mtaji huu unaingia kwenye hesabu kama Mtaji (Equity) wa biashara.")}{" "}
          {tr("Fedha huongezeka kwenye akaunti uliyochagua na journal inatengenezwa kiotomatiki.")}
        </p>
        <div className="mt-3"><Button disabled={busy || !f.amount || !f.sourceName.trim()} onClick={() => void submit()}>{busy ? tr("Inahifadhi…") : tr("Pokea mtaji")}</Button></div>
      </Panel>

      <Panel title={tr("Historia ya mapokezi")}>
        {list.length === 0 ? <Empty>{tr("Bado hakuna mtaji uliorekodiwa.")}</Empty> : (
          <Table head={[tr("Tarehe"), tr("Chanzo"), tr("Kutoka kwa"), tr("Kiasi"), tr("Imeingia"), tr("Maelezo")]}>
            {list.map((r) => (
              <tr key={r._id}>
                <td className="whitespace-nowrap">{formatDate(r.receiptDate)}</td>
                <td><Pill tone={LOAN.includes(r.sourceType) ? "amber" : "green"}>{sourceLabel(r.sourceType)}</Pill></td>
                <td className="font-medium">{r.sourceName}</td>
                <td className="whitespace-nowrap font-semibold">{money(r.amount)}</td>
                <td>{methodLabel(r.depositMethod)}</td>
                <td className="text-xs text-muted-foreground">{[r.reference, r.interestRate ? `${r.interestRate}%` : "", r.termMonths ? tr("miezi {0}", [r.termMonths]) : "", r.notes].filter(Boolean).join(" · ")}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
