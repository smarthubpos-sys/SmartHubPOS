# SmartHubPOS — Purchasing work in progress

This working package includes the first implementation pass for the agreed Purchasing scope:

- Purchase Entry supports multiple item lines in one invoice, adding/removing lines, decimal quantity/cost inputs, totals, and one save action.
- Purchase invoice numbers are generated as 1, 2, 3... per tenant/branch sequence (without zero padding).
- Supplier Management includes Add/Modify Supplier, Supplier Payment, and a date-filtered supplier statement view.
- Supplier ledger query aggregates posted purchases, payments, and posted returns; it displays product, unit, quantity, unit cost and line total where available.
- Supplier payments allocate to oldest outstanding purchase balances; excess is tracked as a supplier credit through the ledger calculation and journal posting.
- A purchase summary report query is available for date range and supplier filters.

## Validation note

A full `npm run build` was attempted. TypeScript reported existing dependency/type errors in `src/components/providers/auth.tsx` (`oidc-client-ts` missing and two implicit-any parameters). The purchasing TypeScript changes themselves did not produce further errors in that run. This package is not yet a claim that all 14 Purchasing menu items have been completed; Orders, GRN, Returns and the remaining dedicated reports still require implementation and end-to-end testing before Purchasing can be called finished.

Security: `.env.local`, private key files, `node_modules`, and build output are intentionally excluded from this ZIP. Keep your deployment secrets private and preserve your local environment files separately.
