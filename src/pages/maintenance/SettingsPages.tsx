import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, Loading, NoAccess, PageShell, SelectField, TextField, Toggle, useMaintenanceSettings, useRun } from "./_shared";
import { tr, errorText, setLang } from "@/lib/i18n.ts";
import { authorizedDevices, deviceSupport, listInstalledPrinters, pairDevice, testPrinter, type DeviceInfo, type DeviceKind } from "@/lib/printers.ts";

type Settings = NonNullable<ReturnType<typeof useMaintenanceSettings>>;
const str = (v: unknown, d = "") => (v === undefined || v === null ? d : String(v));

function useForm<T extends Record<string, any>>(initial: T) {
  const [f, setF] = useState<T>(initial);
  return { f, set: <K extends keyof T>(k: K, v: T[K]) => setF((p) => ({ ...p, [k]: v })) };
}

function OfficeWarning({ s }: { s: Settings }) {
  if (s.hasOffice) return null;
  return <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{tr("Bado hakuna ofisi. Mipangilio itahifadhiwa kama ya awali (initial setup); unda ofisi kupitia Super Admin ili iunganishwe nayo baadaye.")}</p>;
}

/* ───────── Company Information ───────── */
function CompanyForm({ s }: { s: Settings }) {
  const save = useMutation(api.maintenance.saveCompany);
  const { busy, run } = useRun();
  const c: any = s.company ?? {};
  const { f, set } = useForm({ companyName: str(c.companyName), address: str(c.address), phone: str(c.phone), email: str(c.email), taxId: str(c.taxId), website: str(c.website), logoUrl: str(c.logoUrl) });
  const allowed = s.canEdit["maintenance.company"];
  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 300_000) return void run(async () => { throw new Error(tr("Logo iwe chini ya KB 300.")); });
    const r = new FileReader();
    r.onload = () => set("logoUrl", String(r.result));
    r.readAsDataURL(file);
  };
  return (
    <>
      <OfficeWarning s={s} />
      {!allowed && <NoAccess permission="maintenance.company" />}
      <Card>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={tr("Jina la biashara")} value={f.companyName} onChange={(v) => set("companyName", v)} disabled={!allowed} />
          <TextField label={tr("TIN / Tax ID")} value={f.taxId} onChange={(v) => set("taxId", v)} disabled={!allowed} />
          <TextField label={tr("Simu")} value={f.phone} onChange={(v) => set("phone", v)} disabled={!allowed} />
          <TextField label={tr("Email")} type="email" value={f.email} onChange={(v) => set("email", v)} disabled={!allowed} />
          <TextField label={tr("Anwani")} value={f.address} onChange={(v) => set("address", v)} disabled={!allowed} />
          <TextField label={tr("Website")} value={f.website} onChange={(v) => set("website", v)} disabled={!allowed} />
          <div className="grid gap-2 text-sm md:col-span-2">
            <span className="font-medium">{tr("Logo (PNG/JPG/WebP, chini ya KB 300)")}</span>
            <div className="flex items-center gap-4">
              {f.logoUrl && <img src={f.logoUrl} alt={tr("Logo")} className="h-16 w-16 rounded border object-contain" />}
              <input type="file" accept="image/*" disabled={!allowed} onChange={(e) => onLogo(e.target.files?.[0])} />
              {f.logoUrl && allowed && <Button variant="outline" size="sm" onClick={() => set("logoUrl", "")}>{tr("Ondoa")}</Button>}
            </div>
          </div>
        </div>
        <Button disabled={busy || !allowed} onClick={() => void run(async () => {
          if (!f.companyName.trim()) throw new Error(tr("Jina la biashara linahitajika."));
          await save({ ...f, companyName: f.companyName.trim() });
        })}>{tr("Hifadhi")}</Button>
      </Card>
    </>
  );
}
export function CompanyPage() {
  const s = useMaintenanceSettings();
  return <PageShell title={tr("Company Information")} subtitle={tr("Taarifa za biashara na nembo")}>{!s ? <Loading /> : <CompanyForm s={s} />}</PageShell>;
}

