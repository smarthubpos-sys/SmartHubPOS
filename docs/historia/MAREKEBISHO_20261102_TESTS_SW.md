# Marekebisho ya tests 13 + tsc + lint — 02 Novemba 2026

1. `convex/access.ts` (`requireActiveUser`): `departmentsActive` sasa inawekwa TU kwa staff (cashier, viewer, roles zisizo-manager) asiyechagua idara.
   Owner/Admin/Manager na Super Admin aliyeingia kwenye biashara wanaona jumla ya idara zote wasipochagua idara (kama tests zinavyotarajia).
   Hii ilisababisha tests 11 kati ya 13: customerBills (4), departmentIsolation, invoiceFinder, tenants (trial balance), waiterCollections (4).
2. `convex/customerBills.ts` (`crossAccess`): mtumiaji mwenye `bills.all_departments` sasa anapewa `allDepartments: true` kwenye `wide`.
3. `convex/ledger.ts`: `isMoneyAccount` sasa ni type guard -> inaondoa 2 TS18048 kwenye `accounting.ts:62`.
4. `convex/maintenance.ts` ~1310: `let belongs: boolean;` (inaondoa no-useless-assignment).
5. `src/pages/sales/InvoiceFinder.tsx`: `CANCEL_REASONS` na `editedTotals` zimeondolewa (zinatoka `invoice-finder-helpers.ts`); test imesasishwa. Inaondoa 2 react-refresh warnings.

HAIJAENDESHWA: mazingira haya hayana node_modules wala mtandao. Endesha kwenye PC yako: npm test, npx tsc -b, npm run lint, npm run build.
