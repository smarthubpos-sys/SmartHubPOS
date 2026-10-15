# SmartHubPOS

SmartHubPOS POS and business management application. See `REMEDIATION_REPORT_SW.md` for the source-review findings, changes made, and remaining release blockers. See `docs/MULTI_OFFICE_IMPLEMENTATION.md` for the current multi-office implementation notes.

## Development

1. Configure `.env.local` with the real `VITE_CONVEX_URL` from your Convex deployment. OIDC settings are not used; username/password auth runs through Convex Auth.
2. Install dependencies with `npm install`.
3. Run `npm run dev` for local development.
4. Before release, run `npm run build`, `npm run lint`, and `npm test`.

Do not use with real financial or customer data until all release blockers in `REMEDIATION_REPORT_SW.md` are resolved and verified.


## Initial administrator provisioning (username/password)

Set the exact username that will create the initial administrator before running the first sign-up flow:

```powershell
npx convex env set SUPER_ADMIN_USERNAME your-admin-username
```

Replace `your-admin-username` with the username you choose. The initial sign-up screen only accepts that configured username. The first SmartHubPOS application profile is promoted to `super_admin` only when its username matches this setting. Other accounts cannot self-register through this initial setup flow. Do not expose deployment credentials. The current account-management UI should be reviewed/extended before onboarding additional staff accounts.

## Tenant/branch data scope

New product, product-group, unit, client, supplier, invoice, purchase and selected operational records support optional tenant and branch ownership fields. Product/client/supplier reads and updates enforce server-side ownership for assigned users. Legacy records without ownership fields are intentionally hidden from non-Super-Admin users rather than being shared implicitly. The full application still requires additional tenant/branch enforcement across every transaction table and workflow before production use; see `REMEDIATION_REPORT_SW.md`.

## Automatic accounting integration (phase update)

The following Convex mutations now create their stock/payment records and the associated ledger posting in the same mutation, so a failed journal validation aborts the whole operation:

- `sales.createInvoice`: cash received, receivables, sales revenue, tax payable, COGS and inventory relief.
- `sales.recordPayment`: cash against receivables; duplicate user-supplied payment references are rejected within the tenant/branch scope.
- `purchasing.receivePurchase`: inventory against cash paid and accounts payable.
- `inventory.adjust`: valued stock gain or shrinkage against inventory.
- `payroll.approvePayroll`: gross payroll expense against net wages payable and deductions payable.
- `payroll.markPayrollPaid`: settlement of net payroll payable against cash.
- `accounting.profitAndLoss` and `accounting.balanceSheet`: date-filtered reports from posted journal lines.

System accounts are created per tenant/branch when first needed (1000 cash, 1100 receivables, 1200 inventory, 2000 payables, 2150 tax payable, 2200 payroll payable, 2300 deductions payable, 4000 revenue, 5000 COGS, 5100 stock adjustment gain, 5200 shrinkage expense, 6000 payroll expense). Review the chart-of-accounts mapping with the accountant before live use. Tax treatment and statutory payroll deduction allocation must be configured and verified for the applicable jurisdiction.

**Verification status:** `tsc -b`, `npm run lint`, `npm test` (all tests) and `vite build` pass locally. The deployed Convex schema/functions still need a test on a separate Convex deployment with synthetic data before production.

## Security notes

- Never commit private keys. `*.pem` is git-ignored. If a `jwt_private_key.pem` was ever shared or committed, generate a new key pair, set `JWT_PRIVATE_KEY` and `JWKS` in the Convex environment, and delete the file (this signs everyone out).
- A user flagged `requirePasswordChange` is refused by the server on every call except changing the password.

## Goods received (GRN)

Confirming a GRN adds stock and posts Dr Inventory (1200) / Cr Goods received not invoiced (2050). Cancelling it reverses both. When the supplier invoice arrives, enter it in Purchase Entry **only for goods that were not already received through a GRN**, otherwise stock is counted twice; the 2050 balance is then cleared against Accounts payable by the accountant with a manual journal.
