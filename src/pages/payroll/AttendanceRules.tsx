import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Scale } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useSubmit } from "@/components/use-submit.ts";
import { FormField, PageHeader, Panel, SelectBox } from "@/components/page-kit.tsx";
import { useMoney } from "@/hooks/use-money.ts";
import { tr } from "@/lib/i18n.ts";

/** How much is deducted when staff come late or do not come at all. */
export default function AttendanceRules() {
  const rule = useQuery(api.schedules.getRules);
  // The form starts from the saved rule, so it is only drawn once the rule has arrived.
  return rule ? <RulesForm rule={rule} /> : null;
}

function RulesForm({ rule }: { rule: { lateMode: string; lateAmount: number; graceMinutes: number; absentEnabled: boolean } }) {
  const navigate = useNavigate();
  const save = useMutation(api.schedules.saveRules);
  const { money } = useMoney();
  const { busy, run } = useSubmit();
  const [f, setF] = useState({ mode: rule.lateMode, amount: String(rule.lateAmount), grace: String(rule.graceMinutes), absent: rule.absentEnabled });

  const amount = Number(f.amount) || 0;
  const grace = Math.max(0, Math.floor(Number(f.grace) || 0));
  const exampleMinutes = grace + 1;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button variant="outline" onClick={() => navigate("/payroll")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Payroll")}</Button>
      <PageHeader icon={Scale} title={tr("Attendance Deductions")} subtitle={tr("Weka kiasi kinachokatwa mfanyakazi akichelewa au asipoingia kazini.")} />

      <Panel title={tr("Kuchelewa")}>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label={tr("Njia ya kukata")}>
            <SelectBox value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
              <option value="fixed">{tr("Kiasi kimoja kila akichelewa")}</option>
              <option value="per_minute">{tr("Kiasi kwa kila dakika ya kuchelewa")}</option>
            </SelectBox>
          </FormField>
          <FormField label={f.mode === "fixed" ? tr("Kiasi cha kukata") : tr("Kiasi kwa dakika")}><Input type="number" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></FormField>
          <FormField label={tr("Dakika za kuvumilia")} hint={tr("0 = hata dakika moja ya kuchelewa inakatwa.")}><Input type="number" min="0" max="120" value={f.grace} onChange={(e) => setF({ ...f, grace: e.target.value })} /></FormField>
        </div>
        <p className="mt-3 rounded-xl bg-muted p-3 text-sm">{tr("Mfano: anatakiwa kuingia 08:00. Akiingia 08:{0}, atakatwa {1}.", [String(exampleMinutes).padStart(2, "0"), money(f.mode === "per_minute" ? amount * exampleMinutes : amount)])}</p>
      </Panel>

      <Panel title={tr("Kutokuwepo kazini")}>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={f.absent} onChange={(e) => setF({ ...f, absent: e.target.checked })} />
          <span>{tr("Kata mshahara wa siku nzima mfanyakazi asipoingia kabisa siku aliyopangiwa kazi.")}</span>
        </label>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>{tr("Hakatwi akiwa na siku ya Off kwenye ratiba, sikukuu ya biashara, au ruhusa/likizo iliyoidhinishwa.")}</li>
          <li>{tr("Mshahara wa siku = mshahara wa kipindi ÷ idadi ya siku za kazi za kipindi hicho (kwa mshahara wa kila mwezi).")}</li>
          <li>{tr("Wanaolipwa kwa siku au kwa saa hawalipwi siku ambazo hawakufanya kazi, kwa hiyo hawakatwi mara ya pili.")}</li>
        </ul>
      </Panel>

      <Button disabled={busy} onClick={() => void run(() => save({ lateMode: f.mode === "per_minute" ? "per_minute" : "fixed", lateAmount: amount, graceMinutes: grace, absentEnabled: f.absent }), tr("Makato yamehifadhiwa."))}>{tr("Hifadhi")}</Button>
    </div>
  );
}
