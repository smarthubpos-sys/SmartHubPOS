# Printing and receipts

- **Settings:** Maintenance -> Hardware Setup holds paper width (58 mm, 80 mm, A4) and "print receipt automatically after sale".
- **Flow:** the sale is saved first; printing is a separate browser step (`src/lib/print-area.ts`, iframe with only the receipt). A print failure or cancelled dialog never calls the save mutation, so it cannot create a second sale.
- **Auto-print on:** each saved sale produces one new print token; the sheet prints once when its data has loaded (`src/lib/print-policy.ts`). **Off:** token stays 0 and nothing prints. Re-renders and live data updates cannot repeat a print.
- **Manual reprint:** the "Chapisha" button is shown only to users with `sales.print`; auto-print also requires it.
- **Receipt content:** company name/logo/contacts/TIN, invoice number, date and time saved, seller (cashier), customer, lines with quantity/price/discount/total, subtotal, discount, tax, total, paid (with payment methods), balance, footer.
- **Not verified here:** physical printers. The browser dialog is the supported path; silent printing needs QZ Tray (`qz-tray` is a dependency) installed on the till PC with its certificate trusted - install it from qz.io, allow the site in QZ, and test with the Hardware Setup test-print button. Do not assume silent printing works until you have printed on your own device.
- **Tests:** `src/lib/print-policy.test.ts` covers the auto-print decision logic only; no automated test drives a real printer or the browser print dialog.
- **One size for all receipts:** bill, invoice, waiter order and payment receipt share `src/lib/receipt-layout.ts` (text size per paper: 58mm / 80mm / A4 from Hardware Setup). Bills and invoices are built from data in `src/lib/print-bill.ts`, not copied from the screen, so they print at the same large size as the order slip.
