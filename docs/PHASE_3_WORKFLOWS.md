# SmartHubPOS operational workflows implemented in this phase

## Implemented in source
- Sales invoice posting validates client/product scope, quantity, price, discount and tax; checks stock; writes invoice lines; reduces inventory; writes stock movement and initial payment in the same Convex mutation.
- Customer payments validate invoice ownership and outstanding amount and update invoice payment state.
- Inventory adjustments require manager role, a reason and non-negative quantity; write both adjustment and stock movement records and an audit log.
- Purchase receiving validates supplier/product scope and quantities; increases stock only on receiving, updates weighted-average cost and price history, and records supplier payment.
- Accounting manual journal posting validates active account scope, unique reference and balanced debit/credit; posted journal entries cannot be silently edited by these functions. Account creation is scoped to the current business.
- Sales now automatically posts cash/receivables, revenue, tax payable, cost of goods sold and inventory relief in the same Convex mutation as invoice creation and stock deduction. Later customer payments post cash against receivables; a supplied duplicate payment reference is rejected.
- Receiving a purchase now posts inventory against cash and supplier payable in the same mutation as receiving stock and recording the purchase.
- Stock quantity adjustments post inventory against a stock gain or shrinkage expense when the adjustment has a non-zero value.
- Payroll approval posts gross payroll expense against net payroll payable and deductions payable; marking an approved payroll paid posts the cash settlement.
- Added date-scoped Profit & Loss and as-of-date Balance Sheet ledger queries.
- Payroll employee creation, payroll calculation using an explicitly configured deduction percentage, approval and paid status workflows are implemented. The system does not assume statutory tax rates; an authorised operator must enter verified rates.
- Sales, stock, purchasing, payroll and accounting module menus now open operational forms and recent-record tables instead of the generic Coming Soon page.

## Important verification limitations
Dependencies could not be installed in this environment within the available time, so TypeScript build, lint, Vitest, and live Convex schema deployment have not been verified. Deploy schema changes to a non-production Convex deployment first, regenerate Convex API types using `npx convex dev`, and test with synthetic tenants/branches before production. Existing legacy accounting rows without tenant/branch IDs will not automatically be visible to tenant-scoped users; migrate/assign them deliberately before rollout. Payroll deduction percentages are configuration inputs, not a claim of statutory compliance. Automatic journal generation is implemented for the listed core sale, payment, purchase receipt, valued stock adjustment and payroll approval/payment flows, but must still be verified in a deployed isolated Convex environment. Returns, tax/statutory deduction mapping, bank reconciliation, closing entries, reversal workflows and end-to-end accounting tests remain to be completed before claiming full accounting compliance.
