/** The cashier's remembered choice "print a payment receipt" (shared by money received from waiters and by counter sales). */
export const PRINT_RECEIPT_KEY = "smarthub-print-payment-receipt";

export function readPrintReceiptChoice(): boolean {
  try { return localStorage.getItem(PRINT_RECEIPT_KEY) === "1"; } catch { return false; }
}
