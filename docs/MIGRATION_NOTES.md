# Migration notes for this release

All schema changes are **additive and optional** - existing documents stay valid and no data rewrite is required.

| Table | Change |
|---|---|
| `warehouseMovements` | + optional `quantityLost`, `reason`, `idempotencyKey`; + index `by_tenant_key` |
| `stockTransfers` | + optional `idempotencyKey`, `closedBy`, `closedAt`, `closeReason`; status may now be `cancelled` / `rejected`; + index `by_tenant_key` |
| `stockTransferLines` | + optional `damagedQuantity` |

Existing transfers keep working. Transfers already `received` before this release with a smaller received quantity have **no** `transfer_loss` ledger row (the earlier code did not write one), so `warehouses.reconcile` still balances but the loss report will not show them.

## Behaviour changes to tell your staff about
- Read screens now check the action permission on the server, not just that the module is switched on. A role that could previously open a screen only because its module was enabled may now be refused. Check Role Management: `accounts.view`, `accounts.reports.view`, `stock.view`, `purchasing.view`, `purchasing.reports.view`, `purchasing.edit` (edit screens), `payroll.view` (HR / attendance), `sales.view` or `sales.manage` (bills and receipts), `sales.print` (print buttons).
- Notifications about stock and bills are shown only to users with `stock.view` / `accounts.view`.
- Usernames can be changed from Maintenance -> Users (not for your own account, not for Super Admin). The login key and profile change together; the password is untouched.

## Deploy order
1. Export a backup (see `BACKUP_RECOVERY.md`).
2. Deploy to a dev deployment first: `npx convex dev --once`, run the app, check roles.
3. Then production: `npx convex deploy`, followed by the Vercel build.
