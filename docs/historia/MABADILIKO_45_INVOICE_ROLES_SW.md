# Mabadiliko 45 — Invoice zifichwe hadi zitafutwe + Manager aone role zote

1. `src/pages/sales/SalesRegister.tsx`: orodha ya invoice (Invoice Report, na Sold Item Report ukizima Items Report) imefichwa; inaonekana ukitafuta tu kwa namba.
2. `src/pages/sales/InvoiceFinder.tsx`: ukitafuta na ikapatikana invoice moja, panel ya Chapisha / Edit / Delete-Cancel inafunguka yenyewe; kuna maelezo wakati hujatafuta.
3. `src/pages/maintenance/UsersPage.tsx`: manager anaona role zote za biashara kwenye fomu ya Users. Role zilizo juu ya ruhusa zake zimewekwa alama "(juu ya ruhusa zako)"; server bado inazikataa (hakuna kupandisha cheo).

Haijaendeshwa npm test/tsc (hakuna node_modules hapa). Syntax imekaguliwa tu. Endesha: npm test, npx tsc -b, npm run lint.

## Ulinzi wa Super Admin (nyongeza)
4. `convex/maintenance.ts` (`assertCanAssign`, inatumika na createUser na updateUser): hakuna anayeweza kupandishwa kuwa Super Admin, hata na Super Admin mwenyewe. Akaunti ambayo tayari ni Super Admin inaweza kuhifadhiwa na role ile ile.
5. `convex/users.ts` (`updateCurrentUser`): akaunti mpya haipewi tena Super Admin kwa sababu tu hakuna Super Admin active. Ni `SUPER_ADMIN_USERNAME` pekee; login ya biashara kamwe. Kama `SUPER_ADMIN_USERNAME` haijawekwa kabisa (setup ya kwanza), akaunti ya kwanza ya kimataifa ndiyo inapata.
6. `src/pages/maintenance/UsersPage.tsx`: chaguo la "Super Admin" halitokei tena kwa watumiaji wapya; linaonekana tu ukihariri akaunti ambayo tayari ni Super Admin.
7. `convex/superAdminGuard.test.ts`: tests 3 mpya (hazijaendeshwa hapa).

## Manager hierarchy + Invoice Finder kwenye Sales menu (nyongeza 2)
8. `convex/maintenance.ts`: Manager mwenye `maintenance.users` anasajili/anasimamia Accountant, Cashier, Waiter, Waitress, Viewer; hawezi kutoa wala kugusa Administrator/Owner/Super Admin (`assertCanAssign`, `assertNoEscalation`, `assertCanManageTarget`, `listAssignableRoles`). Role nyingine (custom) bado zinafuata sheria ya "si zaidi ya ruhusa zako". `convex/users.ts` haikuhitaji mabadiliko (ina `updateCurrentUser` tu; ulinzi wa Super Admin wa kuingia uliwekwa awali).
9. `convex/sales.ts` (`searchInvoices`): inatafuta kwa namba, na ikikosa, kwa jina/code/simu ya mteja (herufi 3+); upeo invoice 20; biashara/idara yake tu.
10. `src/pages/sales/page.tsx` + `InvoiceFinderPage.tsx` + `invoice-finder-helpers.ts`: tile ya "Invoice Finder" kwenye Sales menu (kwa wenye `sales.view`) na route `/sales/invoice-finder`.
11. `src/pages/sales/InvoiceFinder.tsx`: maandishi ya utafutaji (namba au jina la mteja).
12. Tests: `convex/managerHierarchy.test.ts`, `convex/invoiceFinderAccess.test.ts`, `src/pages/sales/InvoiceFinder.test.ts` (zimeongezwa). HAZIJAENDESHWA hapa.
