import { useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { tr } from "@/lib/i18n.ts";
import { formatNumber } from "@/lib/format.ts";

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;
const money = (n: number) => formatNumber(n, 2);

/** What a journal source means to a shop owner. Unknown sources show their raw name. */
function sourceLabel(sourceType: string): string {
  switch (sourceType) {
    case "sale": return tr("Mauzo ya invoice");
    case "waiter_sale": return tr("Fedha kutoka kwa wahudumu (Selling Point)");
    case "payment": return tr("Malipo ya wateja (madeni)");
    case "bill_payment": return tr("Malipo ya matumizi / bills");
    case "bill": case "bill_current": return tr("Matumizi / bills");
    case "supplier_payment": return tr("Malipo kwa wasambazaji");
    case "purchase": return tr("Manunuzi");
    case "purchase_void": return tr("Purchase iliyofutwa (marejesho)");
    case "payroll": return tr("Mishahara");
    case "owner_capital": case "director_capital": case "capital": return tr("Mtaji");
    case "bank_loan": return tr("Mkopo wa benki");
    case "sale_unpay": return tr("Malipo yaliyorejeshwa kwa mteja");
    case "sale_void": return tr("Mauzo yaliyofutwa (marejesho)");
    case "sale_return": return tr("Marejesho ya mauzo");
    case "payment_edit": return tr("Malipo yaliyobadilishwa (marekebisho)");
    case "payment_void": case "bill_payment_void": return tr("Malipo yaliyorudishwa (Unpay)");
    case "manual": return tr("Journal / uhamisho wa mkono");
    default: return sourceType;
  }
}

/** Accounts > Reports > Money accounts: per Tigo Pesa / cash / bank account, what came in, what it paid for and what is left. */
export default function MethodReportPage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [open, setOpen] = useState<string>("");
  const report = useQuery(api.accounting.methodReport, to >= from ? { startDate: from, endDate: to } : "skip");
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button variant="outline" onClick={() => navigate("/accounts")}>{tr("← Accounts")}</Button>
          <h1 className="mt-3 text-2xl font-bold">{tr("Ripoti ya akaunti za fedha (Tigo Pesa / Cash / Benki)")}</h1>
          <p className="text-sm text-muted-foreground">{tr("Kila akaunti inaonyesha fedha iliyoingia, ilivyotumika kulipa nini, na kilichobaki.")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">{tr("Kuanzia")}<Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="grid gap-1 text-xs">{tr("Mpaka")}<Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </div>
      {to < from && <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{tr("Tarehe ya mwisho lazima isiwe kabla ya ya kuanzia.")}</p>}
      {report === undefined && to >= from && <p className="rounded-lg border p-5 text-sm text-muted-foreground">{tr("Inapakia ripoti...")}</p>}
      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">{tr("Imeingia jumla")}</p><p className="text-xl font-bold text-emerald-600">{money(report.totalIn)}</p></div>
            <div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">{tr("Imelipwa / kutoka jumla")}</p><p className="text-xl font-bold text-rose-600">{money(report.totalOut)}</p></div>
            <div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">{tr("Kilichobaki jumla")}</p><p className="text-xl font-bold">{money(report.totalClosing)}</p></div>
          </div>
          {report.rows.length === 0 && <p className="rounded-lg border p-5 text-sm text-muted-foreground">{tr("Hakuna miamala ya fedha kwa kipindi hiki.")}</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            {report.rows.map((r) => {
              const isOpen = open === r.accountId;
              return (
                <section key={r.accountId} className="space-y-3 rounded-2xl border p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-semibold">{r.name}{r.branchName ? <span className="ml-2 text-sm font-normal text-muted-foreground">· {r.branchName}</span> : null}</h2>
                    <span className="text-xs text-muted-foreground">{r.code}</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div><dt className="text-muted-foreground">{tr("Ilianza na")}</dt><dd className="font-semibold tabular-nums">{money(r.opening)}</dd></div>
                    <div><dt className="text-muted-foreground">{tr("Iliingia")}</dt><dd className="font-semibold tabular-nums text-emerald-600">{money(r.totalIn)}</dd></div>
                    <div><dt className="text-muted-foreground">{tr("Ilitoka")}</dt><dd className="font-semibold tabular-nums text-rose-600">{money(r.totalOut)}</dd></div>
                    <div><dt className="text-muted-foreground">{tr("Imebaki")}</dt><dd className="text-base font-bold tabular-nums">{money(r.closing)}</dd></div>
                  </dl>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{tr("Iliingia kutoka wapi")}</h3>
                      {r.inBy.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <ul className="space-y-1 text-sm">{r.inBy.map((g) => <li key={g.sourceType} className="flex justify-between gap-2"><span>{sourceLabel(g.sourceType)} <span className="text-xs text-muted-foreground">×{g.count}</span></span><b className="tabular-nums">{money(g.amount)}</b></li>)}</ul>}
                    </div>
                    <div>
                      <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{tr("Ilitumika kulipa nini")}</h3>
                      {r.outBy.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <ul className="space-y-1 text-sm">{r.outBy.map((g) => <li key={g.sourceType} className="flex justify-between gap-2"><span>{sourceLabel(g.sourceType)} <span className="text-xs text-muted-foreground">×{g.count}</span></span><b className="tabular-nums">{money(g.amount)}</b></li>)}</ul>}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setOpen(isOpen ? "" : r.accountId)}>{isOpen ? tr("Ficha maelezo") : tr("Onyesha maelezo ya kila muamala")}</Button>
                  {isOpen && (
                    <div className="space-y-3">
                      {([[tr("Iliingia"), r.ins], [tr("Ilitoka"), r.outs]] as const).map(([title, list]) => (
                        <div key={title} className="overflow-x-auto rounded-lg border">
                          <table className="w-full min-w-[420px] text-xs">
                            <thead><tr className="bg-muted/60 text-left"><th className="p-2" colSpan={4}>{title}</th></tr></thead>
                            <tbody>
                              {list.length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={4}>—</td></tr>}
                              {list.map((d, i) => <tr key={`${d.reference}-${i}`} className="border-t"><td className="whitespace-nowrap p-2">{d.date}</td><td className="p-2">{sourceLabel(d.sourceType)}</td><td className="p-2">{d.description}</td><td className="p-2 text-right tabular-nums">{money(d.amount)}</td></tr>)}
                            </tbody>
                          </table>
                        </div>
                      ))}
                      {r.truncated && <p className="text-xs text-muted-foreground">{tr("Maelezo yameonyesha miamala ya kwanza 400 tu kwa kila upande; jumla hapo juu ni kamili.")}</p>}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{tr("Ripoti hii inatokana na journal zilizopostiwa. Njia za malipo za aina ya Cash zinashiriki akaunti moja ya Cash.")}</p>
        </>
      )}
    </main>
  );
}