/* ───────── Currency ───────── */
function CurrencyForm({ s }: { s: Settings }) {
  const save = useMutation(api.maintenance.saveCompany);
  const { busy, run } = useRun();
  const c: any = s.company ?? {};
  const { f, set } = useForm({ currency: str(c.currency, "TZS"), currencySymbol: str(c.currencySymbol, "TSh"), decimalPlaces: str(c.decimalPlaces, "2") });
  const allowed = s.canEdit["maintenance.company"];
  const preview = `${f.currencySymbol} ${(1234567.891).toLocaleString("en-US", { minimumFractionDigits: Number(f.decimalPlaces) || 0, maximumFractionDigits: Number(f.decimalPlaces) || 0 })}`;
  return (
    <>
      <OfficeWarning s={s} />
      {!allowed && <NoAccess permission="maintenance.company" />}
      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField label={tr("Currency code")} value={f.currency} onChange={(v) => set("currency", v.toUpperCase())} hint={tr("mf. TZS, USD, KES")} disabled={!allowed} />
          <TextField label={tr("Symbol")} value={f.currencySymbol} onChange={(v) => set("currencySymbol", v)} hint={tr("mf. TSh, $")} disabled={!allowed} />
          <SelectField label={tr("Decimal places")} value={f.decimalPlaces} onChange={(v) => set("decimalPlaces", v)} options={["0", "1", "2", "3", "4"].map((x) => [x, x] as [string, string])} disabled={!allowed} />
        </div>
        <p className="text-sm">{tr("Mfano:")} <b>{preview}</b></p>
        <Button disabled={busy || !allowed} onClick={() => void run(async () => {
          if (!/^[A-Z]{3}$/.test(f.currency)) throw new Error(tr("Currency code iwe herufi 3 (mf. TZS)."));
          await save({ currency: f.currency, currencySymbol: f.currencySymbol, decimalPlaces: Number(f.decimalPlaces) });
        })}>{tr("Hifadhi")}</Button>
      </Card>
    </>
  );
}
export function CurrencyPage() {
  const s = useMaintenanceSettings();
  return <PageShell title={tr("Currency Settings")} subtitle={tr("Sarafu na muundo wa kuonyesha pesa")}>{!s ? <Loading /> : <CurrencyForm s={s} />}</PageShell>;
}

