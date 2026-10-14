import { useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Printer } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n.ts";
import { printElement, readPaper, savePaper, type Paper } from "@/lib/print-area.ts";

type ReceiptLine = { label: string; value: string | number };
type Props = { title: string; reference: string; date: string; partyLabel: string; party: string; amount: number; method?: string; note?: string; lines?: ReceiptLine[] };

export default function TransactionReceipt({ title, reference, date, partyLabel, party, amount, method, note, lines = [] }: Props) {
  const settings = useQuery(api.maintenance.getSettings, {});
  const [paper, setPaper] = useState<Paper>(readPaper);
  const articleRef = useRef<HTMLElement>(null);
  const company = settings?.company;
  const symbol = company?.currencySymbol ?? "TSh";
  const places = company?.decimalPlaces ?? 0;
  const money = (n: number) => `${symbol} ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places })}`;
  const footer = String((settings?.app?.system as { receiptFooter?: unknown } | undefined)?.receiptFooter ?? "Asante kwa kutumia huduma zetu!");
  const print = () => printElement(articleRef.current, paper);
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <label className="text-sm">{tr("Printer")}: <select className="h-9 rounded border bg-background px-2" value={paper} onChange={e => { const value = e.target.value as Paper; setPaper(value); savePaper(value); }}><option value="80mm">80mm</option><option value="58mm">58mm</option><option value="A4">A4</option></select></label>
      <Button onClick={print}><Printer className="mr-2 h-4 w-4" />{tr("Chapisha risiti")}</Button>
    </div>
    <article ref={articleRef} className={`transaction-receipt mx-auto space-y-2 rounded-xl border bg-card p-4 text-sm ${paper === "A4" ? "max-w-3xl" : paper === "58mm" ? "max-w-[58mm]" : "max-w-[80mm]"}`}>
      <header className="border-b pb-2 text-center"><h2 className="font-bold">{company?.companyName || tr("Biashara")}</h2>{company?.address && <p>{company.address}</p>}{company?.phone && <p>{company.phone}</p>}{company?.email && <p>{company.email}</p>}{company?.taxId && <p>TIN: {company.taxId}</p>}<h3 className="mt-2 font-bold">{title}</h3></header>
      <div className="space-y-1"><p><b>{tr("Namba")}: </b>{reference}</p><p><b>{tr("Tarehe")}: </b>{date}</p><p><b>{partyLabel}: </b>{party}</p>{method && <p><b>{tr("Njia ya malipo")}: </b>{method}</p>}</div>
      {lines.length > 0 && <table className="w-full border-collapse"><tbody>{lines.map((line, i) => <tr key={i} className="border-b border-dashed"><td className="py-1">{line.label}</td><td className="py-1 text-right">{typeof line.value === "number" ? money(line.value) : line.value}</td></tr>)}</tbody></table>}
      <div className="border-t pt-2 text-right text-base font-bold">{tr("Kiasi")}: {money(amount)}</div>{note && <p className="text-xs">{note}</p>}
      {footer.trim() && <footer className="border-t pt-2 text-center text-xs">{footer}</footer>}
    </article>
  </section>;
}
