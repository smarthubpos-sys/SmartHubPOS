import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Empty, PageHeader, Panel, Pill, Stat, Table } from "@/components/page-kit.tsx";
import { downloadProductTemplate, parseProductFile, type ParsedRow } from "@/lib/excel.ts";
import { formatNumber } from "@/lib/format.ts";
import { errorText, tr } from "@/lib/i18n.ts";
import { useStockRights } from "@/hooks/use-stock-rights.ts";

type Checked = ParsedRow & { status: "new" | "update" | "error"; itemCode?: string; message?: string };
const CHUNK = 400;

export default function StockImport() {
  const navigate = useNavigate();
  const groups = useQuery(api.products.listGroups);
  const units = useQuery(api.products.listUnits);
  const importBatch = useMutation(api.products.importBatch);
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Checked[]>([]);
  const { canAdjust } = useStockRights();
  const [wantUpdate, setUpdateExisting] = useState(true);
  const updateExisting = wantUpdate && canAdjust; // updating existing items needs the stock permission

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [done, setDone] = useState<{ created: number; updated: number; errors: number } | null>(null);

  const count = (s: Checked["status"]) => rows.filter((r) => r.status === s).length;

  async function check(parsed: ParsedRow[], update: boolean) {
    const good = parsed.filter((p) => !p.error);
    const results = new Map<number, { status: Checked["status"]; itemCode?: string; message?: string }>();
    for (let i = 0; i < good.length; i += CHUNK) {
      const chunk = good.slice(i, i + CHUNK);
      const res = await importBatch({ rows: chunk.map((c) => c.row), dryRun: true, updateExisting: update });
      res.results.forEach((r) => results.set(chunk[r.row].line, r));
    }
    setRows(parsed.map((p) => p.error ? { ...p, status: "error" as const, message: p.error } : { ...p, ...(results.get(p.line) ?? { status: "error" as const }) }));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setDone(null); setFileName(file.name);
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error(tr("Tumia faili la Excel (.xlsx) lililotolewa na mfumo."));
      const { rows: parsed, missing } = await parseProductFile(file);
      if (missing.length) throw new Error(tr("Faili halina vichwa vya safu vinavyotarajiwa: {0}. Pakua template ya mfumo.", [missing.join(", ")]));
      if (!parsed.length) throw new Error(tr("Faili halina bidhaa."));
      await check(parsed, updateExisting);
    } catch (e) { setRows([]); toast.error(errorText(e, "Imeshindikana kusoma faili.")); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  async function importNow() {
    const valid = rows.filter((r) => r.status !== "error");
    if (!valid.length) return;
    setBusy(true);
    let created = 0, updated = 0;
    try {
      for (let i = 0; i < valid.length; i += CHUNK) {
        setProgress(tr("Inaingiza {0} / {1}…", [Math.min(i + CHUNK, valid.length), valid.length]));
        const res = await importBatch({ rows: valid.slice(i, i + CHUNK).map((v) => v.row), dryRun: false, updateExisting });
        created += res.created; updated += res.updated;
      }
      setDone({ created, updated, errors: rows.length - valid.length });
      setRows([]); setFileName("");
      toast.success(tr("Bidhaa zimeingizwa: {0} mpya, {1} zimeboreshwa.", [created, updated]));
    } catch (e) { toast.error(errorText(e, "Imeshindikana kuingiza bidhaa.")); }
    finally { setBusy(false); setProgress(""); }
  }

  const tone = (s: Checked["status"]) => (s === "new" ? "green" : s === "update" ? "blue" : "rose");
  const label = (s: Checked["status"]) => (s === "new" ? tr("Mpya") : s === "update" ? tr("Kuboresha") : tr("Kosa"));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Button variant="outline" onClick={() => navigate("/stock")}><ArrowLeft className="mr-2 h-4 w-4" />{tr("← Stoo")}</Button>
      <PageHeader icon={FileSpreadsheet} title={tr("Ingiza bidhaa kwa Excel")} subtitle={tr("Pakua template, jaza jina, bei ya kuuzia, bei ya manunuzi na idadi, kisha pakia. Mfumo unaweka kila kitu mahali pake.")} />

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={tr("1. Pakua template")}>
          <p className="mb-3 text-sm text-muted-foreground">{tr("Template ina vichwa vya safu, maelekezo na mfano. Makundi na vipimo vilivyopo vinatokea kama orodha ya kuchagua.")}</p>
          <Button onClick={() => void downloadProductTemplate((groups ?? []).map((g) => g.name), (units ?? []).map((u) => u.name))}><Download className="mr-2 h-4 w-4" />{tr("Pakua template ya Excel")}</Button>
        </Panel>
        <Panel title={tr("2. Pakia faili lililojazwa")}>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-5 text-center text-sm hover:bg-primary/10">
            <Upload className="h-6 w-6 text-primary" />
            <span className="font-medium">{fileName || tr("Bonyeza kuchagua faili la .xlsx")}</span>
            <input ref={input} type="file" accept=".xlsx" className="hidden" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!canAdjust} checked={updateExisting} onChange={(e) => { setUpdateExisting(e.target.checked); if (rows.length) void check(rows, e.target.checked); }} />
            {tr("Boresha bei na taarifa za bidhaa zilizopo tayari")}
          </label>
        </Panel>
      </div>

      {done && (
        <Panel><div className="flex items-center gap-3 text-sm"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{tr("Imekamilika: bidhaa {0} mpya, {1} zimeboreshwa, {2} zilizo na makosa hazikuingizwa.", [done.created, done.updated, done.errors])}</div></Panel>
      )}

      {rows.length > 0 && (
        <Panel title={tr("3. Hakiki kisha ingiza")} actions={<Button disabled={busy || rows.every((r) => r.status === "error")} onClick={() => void importNow()}>{busy ? progress || tr("Inasubiri…") : tr("Ingiza bidhaa {0}", [count("new") + count("update")])}</Button>}>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Stat label={tr("Mpya")} value={count("new")} tone="green" />
            <Stat label={tr("Kuboresha")} value={count("update")} tone="blue" />
            <Stat label={tr("Makosa")} value={count("error")} tone="rose" />
          </div>
          <Table head={[tr("Safu"), tr("Hali"), tr("Jina la bidhaa"), tr("Msimbo wa bidhaa"), tr("Kundi"), tr("Kipimo"), tr("Bei ya kuuzia"), tr("Bei ya manunuzi"), tr("Idadi"), tr("Maelezo")]}>
            {rows.slice(0, 500).map((r) => (
              <tr key={r.line}>
                <td>{r.line}</td>
                <td><Pill tone={tone(r.status)}>{label(r.status)}</Pill></td>
                <td className="font-medium">{r.row.name}</td>
                <td>{r.itemCode ?? r.row.itemCode ?? ""}</td>
                <td>{r.row.group}</td><td>{r.row.unit}</td>
                <td>{r.row.sellingPrice !== undefined ? formatNumber(r.row.sellingPrice, 2) : ""}</td>
                <td>{r.row.buyingPrice !== undefined ? formatNumber(r.row.buyingPrice, 2) : ""}</td>
                <td>{r.row.quantity !== undefined ? formatNumber(r.row.quantity, 2) : ""}</td>
                <td className="max-w-xs text-xs text-muted-foreground">{r.message ? errorText(new Error(r.message)) : ""}</td>
              </tr>
            ))}
          </Table>
          {rows.length > 500 && <p className="mt-2 text-xs text-muted-foreground">{tr("Inaonyesha safu 500 za kwanza; zote zitaingizwa.")}</p>}
        </Panel>
      )}
      {!rows.length && !done && <Empty>{tr("Bado hujapakia faili.")}</Empty>}
    </div>
  );
}
