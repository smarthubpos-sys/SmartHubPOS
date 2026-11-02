# Marekebisho ya Accounts Reports na Purchasing

## Accounts
- Added a dedicated financial report page for each Accounts report route instead of sending all report routes to the generic module workspace.
- General Ledger now reads posted journal lines with account, reference, date, debit and credit.
- Trial Balance uses the report permission.
- Profit & Loss and Trading Account use the income-statement query.
- Balance Sheet uses the balance-sheet query.
- Cash Flow reports posted movements on cash, bank and mobile-money accounts.
- Receivables and Payables show outstanding posted invoices/purchases grouped by customer/supplier.
- Accounts List shows the chart of accounts.

## Purchasing
- Purchase Entry now lists active products in one table; enter received quantity and unit cost only for products received. Blank/zero quantities are skipped.
- Supplier selection is optional. If omitted, the backend records the purchase against a scoped system supplier named `Unassigned / Cash Purchase`, preserving the existing required supplier relationship and supplier ledger.
- Payment mode supports Credit, Partial Payment and Paid. Backend calculates amount paid, outstanding and payment status from the submitted payment splits; paid mode requires full payment and partial mode requires a positive amount below the invoice total.
- Stock is increased only for submitted product rows.

## Verification status
- Static source review completed.
- Build/tests could not be completed because this ZIP does not include `node_modules`; `tsc -b` stops on missing Node/Vite/Vitest type packages. Run `npm ci`, then `npm run build`, `npm run lint`, and `npm test` in the repository before deployment.
- No Git push and no Production deployment were performed.
