import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n.ts";
import type { PayMethod } from "@/hooks/use-payment-methods.ts";
import { fmt, n, newSplitLine, splitsTotal, type SplitLine } from "@/lib/payment-split.ts";

const selectClass = "h-10 w-full rounded-md border bg-background px-3";

type Props = { methods: PayMethod[]; lines: SplitLine[]; onChange: (lines: SplitLine[]) => void; due?: number; disabled?: boolean };

/** Lets one payment be shared over several methods (phone + bank + cash ...). `due` = amount still owed, used for the "remaining" hint. */
export default function PaymentSplit({ methods, lines, onChange, due, disabled }: Props) {
  const total = splitsTotal(lines);
  const remaining = due === undefined ? undefined : Math.round((due - total) * 100) / 100;
  const set = (i: number, patch: Partial<SplitLine>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2 md:col-span-2">
      <div className="text-sm font-medium">{tr("Njia za malipo")}</div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr] gap-2 rounded-md border p-2 md:grid-cols-[1.4fr_1fr_1fr_auto]">
          <select className={selectClass} disabled={disabled} value={l.methodKey} onChange={(e) => set(i, { methodKey: e.target.value })} aria-label={tr("Njia ya malipo")}>
            {methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <Input type="number" step="any" min="0" inputMode="decimal" placeholder={tr("Kiasi")} disabled={disabled} value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} />
          <Input placeholder={tr("Reference (hiari)")} disabled={disabled} value={l.reference} onChange={(e) => set(i, { reference: e.target.value })} />
          <div className="col-span-2 flex gap-2 md:col-span-1">
            {remaining !== undefined && remaining > 0 && <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => set(i, { amount: String(Math.round((n(l.amount) + remaining) * 100) / 100) })}>{tr("Jaza kilichobaki")}</Button>}
            <Button type="button" size="sm" variant="outline" disabled={disabled || lines.length === 1} onClick={() => onChange(lines.filter((_, k) => k !== i))}>{tr("Ondoa")}</Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled || lines.length >= 20} onClick={() => onChange([...lines, newSplitLine(methods)])}>{tr("＋ Ongeza njia ya malipo")}</Button>
        <div className="text-sm">
          <span className="text-muted-foreground">{tr("Jumla inayopokelewa")}: </span><b>{fmt(total)}</b>
          {remaining !== undefined && <span className={remaining < 0 ? "ml-3 text-destructive" : "ml-3 text-muted-foreground"}>{remaining < 0 ? tr("Imezidi deni kwa") : tr("Kilichobaki")}: <b>{fmt(Math.abs(remaining))}</b></span>}
        </div>
      </div>
    </div>
  );
}
