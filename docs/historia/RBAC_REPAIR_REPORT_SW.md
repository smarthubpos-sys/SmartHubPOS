# Ripoti ya marekebisho ya Role & Permissions (2026-10-17)

## Chanzo halisi (kimethibitishwa kwa tests)
1. **Cashier wa zamani hakuwa na `sales.view`.** Default ya zamani ya Cashier ilikuwa `["sales.manage"]` tu. Row ya role iliyohifadhiwa wakati huo (bila `knownKeys`) haikupata `sales.view`/`sales.print` zilizoongezwa baadaye, kwa hiyo `sales:recentInvoices` ilikataa. Test ilizalisha kosa lile lile: `Forbidden: permission "sales.view" required`.
2. **Skrini za kawaida zilitumia query ya reports.** `SalesRegister` (payments, clients list, totals) na `SalesClients` ziliita `sales:salesRegisters` inayohitaji `sales.reports.view`.
3. **Legacy profile migration ilipoteza vizuizi.** `users:updateCurrentUser` ilihamisha role/tenant/branch pekee; `ownDataOnly`, `menuAccess`, `extraPermissions`, `branchIds`, `allDepartments`, `requirePasswordChange` vilipotea (mtumiaji alikuwa anapata access pana kuliko aliyopewa).

## Mabadiliko
- `convex/permissions.ts`: `sales.view` na `sales.print` kwenye `LATE_PERMISSIONS` (row za zamani zisizo na `knownKeys` tu hupata default; role zilizohifadhiwa kwa makusudi baadaye hazipanuliwi).
- `convex/sales.ts`: `salesRegisters` imegawanywa; logic moja (`buildSalesRegister`) inatumika na `salesRegisters` (`sales.reports.view`, data kamili) na `salesRegisterBasic` mpya (`sales.view`, bila lines/cost/profit/supplier/staff). Tenant, branch na `ownDataOnly` vinatumika kwa zote mbili.
- `convex/users.ts`: migration sasa inabeba vizuizi vyote.
- `src/pages/sales/SalesRegister.tsx`: `reports/*` -> `salesRegisters`; nyingine -> `salesRegisterBasic`.
- `src/pages/sales/SalesClients.tsx`: -> `salesRegisterBasic`.
- `convex/rolePermissions.test.ts`: tests 18 mpya.
- Backup ya faili za awali: `rbac-backup-20261017/`.

## Permission matrix (kutoka config halisi)
| Role | Ruhusa |
|---|---|
| Super Admin | zote (bypass); `stock.adjust` na role management ni zake |
| Admin | zote isipokuwa `maintenance.roles`, `stock.adjust` |
| Manager | sales (+reports, void), stock, store, purchasing, payroll, accounts, bills.all_departments, company, periods, audit; hana `maintenance.users/roles` |
| Accountant | `accounts.manage`, `suppliers.view`, `maintenance.periods`, `maintenance.audit.view` |
| Cashier | `sales.view`, `sales.manage`, `sales.print` |
| Waiter / Waitress | **hakuna** (uamuzi wa awali, MABADILIKO_26); hufunguliwa kwa Role Management |
| Custom | kile kilichohifadhiwa kwenye role |

## Matokeo
- Tests: 35 files, 206 passed (154 za awali + 18 mpya + frontend).
- Lint: `eslint . --max-warnings=0` safi. Build: `tsc -b && vite build` imefaulu.
- Hakuna commit/push/deploy; hakuna data iliyobadilishwa; schema haikubadilishwa.

## Hatari zilizobaki
- Jedwali la `roles` ni la mfumo mzima (halina `tenantId`): kubadilisha role "cashier" kunaathiri biashara zote. Ni Super Admin pekee anayeweza kwa default.
- Role iliyohifadhiwa kwa makusudi bila `sales.view` (yenye `knownKeys`) haitarekebishwa kiotomatiki; angalia Maintenance > Roles.
- Accountant hana `accounts.view` / `accounts.reports.view`, wakati `accounting.listAccounts/listJournals/trialBalance` hukagua module tu (si ruhusa). Imeripotiwa, haijabadilishwa; inahitaji uamuzi wako.
- `clients.upsert` inahitaji Manager: Cashier hawezi kuongeza mteja kwenye Sales Clients.
- `convex/tsconfig` ina makosa 2 ya zamani (`new Error(msg, { cause })` kwenye `maintenance.ts` 553 na 563); hayazuii build wala runtime.
- Zip ina `.env*` na `jwt_private_key.pem` (haviko kwenye git). Usivipeleke/usivishiriki.

## Kabla ya production
1. Deploy backend (Convex) kwanza, kisha frontend.
2. Angalia Maintenance > Roles: Cashier ana `sales.view`.
3. Jaribu kwa akaunti halisi ya Cashier: Sales Clients, Receive Payment, Invoice Entry; na uthibitishe Reports zinakataa.
4. Amua ruhusa za Waiter/Waitress na Accountant.

---
# Nyongeza (2026-10-17): Accountant, Waiter, Waitress

Faili: `convex/permissions.ts`, `convex/dashboard.ts`, `convex/tenants.ts`, `convex/accounting.ts`, `convex/sales.ts`, `convex/clients.ts`, `src/pages/dashboard/page.tsx`, `convex/rolePermissions.test.ts`. Backup: `rbac-backup-20261017-b/`.

| Role | Ruhusa mpya (default) |
|---|---|
| Accountant | accounts.view/manage/reports.view/print/export; sales.view/print/export/reports.view; purchasing.view/print/export/reports.view; suppliers.view; stock.view/print/export/reports.view; payroll.reports.view/print/export; maintenance.periods; maintenance.audit.view. Hana: sales.manage/edit/void, stock.manage/adjust, purchasing.manage/edit/delete, payroll.manage, accounts.approve, maintenance.users/roles |
| Waiter, Waitress | sales.view, sales.manage, sales.print. Hawana reports, export, edit, void, stock, purchasing, accounts, payroll |

Mapengo mengine yaliyohitajika ili hili lifanye kazi kwa usalama:
- Dashboard ya biashara (manunuzi, deni la suppliers, thamani ya stock) ilikuwa wazi kwa kila mtumiaji asiye "own data only". Sasa ni ya Manager/Admin na wenye ruhusa ya reports; wengine wanapata dashboard binafsi.
- `accounting.listAccounts/listJournals/trialBalance` zilikagua module tu; sasa zinahitaji `accounts.view`.
- `sales.invoiceDetails` haitoi tena `costAtSale` kwa wasio Manager/wenye reports.
- `clients.upsert`: seller (sales.manage) anaweza kuongeza mteja MPYA tu (opening balance 0, credit "block"); kuhariri mteja kunabaki kwa Manager.

Tahadhari: defaults hizi zinatumika kwa role ambazo hazijawahi kuhifadhiwa kwenye Maintenance > Roles. Role iliyohifadhiwa tayari production (waiter, waitress, accountant) inabaki na chaguo lake hadi Super Admin aibadilishe.
Tests: 36 files, 212 passed. Lint safi. Build imefaulu.