/* ───────── Tax ───────── */
function TaxForm({ s }: { s: Settings }) {
  const saveCompany = useMutation(api.maintenance.saveCompany);
  const saveSetting = useMutation(api.maintenance.saveSetting);
  const { busy, run } = useRun();
  const c: any = s.company ?? {};
  const t: any = s.app.taxes ?? {};
  const { f, set } = useForm({ taxName: str(c.taxName, tr("VAT")), taxRate: str(c.taxRate, "18"), traIntegrationEnabled: !!c.traIntegrationEnabled, priceIncludesTax: !!t.priceIncludesTax });
  const [rates, setRates] = useState<{ name: string; rate: string }[]>((t.rates ?? []).map((r: any) => ({ name: r.name, rate: String(r.rate) })));
  const allowed = s.canEdit["maintenance.tax"] && s.canEdit["maintenance.company"];
  return (
    <>
      <OfficeWarning s={s} />
      {!allowed && <NoAccess permission="maintenance.tax" />}
      <Card title={tr("Kodi ya msingi")}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={tr("Jina la kodi")} value={f.taxName} onChange={(v) => set("taxName", v)} disabled={!allowed} />
          <TextField label={tr("Kiwango (%)")} type="number" value={f.taxRate} onChange={(v) => set("taxRate", v)} disabled={!allowed} />
        </div>
        <Toggle label={tr("Bei zinajumuisha kodi (tax inclusive)")} checked={f.priceIncludesTax} onChange={(v) => set("priceIncludesTax", v)} disabled={!allowed} />
        <Toggle label={tr("TRA integration imewashwa")} hint={tr("Inawasha bendera ya TRA; muunganisho halisi wa TRA unahitaji credentials za ofisi (Super Admin > Ofisi).")} checked={f.traIntegrationEnabled} onChange={(v) => set("traIntegrationEnabled", v)} disabled={!allowed} />
      </Card>
      <Card title={tr("Viwango vingine vya kodi")}>
        {rates.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3">
            <TextField label={tr("Jina")} value={r.name} onChange={(v) => setRates((p) => p.map((x, j) => (j === i ? { ...x, name: v } : x)))} disabled={!allowed} />
            <TextField label="%" type="number" value={r.rate} onChange={(v) => setRates((p) => p.map((x, j) => (j === i ? { ...x, rate: v } : x)))} disabled={!allowed} />
            <Button variant="outline" size="icon" disabled={!allowed} onClick={() => setRates((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="outline" disabled={!allowed} onClick={() => setRates((p) => [...p, { name: "", rate: "0" }])}><Plus className="mr-2 h-4 w-4" />{tr("Ongeza kiwango")}</Button>
      </Card>
      <Button disabled={busy || !allowed} onClick={() => void run(async () => {
        const rate = Number(f.taxRate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error(tr("Kiwango cha kodi lazima kiwe 0–100."));
        const clean = rates.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), rate: Number(r.rate) }));
        if (clean.some((r) => !Number.isFinite(r.rate) || r.rate < 0 || r.rate > 100)) throw new Error(tr("Viwango vingine lazima viwe 0–100."));
        await saveCompany({ taxName: f.taxName, taxRate: rate, traIntegrationEnabled: f.traIntegrationEnabled });
        await saveSetting({ key: "taxes", value: { priceIncludesTax: f.priceIncludesTax, rates: clean } });
      })}>{tr("Hifadhi")}</Button>
    </>
  );
}
export function TaxPage() {
  const s = useMaintenanceSettings();
  return <PageShell title={tr("Tax Settings")} subtitle={tr("Viwango vya kodi na sheria")}>{!s ? <Loading /> : <TaxForm s={s} />}</PageShell>;
}

/* ───────── System Setup ───────── */
function SystemForm({ s }: { s: Settings }) {
  const saveCompany = useMutation(api.maintenance.saveCompany);
  const saveSetting = useMutation(api.maintenance.saveSetting);
  const { busy, run } = useRun();
  const c: any = s.company ?? {};
  const a: any = s.app.system ?? {};
  const { f, set } = useForm({
    stockControlEnabled: c.stockControlEnabled ?? true, allowNegativeStock: !!c.allowNegativeStock,
    inventoryCostingMethod: str(c.inventoryCostingMethod, "weighted_average"),
    dateFormat: str(a.dateFormat, "dd/MM/yyyy"), receiptFooter: str(a.receiptFooter, tr("Asante kwa kununua!")), defaultPaymentMethod: str(a.defaultPaymentMethod, "cash"),
    reportEmailRecipients: str(a.reportEmailRecipients, ""),
  });
  const ok = s.canEdit["maintenance.system"];
  return (
    <>
      <OfficeWarning s={s} />
      {!ok && <NoAccess permission="maintenance.system" />}
      <Card title={tr("Stock")}>
        <Toggle label={tr("Stock control imewashwa")} checked={f.stockControlEnabled} onChange={(v) => set("stockControlEnabled", v)} disabled={!ok} />
        <Toggle label={tr("Ruhusu stock hasi (negative stock)")} hint={tr("Ukizima, mauzo yanazuiwa pale stock haitoshi.")} checked={f.allowNegativeStock} onChange={(v) => set("allowNegativeStock", v)} disabled={!ok} />
        <SelectField label={tr("Njia ya costing")} value={f.inventoryCostingMethod} onChange={(v) => set("inventoryCostingMethod", v)} disabled={!ok}
          options={[["weighted_average", tr("Weighted average")], ["fifo", tr("FIFO")], ["last_purchase", tr("Last purchase cost")]]} />
      </Card>
      <Card title={tr("General")}>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label={tr("Muundo wa tarehe")} value={f.dateFormat} onChange={(v) => set("dateFormat", v)} disabled={!ok} options={[["dd/MM/yyyy", "31/12/2026"], ["MM/dd/yyyy", "12/31/2026"], ["yyyy-MM-dd", "2026-12-31"]]} />
          <SelectField label={tr("Njia ya malipo ya kawaida")} value={f.defaultPaymentMethod} onChange={(v) => set("defaultPaymentMethod", v)} disabled={!ok} options={[["cash", tr("Cash")], ["bank", tr("Bank")], ["mobile", tr("Mobile Money")]]} />
        </div>
        <TextField label={tr("Maandishi ya chini ya risiti")} value={f.receiptFooter} onChange={(v) => set("receiptFooter", v)} disabled={!ok} />
      </Card>
      <Button disabled={busy || !ok} onClick={() => void run(async () => {
        await saveCompany({ stockControlEnabled: f.stockControlEnabled, allowNegativeStock: f.allowNegativeStock, inventoryCostingMethod: f.inventoryCostingMethod });
        await saveSetting({ key: "system", value: { dateFormat: f.dateFormat, receiptFooter: f.receiptFooter, defaultPaymentMethod: f.defaultPaymentMethod, reportEmailRecipients: f.reportEmailRecipients } });
      })}>{tr("Hifadhi")}</Button>
    </>
  );
}
export function SystemSetupPage() {
  const s = useMaintenanceSettings();
  return <PageShell title={tr("System Setup")} subtitle={tr("Mipangilio ya jumla ya mfumo")}>{!s ? <Loading /> : <SystemForm s={s} />}</PageShell>;
}

/* ───────── Hardware ───────── */
function HardwareForm({ s }: { s: Settings }) {
  const saveSetting = useMutation(api.maintenance.saveSetting);
  const { busy, run } = useRun();
  const h: any = s.app.hardware ?? {};
  const { f, set } = useForm({
    printerConnection: str(h.printerConnection, "wired"), printerSource: str(h.printerSource, "installed"),
    receiptPrinter: str(h.receiptPrinter), receiptDevice: (h.receiptDevice ?? null) as DeviceInfo | null,
    paperWidth: str(h.paperWidth, "80mm"), autoPrintReceipt: !!h.autoPrintReceipt, openCashDrawer: !!h.openCashDrawer,
    labelPrinter: str(h.labelPrinter), scannerMode: str(h.scannerMode, "keyboard"), scannerSuffix: str(h.scannerSuffix, "Enter"), customerDisplay: !!h.customerDisplay,
  });
  const ok = s.canEdit["maintenance.hardware"];
  const wireless = f.printerConnection === "wireless";
  const kinds: DeviceKind[] = wireless ? ["bluetooth", "serial"] : ["usb", "serial"];
  const [kind, setKind] = useState<DeviceKind>(f.receiptDevice?.kind ?? kinds[0]);
  const activeKind: DeviceKind = kinds.includes(kind) ? kind : kinds[0];
  const [installed, setInstalled] = useState<string[]>([]);
  const [known, setKnown] = useState<DeviceInfo[]>([]);
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const kindLabel = (k: DeviceKind) => (k === "usb" ? tr("USB (waya)") : k === "bluetooth" ? tr("Bluetooth (wireless)") : wireless ? tr("Bluetooth ya kawaida (Serial/SPP)") : tr("Serial / COM (waya)"));

  useEffect(() => { void authorizedDevices(activeKind).then(setKnown); }, [activeKind]);

  async function detectInstalled() {
    setWorking(true); setStatus(tr("Inatafuta printer zilizosakinishwa…"));
    try {
      const list = await listInstalledPrinters();
      setInstalled(list);
      setStatus(list.length ? tr("Printer {0} zimepatikana.", [list.length]) : tr("Hakuna printer iliyopatikana kwenye mfumo."));
    } catch {
      setStatus(tr("Imeshindikana kuunganisha na QZ Tray. Hakikisha QZ Tray imewashwa kwenye kompyuta hii, kisha jaribu tena."));
    } finally { setWorking(false); }
  }
  async function pair() {
    if (!deviceSupport[activeKind]()) { setStatus(tr("Kivinjari hiki hakitumii njia hii. Tumia Chrome au Edge.")); return; }
    setWorking(true); setStatus("");
    try {
      const d = await pairDevice(activeKind);
      set("receiptDevice", d); setKnown(await authorizedDevices(activeKind));
      setStatus(tr("Printer imechaguliwa: {0}", [d.name]));
    } catch (e) { setStatus(e instanceof Error && e.name !== "NotFoundError" ? errorText(e, "Imeshindikana kuunganisha printer.") : tr("Hakuna printer iliyochaguliwa.")); }
    finally { setWorking(false); }
  }
  async function test() {
    setWorking(true); setStatus("");
    try { await testPrinter(f); setStatus(tr("Jaribio la kuchapa limetumwa.")); }
    catch (e) { setStatus(errorText(e, "Imeshindikana kuchapa.")); }
    finally { setWorking(false); }
  }
  const installedOptions: [string, string][] = [["", tr("(chaguo-msingi ya mfumo)")], ...Array.from(new Set([...installed, ...(f.receiptPrinter ? [f.receiptPrinter] : [])])).map((n) => [n, n] as [string, string])];
  const knownOptions: [string, string][] = [["", tr("-- Chagua printer --")], ...known.map((d, i) => [String(i), d.name] as [string, string])];
  return (
    <>
      <OfficeWarning s={s} />
      {!ok && <NoAccess permission="maintenance.hardware" />}
      <Card title={tr("Printer ya risiti")}>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label={tr("Aina ya muunganisho")} value={f.printerConnection} onChange={(v) => set("printerConnection", v)} disabled={!ok}
            options={[["wired", tr("Waya (USB / Serial)")], ["wireless", tr("Wireless (Bluetooth / Wi-Fi)")]]} />
          <SelectField label={tr("Printer inapatikanaje")} value={f.printerSource} onChange={(v) => set("printerSource", v)} disabled={!ok}
            options={[["installed", tr("Printer zilizosakinishwa kwenye mfumo")], ["direct", tr("Unganisha printer moja kwa moja")]]} />
        </div>

        {f.printerSource === "installed" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField label={tr("Jina la receipt printer")} value={f.receiptPrinter} onChange={(v) => set("receiptPrinter", v)} disabled={!ok} options={installedOptions}
              hint={tr("Bonyeza “Tafuta printer” ili kuorodhesha printer zilizosakinishwa. Bila orodha, printer chaguo-msingi hutumika na dirisha la kuchapa hukuruhusu kuchagua.")} />
            <div className="flex items-end"><Button type="button" variant="outline" disabled={working || !ok} onClick={() => void detectInstalled()}>{tr("Tafuta printer zilizosakinishwa")}</Button></div>
            {!installed.length && <TextField label={tr("Au andika jina la printer")} value={f.receiptPrinter} onChange={(v) => set("receiptPrinter", v)} disabled={!ok} />}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField label={tr("Njia ya kuunganisha")} value={activeKind} onChange={(v) => setKind(v as DeviceKind)} disabled={!ok} options={kinds.map((k) => [k, kindLabel(k)] as [string, string])} />
            <div className="flex items-end"><Button type="button" variant="outline" disabled={working || !ok} onClick={() => void pair()}>{tr("Tafuta / unganisha printer")}</Button></div>
            {known.length > 0 && <SelectField label={tr("Printer zilizoruhusiwa tayari")} value={String(known.findIndex((d) => d.id === f.receiptDevice?.id && d.vendorId === f.receiptDevice?.vendorId && d.productId === f.receiptDevice?.productId && d.kind === f.receiptDevice?.kind))} onChange={(v) => set("receiptDevice", known[Number(v)] ?? null)} disabled={!ok} options={knownOptions} />}
            <p className="text-sm md:col-span-2">{tr("Printer iliyochaguliwa:")} <b>{f.receiptDevice ? `${f.receiptDevice.name} (${f.receiptDevice.kind})` : tr("Hakuna")}</b></p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label={tr("Upana wa karatasi")} value={f.paperWidth} onChange={(v) => set("paperWidth", v)} disabled={!ok} options={[["58mm", tr("58 mm")], ["80mm", tr("80 mm")], ["a4", "A4"]]} />
          <TextField label={tr("Kichapishi cha lebo (hiari)")} value={f.labelPrinter} onChange={(v) => set("labelPrinter", v)} disabled={!ok} />
        </div>
        <Toggle label={tr("Chapisha risiti moja kwa moja baada ya mauzo")} checked={f.autoPrintReceipt} onChange={(v) => set("autoPrintReceipt", v)} disabled={!ok} />
        <Toggle label={tr("Fungua cash drawer baada ya mauzo")} checked={f.openCashDrawer} onChange={(v) => set("openCashDrawer", v)} disabled={!ok} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={working} onClick={() => void test()}>{tr("Jaribu kuchapa")}</Button>
          {status && <span className="text-sm text-muted-foreground" role="status">{status}</span>}
        </div>
      </Card>
      <Card title={tr("Kisoma barcode na skrini")}>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label={tr("Kisoma barcode")} value={f.scannerMode} onChange={(v) => set("scannerMode", v)} disabled={!ok} options={[["keyboard", tr("Kibodi ya USB (keyboard wedge)")], ["serial", tr("Serial / Bluetooth")]]} />
          <SelectField label={tr("Mwisho wa scan")} value={f.scannerSuffix} onChange={(v) => set("scannerSuffix", v)} disabled={!ok} options={[["Enter", "Enter"], ["Tab", "Tab"], ["none", tr("Hakuna")]]} />
        </div>
        <Toggle label={tr("Customer display imewashwa")} checked={f.customerDisplay} onChange={(v) => set("customerDisplay", v)} disabled={!ok} />
      </Card>
      <Button disabled={busy || !ok} onClick={() => void run(() => saveSetting({ key: "hardware", value: f }))}>{tr("Hifadhi")}</Button>
    </>
  );
}
export function HardwarePage() {
  const s = useMaintenanceSettings();
  return <PageShell title={tr("Hardware Setup")} subtitle={tr("Printers, scanners na vifaa vingine")}>{!s ? <Loading /> : <HardwareForm s={s} />}</PageShell>;
}

/* ───────── Document numbering ───────── */
const DOCS: [string, string, string][] = [
  ["invoice", tr("Sales Invoice"), "INV-"], ["receipt", tr("Customer Receipt"), "RCT-"], ["salesReturn", tr("Sales Return"), "SRN-"],
  ["purchase", tr("Purchase Invoice"), "PUR-"], ["purchaseOrder", tr("Purchase Order"), "PO-"], ["grn", tr("Goods Received Note"), "GRN-"],
  ["purchaseReturn", tr("Purchase Return"), "PRN-"], ["supplierPayment", tr("Supplier Payment"), "SPY-"],
];
function NumberingForm({ s }: { s: Settings }) {
  const saveSetting = useMutation(api.maintenance.saveSetting);
  const saveCompany = useMutation(api.maintenance.saveCompany);
  const { busy, run } = useRun();
  const saved: any = s.app.numbering ?? {};
  const c: any = s.company ?? {};
  const [rows, setRows] = useState<Record<string, { prefix: string; padding: string; next: string }>>(() =>
    Object.fromEntries(DOCS.map(([k, , d]) => [k, {
      prefix: saved[k]?.prefix ?? (k === "invoice" ? c.invoicePrefix : k === "purchase" ? c.purchasePrefix : undefined) ?? d,
      padding: String(saved[k]?.padding ?? 6), next: String(saved[k]?.next ?? 1),
    }])));
  const ok = s.canEdit["maintenance.numbering"];
  const upd = (k: string, p: Partial<{ prefix: string; padding: string; next: string }>) => setRows((r) => ({ ...r, [k]: { ...r[k], ...p } }));
  return (
    <>
      <OfficeWarning s={s} />
      {!ok && <NoAccess permission="maintenance.numbering" />}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="p-2">{tr("Document")}</th><th className="p-2">{tr("Prefix")}</th><th className="p-2">{tr("Tarakimu")}</th><th className="p-2">{tr("Namba inayofuata")}</th><th className="p-2">{tr("Mfano")}</th></tr></thead>
            <tbody>
              {DOCS.map(([k, label]) => {
                const r = rows[k];
                return (
                  <tr key={k} className="border-t">
                    <td className="p-2 font-medium">{label}</td>
                    <td className="p-2"><input className="h-9 w-28 rounded-md border bg-background px-2" value={r.prefix} disabled={!ok} onChange={(e) => upd(k, { prefix: e.target.value.toUpperCase() })} /></td>
                    <td className="p-2"><input type="number" min={1} max={12} className="h-9 w-20 rounded-md border bg-background px-2" value={r.padding} disabled={!ok} onChange={(e) => upd(k, { padding: e.target.value })} /></td>
                    <td className="p-2"><input type="number" min={1} className="h-9 w-28 rounded-md border bg-background px-2" value={r.next} disabled={!ok} onChange={(e) => upd(k, { next: e.target.value })} /></td>
                    <td className="p-2 font-mono">{r.prefix}{String(Math.max(1, Number(r.next) || 1)).padStart(Math.max(1, Number(r.padding) || 1), "0")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button disabled={busy || !ok} onClick={() => void run(async () => {
          const value: Record<string, { prefix: string; padding: number; next: number }> = {};
          for (const [k, label] of DOCS) {
            const r = rows[k]; const padding = Number(r.padding); const next = Number(r.next);
            if (!Number.isInteger(padding) || padding < 1 || padding > 12) throw new Error(tr("{0}: tarakimu 1–12.", [label]));
            if (!Number.isInteger(next) || next < 1) throw new Error(tr("{0}: namba ianze 1 au zaidi.", [label]));
            value[k] = { prefix: r.prefix.trim(), padding, next };
          }
          await saveSetting({ key: "numbering", value });
          if (s.canEdit["maintenance.company"]) await saveCompany({ invoicePrefix: value.invoice.prefix, purchasePrefix: value.purchase.prefix });
        })}>{tr("Hifadhi")}</Button>
        <p className="text-xs text-muted-foreground">{tr("Mipangilio hii ndiyo chanzo cha prefix za nyaraka; moduli zinazotoa namba zitaisoma kupitia")} <code>{tr("maintenance.getSettings")}</code>.</p>
      </Card>
    </>
  );
}
export function NumberingPage() {
  const s = useMaintenanceSettings();
  return <PageShell title={tr("Document Numbering")} subtitle={tr("Prefix na mfuatano wa namba za nyaraka")}>{!s ? <Loading /> : <NumberingForm s={s} />}</PageShell>;
}

/* ───────── Language ───────── */
function LanguageForm({ s }: { s: Settings }) {
  const saveSetting = useMutation(api.maintenance.saveSetting);
  const { busy, run } = useRun();
  const [choice, setChoice] = useState<string>((s.app.language as any)?.language === "en" ? "en" : "sw");
  const ok = s.canEdit["maintenance.language"];
  return (
    <>
      {!ok && <NoAccess permission="maintenance.language" />}
      <Card>
        <SelectField label={tr("Lugha ya mfumo")} value={choice} onChange={setChoice} disabled={!ok} options={[["sw", tr("Kiswahili")], ["en", tr("English")]]} />
        <Button disabled={busy || !ok} onClick={() => void run(async () => {
          await saveSetting({ key: "language", value: { language: choice } });
          setLang(choice === "en" ? "en" : "sw"); // reloads so the whole system switches to this one language
        })}>{tr("Hifadhi")}</Button>
        <p className="text-xs text-muted-foreground">{tr("Lugha inahifadhiwa kwa biashara nzima. Skrini zote, ripoti na ujumbe hutumia lugha hii moja.")}</p>
      </Card>
    </>
  );
}
export function LanguagePage() {
  const s = useMaintenanceSettings();
  return <PageShell title={tr("Language Settings")} subtitle={tr("Lugha ya kiolesura")}>{!s ? <Loading /> : <LanguageForm s={s} />}</PageShell>;
}
