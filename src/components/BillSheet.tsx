import { qzPrinterFrom } from "@/lib/print-waiter-order.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { MessageCircle, Printer } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Empty } from "@/components/page-kit.tsx";
import { formatDate, formatNumber } from "@/lib/format.ts";
import {
  buildReceiptHtml,
  type Paper,
} from "@/lib/print-area.ts";
import { printHtmlViaQz } from "@/lib/printers.ts";
import { shouldSchedulePrint } from "@/lib/print-policy.ts";
import { tr } from "@/lib/i18n.ts";
import { stamp } from "@/lib/receipt-branding.ts";

/** One "Label : value" line of the receipt header. The print time is refreshed at the moment of printing. */
function ReceiptRow({ label, value, printTime }: { label: string; value?: string; printTime?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-1">
      <span className="w-[6.5rem] shrink-0">{label}</span>
      <span className="min-w-0 break-words" {...(printTime ? { "data-print-time": "true" } : {})}>: {value}</span>
    </div>
  );
}

/**
 * The bill itself. `printToken` > 0 sends the receipt to the configured QZ Tray printer once data is ready.
 * `kind="invoice"` (used by Sales) uses the department name as the heading instead of "BILI"; with no department it says "Sales".
 */
export default function BillSheet({
  invoiceIds,
  printToken,
  paper,
  whatsappEnabled,
  setWhatsappEnabled,
  kind = "bill",
  onPrinted,
}: {
  invoiceIds: Id<"invoices">[];
  printToken: number;
  paper: Paper;
  whatsappEnabled: boolean;
  setWhatsappEnabled: (value: boolean) => void;
  kind?: "bill" | "invoice";
  /** Called once QZ Tray has accepted the print job (never when printing fails). */
  onPrinted?: () => void;
}) {
  const bill = useQuery(api.customerBills.billData, { invoiceIds });
  const printed = useRef(0);
  const [printedAt] = useState(() => new Date());
  const onPrintedRef = useRef(onPrinted);
  useEffect(() => { onPrintedRef.current = onPrinted; }, [onPrinted]);
  const articleRef = useRef<HTMLElement>(null);
  const settings = useQuery(api.maintenance.getSettings, {});
  const hardware = (settings?.app?.hardware ?? {}) as {
    printerSource?: string;
    receiptPrinter?: string;
  };

  const printerName = qzPrinterFrom(hardware);
  const myPerms = useQuery(api.maintenance.myPermissions, {});
  // Cashiers who hold waiterOrders.manage may print even if an older custom role row lacks sales.print.
  const canPrint = !!myPerms && (myPerms.includes("sales.print") || myPerms.includes("waiterOrders.manage"));

  const printReceipt = useCallback(async () => {
    const el = articleRef.current;
    if (!el) return;

    if (!printerName) {
      toast.error(hardware.printerSource === "direct"
        ? tr("Printer iliyochaguliwa ni ya \"direct\" (USB/Bluetooth) na haiwezi kutumika hapa. Chagua printer ya QZ Tray kwenye mipangilio ya vifaa.")
        : tr("QZ Tray direct printing haijasanidiwa. Chagua printer ya QZ Tray kwenye mipangilio ya vifaa."));
      return false;
    }
    try {
      el.querySelectorAll("[data-print-time]").forEach((n) => { n.textContent = `: ${stamp(new Date())}`; });
      await printHtmlViaQz(printerName, buildReceiptHtml(el, paper));
      toast.success(tr("Ombi la kuchapa limetumwa kwa QZ Tray."));
      onPrintedRef.current?.();
      return true;
    } catch (error) {
      toast.error(`${tr("Imeshindikana kuchapa kupitia QZ Tray. Hakikisha programu imewashwa na printer iko tayari.")} ${error instanceof Error ? error.message : String(error ?? "")}`);
      return false;
    }
  }, [printerName, paper, hardware.printerSource]);

  useEffect(() => {
    if (settings === undefined) return;
    if (
      !shouldSchedulePrint({
        dataReady: !!bill,
        allowed: canPrint,
        token: printToken,
        lastPrinted: printed.current,
      })
    )
      return;

    const t = window.setTimeout(() => {
      if (printed.current === printToken) return;
      void printReceipt().then((ok) => { if (ok) printed.current = printToken; });
    }, 150);

    return () => window.clearTimeout(t);
  }, [
    bill,
    canPrint,
    printToken,
    paper,
    settings,
    printerName,
    printReceipt,
  ]);

  if (bill === undefined) return <Empty>{tr("Inapakia…")}</Empty>;
  const dp = bill.company.decimalPlaces;
  const m = (n: number) =>
    `${bill.company.currencySymbol} ${formatNumber(n, dp)}`;
  const number = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 2);
  const isInvoice = kind === "invoice";
  const heading = isInvoice ? bill.department?.trim() || "Sales" : tr("BILI YA MTEJA");
  const openedAt = bill.savedAt ? stamp(new Date(bill.savedAt)) : "";
  const billId = bill.invoices.map((inv) => inv.invoiceNo).join(", ");
  const whatsappText = [
    `${bill.company.name || "Biashara"} — ${heading}`,
    `${tr("Mteja")}: ${bill.client.name}`,
    ...bill.invoices.flatMap((inv) => [
      `${tr("Invoice")} ${inv.invoiceNo} (${formatDate(inv.date)})`,
      ...inv.lines.map(
        (l) => `${l.name} × ${number(l.qty)} = ${m(l.lineTotal)}`,
      ),
      `${tr("Jumla ya invoice")}: ${m(inv.total)}`,
    ]),
    `${isInvoice ? tr("Jumla ya invoice") : tr("Jumla ya bili")}: ${m(bill.totals.total)}`,
    `${tr("Imelipwa")}: ${m(bill.totals.paid)}`,
    `${tr("Deni lililobaki")}: ${m(bill.totals.outstanding)}`,
  ].join("\n");
  const rawPhone = (bill.client.phone || "").replace(/[^\d]/g, "");
  // Normalize Tanzanian local mobile numbers for wa.me (e.g. 0712... -> 255712...).
  const phone = rawPhone.startsWith("00")
    ? rawPhone.slice(2)
    : rawPhone.startsWith("0")
      ? `255${rawPhone.slice(1)}`
      : rawPhone.startsWith("255")
        ? rawPhone
        : rawPhone;
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText)}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2 print:hidden">
        {/* Customer bills (Bills page) have exactly two actions: Send and Print. Neither touches stock. The on/off checkbox stays for Sales invoices only. */}
        {isInvoice && (
          <label className="mr-auto flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={whatsappEnabled}
              onChange={(e) => setWhatsappEnabled(e.target.checked)}
            />
            {tr("Washa kutuma bili WhatsApp")}
          </label>
        )}
        {isInvoice ? (
          whatsappEnabled &&
          phone && (
            <Button
              variant="outline"
              onClick={() =>
                window.open(whatsappUrl, "_blank", "noopener,noreferrer")
              }
            >
              <MessageCircle className="mr-1 h-4 w-4" />
              {tr("Tuma bill WhatsApp")}
            </Button>
          )
        ) : (
          <Button
            variant="outline"
            disabled={!phone}
            title={phone ? undefined : tr("Mteja huyu hana namba ya simu.")}
            onClick={() =>
              window.open(whatsappUrl, "_blank", "noopener,noreferrer")
            }
          >
            <MessageCircle className="mr-1 h-4 w-4" />
            {tr("Send")}
          </Button>
        )}
        {canPrint && (
          <Button
            onClick={() => {
              void printReceipt();
            }}
          >
            <Printer className="mr-1 h-4 w-4" />
            {isInvoice ? tr("Chapisha") : tr("Print")}
          </Button>
        )}
      </div>
      <article
        ref={articleRef}
        data-paper={paper}
        className={`print-area mx-auto space-y-2 rounded-2xl border bg-white p-4 text-[12px] font-semibold leading-snug text-black print:rounded-none print:border-0 print:p-0 ${paper === "A4" ? "max-w-xl print:max-w-none" : paper === "58mm" ? "max-w-[58mm]" : "max-w-[80mm]"}`}
      >
        {bill.company.logoUrl && (
          <img src={bill.company.logoUrl} alt="" className="mx-auto max-h-20 max-w-[60%] object-contain grayscale" />
        )}
        <h3 className="text-center text-base font-extrabold tracking-wide">{heading}</h3>
        <div className="space-y-0.5 text-center">
          <p className="uppercase">{bill.company.name || tr("Biashara")}</p>
          {bill.company.address && <p>{bill.company.address}</p>}
          {bill.company.phone && <p>TEL : {bill.company.phone}</p>}
          {bill.company.taxId && <p>TIN : {bill.company.taxId}</p>}
        </div>
        <hr className="border-0 border-t border-dashed border-black" />
        <div className="space-y-0.5">
          <ReceiptRow label={tr("Muda wa kufungua")} value={openedAt} />
          <ReceiptRow label={tr("Muda wa kuchapa")} value={stamp(printedAt)} printTime />
          <ReceiptRow label={tr("Namba ya bili")} value={billId} />
          <ReceiptRow label={tr("Mhudumu")} value={bill.cashier} />
          <ReceiptRow label={tr("Mteja")} value={bill.client.name} />
          {!isInvoice && <ReceiptRow label={tr("Idara")} value={bill.department ?? ""} />}
        </div>
        <hr className="border-0 border-t border-dashed border-black" />
        <div className="grid grid-cols-[2.2rem_minmax(0,1fr)_auto] gap-x-1 font-extrabold">
          <span>{tr("IDADI")}</span>
          <span>{tr("BIDHAA")}</span>
          <span className="text-right">{tr("KIASI")}</span>
        </div>
        <hr className="border-0 border-t border-dashed border-black" />
        <div className="space-y-1">
          {bill.invoices.flatMap((inv) => inv.lines.map((l, idx) => (
            <div key={`${inv._id}-${idx}`} className="grid grid-cols-[2.2rem_minmax(0,1fr)_auto] gap-x-1 break-inside-avoid tabular-nums">
              <span>{number(l.qty)}</span>
              <span className="break-words [overflow-wrap:anywhere]">{l.name}</span>
              <span className="text-right">{number(l.lineTotal)}/=</span>
            </div>
          )))}
        </div>
        <hr className="border-0 border-t border-dashed border-black" />
        {Number(bill.totals.discount) > 0 && <div className="flex justify-between"><span>{tr("Punguzo")}</span><span>-{number(bill.totals.discount)}/=</span></div>}
        {Number(bill.totals.tax) > 0 && <div className="flex justify-between"><span>{tr("Kodi")}</span><span>{number(bill.totals.tax)}/=</span></div>}
        <div className="flex justify-between text-sm font-extrabold">
          <span>{isInvoice ? tr("Jumla ya invoice") : tr("JUMLA INAYODAIWA")}</span>
          <span>{number(bill.totals.total)}/=</span>
        </div>
        {bill.totals.paid > 0 && (
          <>
            <div className="flex justify-between">
              <span>{tr("Imelipwa")}{bill.paymentMethods.length > 0 ? ` (${bill.paymentMethods.join(", ")})` : ""}</span>
              <span>{number(bill.totals.paid)}/=</span>
            </div>
            <div className="flex justify-between font-extrabold">
              <span>{tr("Deni lililobaki")}</span>
              <span>{number(bill.totals.outstanding)}/=</span>
            </div>
          </>
        )}
        <hr className="border-0 border-t border-dashed border-black" />
        {!isInvoice && (
          <div className="space-y-3 pt-2">
            <div className="flex items-end gap-1"><span>{tr("Mteja")}</span><span>:</span><span className="flex-1 border-b border-black" /></div>
            <div className="flex items-end gap-1"><span>{tr("Maelezo")}</span><span>:</span><span className="flex-1 border-b border-black" /></div>
            <hr className="border-0 border-t border-dashed border-black" />
          </div>
        )}
        {bill.paymentInfo && bill.paymentInfo.length > 0 && (
          <div className="space-y-0.5 text-center">
            {bill.paymentInfo.map((line: string) => <p key={line} className="break-words">{line}</p>)}
          </div>
        )}
        {bill.receiptFooter?.trim() && (
          <p className="whitespace-pre-wrap break-words text-center font-extrabold">{bill.receiptFooter}</p>
        )}
      </article>
    </div>
  );
}
