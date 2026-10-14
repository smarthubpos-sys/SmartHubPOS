import { useRun } from "./helpers.ts";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, Loading, PageShell, SelectField, TextField, Toggle } from "./_shared";
import { tr } from "@/lib/i18n.ts";

const KINDS: [string, string][] = [
  ["cash", tr("Cash (pesa taslimu)")], ["mobile", tr("Mobile Money / Lipa Namba")], ["bank", tr("Bank")],
  ["cheque", tr("Cheque")], ["card", tr("Card / POS")], ["other", tr("Nyingine")],
];
const blank = { id: "" as string, name: "", kind: "mobile", accountNo: "", accountName: "", isActive: true };

/** Maintenance → Njia za Malipo: the business adds as many Lipa Namba / banks as it really has and edits them any time. */
export default function PaymentMethodsPage() {
  const rows = useQuery(api.paymentMethods.list, {});
  const upsert = useMutation(api.paymentMethods.upsert);
  const remove = useMutation(api.paymentMethods.remove);
  const move = useMutation(api.paymentMethods.move);
  const seed = useMutation(api.paymentMethods.seedDefaults);
  const { busy, run } = useRun();
  const [f, setF] = useState(blank);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((p) => ({ ...p, [k]: v }));
  const seeded = useRef(false);
  // First visit: create Cash / Bank / Mobile Money so there is something to edit.
  useEffect(() => { if (rows && rows.length === 0 && !seeded.current) { seeded.current = true; void seed({}).catch(() => undefined); } }, [rows, seed]);

  const kindLabel = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k;
  return (
    <PageShell title={tr("Njia za Malipo")} subtitle={tr("Ongeza Lipa Namba, benki na njia nyingine za kupokea/kulipa pesa. Zinaonekana kwenye malipo ya wateja na suppliers.")}>
      <Card title={f.id ? tr("Hariri njia ya malipo") : tr("Ongeza njia ya malipo")}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={tr("Jina (litaonekana kwenye risiti)")} value={f.name} onChange={(v) => set("name", v)} placeholder={tr("mf. M-Pesa Duka, CRDB, NMB Biashara")} />
          <SelectField label={tr("Aina")} value={f.kind} onChange={(v) => set("kind", v)} options={KINDS} />
          <TextField label={tr("Lipa Namba / Namba ya akaunti")} value={f.accountNo} onChange={(v) => set("accountNo", v)} />
          <TextField label={tr("Jina la akaunti (hiari)")} value={f.accountName} onChange={(v) => set("accountName", v)} />
        </div>
        <Toggle label={tr("Inatumika")} hint={tr("Ukizima, haitaonekana kwenye fomu za malipo; historia haibadiliki.")} checked={f.isActive} onChange={(v) => set("isActive", v)} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run(async () => {
            await upsert({ id: f.id ? (f.id as Id<"paymentMethods">) : undefined, name: f.name, kind: f.kind, accountNo: f.accountNo, accountName: f.accountName, isActive: f.isActive });
            setF(blank);
          })}>{f.id ? tr("Hifadhi mabadiliko") : <><Plus className="mr-1 h-4 w-4" />{tr("Ongeza")}</>}</Button>
          {f.id && <Button variant="outline" onClick={() => setF(blank)}>{tr("Ghairi")}</Button>}
        </div>
      </Card>

      <Card title={tr("Njia zilizopo")}>
        {!rows ? <Loading /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">{tr("Inaandaa orodha ya kuanzia…")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left"><th className="p-2">{tr("Jina")}</th><th className="p-2">{tr("Aina")}</th><th className="p-2">{tr("Lipa Namba / Akaunti")}</th><th className="p-2">{tr("Hali")}</th><th className="p-2" /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r._id} className="border-b align-middle">
                    <td className="p-2 font-medium">{r.name}</td>
                    <td className="p-2">{kindLabel(r.kind)}</td>
                    <td className="p-2">{r.accountNo || "—"}{r.accountName ? <span className="block text-xs text-muted-foreground">{r.accountName}</span> : null}</td>
                    <td className="p-2">{r.isActive ? tr("Active") : tr("Inactive")}</td>
                    <td className="p-2"><div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="outline" disabled={busy || i === 0} onClick={() => void run(() => move({ id: r._id, direction: -1 }), tr("Imesogezwa."))} aria-label={tr("Juu")}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="sm" variant="outline" disabled={busy || i === rows.length - 1} onClick={() => void run(() => move({ id: r._id, direction: 1 }), tr("Imesogezwa."))} aria-label={tr("Chini")}><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="sm" variant="outline" onClick={() => setF({ id: r._id, name: r.name, kind: r.kind, accountNo: r.accountNo ?? "", accountName: r.accountName ?? "", isActive: r.isActive })}><Pencil className="mr-1 h-4 w-4" />{tr("Hariri")}</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm(tr("Futa njia hii ya malipo? Historia ya malipo haitaathirika."))) void run(() => remove({ id: r._id }), tr("Imefutwa.")); }}><Trash2 className="h-4 w-4" /></Button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageShell>
  );
}
