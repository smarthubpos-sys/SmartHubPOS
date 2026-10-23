import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { MessageCircle, Printer } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Empty } from "@/components/page-kit.tsx";
import { formatDate, formatNumber } from "@/lib/format.ts";
import { buildReceiptHtml, printElement, type Paper } from "@/lib/print-area.ts";
import { printHtmlViaQz } from "@/lib/printers.ts";
import { shouldSchedulePrint } from "@/lib/print-policy.ts";
import { tr } from "@/lib/i18n.ts";

/**
 * The bill itself. `printToken` > 0 opens the browser print dialog once the data is ready.
 * `kind="invoice"` (used by Sales) uses the department name as the heading instead of "BILI"; with no department it says "Sales".
 */
export default function BillSheet({ invoiceIds, printToken, paper, whatsappEnabled, setWhatsappEnabled, kind = "bill" }: { invoiceIds: Id<"invoices">[]; printToken: number; paper: Paper; whatsappEnabled: boolean; setWhatsappEnabled: (value: boolean) => void; kind?: "bill" | "invoice" }) {
  const bill = useQuery(api.customerBills.billData, { invoiceIds });
  const printed = useRef(0);
  const articleRef = useRef<HTMLElement>(null);
const settings = useQuery(api.maintenance.getSettings, {});
const hardware = (settings?.app?.hardware ?? {}) as {
  printerSource?: string;
  receiptPrinter?: string;
};

  const myPerms = useQuery(api.maintenance.myPermissions, {});
  const canPrint = !!myPerms?.includes("sales.print");

  const printReceipt = async () => {
    const el = articleRef.current;
    if (!el) return;

    if (hardware.printerSource === "installed" && hardware.receiptPrinter?.trim()) {
      try {
        await printHtmlViaQz(
          hardware.receiptPrinter,
          buildReceiptHtml(el, paper),
        );
        return;
      } catch (error) {
        console.error("QZ Tray printing failed; using browser print.", error);
      }
    }

    printElement(el, paper);
  };

  useEffect(() => {
    if (settings === undefined) return;
    if (!shouldSchedulePrint({ dataReady: !!bill, allowed: canPrint, token: printToken, lastPrinted: printed.current })) return;

    const t = window.setTimeout(() => {
      if (printed.current === printToken) return;
      printed.current = printToken;
      void printReceipt();
    }, 150);

    return () => window.clearTimeout(t);
  }, [bill, canPrint, printToken, paper, settings, hardware.printerSource, hardware.receiptPrinter]);

  if (bill === undefined) return <Empty>{tr("Inapakiaâ€¦")}</Empty>;
  const dp = bill.company.decimalPlaces;
  const m = (n: number) => `${bill.company.currencySymbol} ${formatNumber(n, dp)}`;
  const number = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 2);
  const isInvoice = kind === "invoice";
  const heading = isInvoice ? (bill.department?.trim() || "Sales") : tr("BILI");
  const whatsappText = [
    `${bill.company.name || "Biashara"} â€” ${heading}`,
    `${tr("Mteja")}: ${bill.client.name}`,
    ...bill.invoices.flatMap((inv) => [`${tr("Invoice")} ${inv.invoiceNo} (${formatDate(inv.date)})`, ...inv.lines.map((l) => `${l.name} Ã— ${number(l.qty)} = ${m(l.lineTotal)}`), `${tr("Jumla ya invoice")}: ${m(inv.total)}`]),
    `${isInvoice ? tr("Jumla ya invoice") : tr("Jumla ya bili")}: ${m(bill.totals.total)}`,
    `${tr("Imelipwa")}: ${m(bill.totals.paid)}`,
    `${tr("Deni lililobaki")}: ${m(bill.totals.outstanding)}`,
  ].join("\n");
  const rawPhone = (bill.client.phone || "").replace(/[^\d]/g, "");
  // Normalize Tanzanian local mobile numbers for wa.me (e.g. 0712... -> 255712...).
  const phone = rawPhone.startsWith("00") ? rawPhone.slice(2)
    : rawPhone.startsWith("0") ? `255${rawPhone.slice(1)}`
    : rawPhone.startsWith("255") ? rawPhone
    : rawPhone;
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText)}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2 print:hidden">
        <label className="mr-auto flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><input type="checkbox" checked={whatsappEnabled} onChange={(e) => setWhatsappEnabled(e.target.checked)} />{tr("Washa kutuma bili WhatsApp")}</label>
        {whatsappEnabled && phone && <Button variant="outline" onClick={() => window.open(whatsappUrl, "_blank", "noopener,noreferrer")}><MessageCircle className="mr-1 h-4 w-4" />{tr("Tuma bill WhatsApp")}</Button>}
        {canPrint && <Button onClick={() => { void printReceipt(); }}><Printer className="mr-1 h-4 w-4" />{tr("Chapisha")}</Button>}
      </div>
      <article ref={articleRef} data-paper={paper} className={`print-area mx-auto space-y-4 rounded-2xl border bg-card p-6 text-sm print:rounded-none print:border-0 print:p-0 ${paper === "A4" ? "max-w-3xl print:max-w-none" : paper === "58mm" ? "max-w-[58mm]" : "max-w-[80mm]"}`}>
        <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
          <div>
            <h2 className="text-lg font-bold">{bill.company.name || tr("Biashara")}</h2>
            {!isInvoice && bill.department && <p className="text-xs text-muted-foreground">{tr("Idara")}: {bill.department}</p>}
            {bill.company.address && <p className="text-xs">{bill.company.address}</p>}
            {(bill.company.phone || bill.company.email) && <p className="text-xs">{[bill.company.phone, bill.company.email].filter(Boolean).join(" Â· ")}</p>}
            {bill.company.taxId && <p className="text-xs">TIN: {bill.company.taxId}</p>}
          </div>
          <div className="text-right">
            <h3 className="text-xl font-bold tracking-wide">{heading}</h3>
            <p className="text-xs">{tr("Tarehe")}: {bill.savedAt ? `${formatDate(bill.savedAt.slice(0, 10))} ${new Date(bill.savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : formatDate(new Date().toISOString().slice(0, 10))}</p>
            {bill.cashier && <p className="text-xs">{tr("Muuzaji")}: {bill.cashier}</p>}
          </div>
        </header>

        <section>
          <p className="text-xs uppercase text-muted-foreground">{tr("Mteja")}</p>
          <p className="font-semibold">{bill.client.name}</p>
          {bill.client.phone && <p className="text-xs">{bill.client.phone}</p>}
          {bill.client.address && <p className="text-xs">{bill.client.address}</p>}
        </section>

        {bill.invoices.map((inv) => (
          <section key={inv._id} className="break-inside-avoid">
            <div className="mb-1 flex justify-between font-semibold"><span>{tr("Invoice")} {inv.invoiceNo}{inv.department && bill.department?.includes(" + ") ? ` Â· ${inv.department}` : ""}</span><span>{formatDate(inv.date)}</span></div>
            <table className="w-full text-left">
              <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-1">{tr("Bidhaa")}</th><th className="py-1 text-right">{tr("Idadi")}</th><th className="py-1 text-right">{tr("Bei")}</th><th className="py-1 text-right">{tr("Jumla")}</th></tr></thead>
              <tbody>
                {inv.lines.map((l, idx) => (
                  <tr key={idx} className="border-b border-dashed">
                    <td className="py-1">{l.name}</td><td className="py-1 text-right">{number(l.qty)}</td><td className="py-1 text-right">{m(l.unitPrice)}</td><td className="py-1 text-right">{m(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1 space-y-0.5 text-right text-xs">
              {inv.discount > 0 && <p>{tr("Punguzo")}: -{m(inv.discount)}</p>}
              {inv.taxAmount > 0 && <p>{tr("Kodi")}: {m(inv.taxAmount)}</p>}
              <p className="text-sm font-semibold">{tr("Jumla ya invoice")}: {m(inv.total)}</p>
            </div>
          </section>
        ))}

        <footer className="ml-auto max-w-xs space-y-1 border-t pt-3">
          <div className="flex justify-between"><span>{isInvoice ? tr("Jumla ya invoice") : tr("Jumla ya bili")}</span><span className="font-bold">{m(bill.totals.total)}</span></div>
          <div className="flex justify-between"><span>{tr("Imelipwa")}{bill.paymentMethods.length > 0 ? ` (${bill.paymentMethods.join(", ")})` : ""}</span><span>{m(bill.totals.paid)}</span></div>
          <div className="flex justify-between border-t pt-1 text-base font-bold"><span>{tr("Deni lililobaki")}</span><span>{m(bill.totals.outstanding)}</span></div>
        </footer>
        {bill.receiptFooter?.trim() && <p className="pt-2 text-center text-xs text-muted-foreground whitespace-pre-wrap break-words">{bill.receiptFooter}</p>}
      </article>
    </div>
  );
}


