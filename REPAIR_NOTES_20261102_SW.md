# Marekebisho ya ziada — 02 Novemba 2026

Marekebisho yaliyofanywa kutokana na ripoti ya tests ya 16:22:

1. Dashboard (`convex/dashboard.ts`)
   - Cards na graph sasa hukokotoa mauzo, makusanyo, manunuzi na idadi ya invoices kutoka records halisi za invoices, customer payments, waiter collections na purchases.
   - Cancelled invoices/purchases na voided customer payments hazihesabiwi.
   - Dashboard haiwezi kuonyesha takwimu za idara nyingine kwa mtumiaji aliyefungiwa idara.

2. Department isolation (`convex/access.ts`)
   - Mtumiaji mwenye departmentsActive=true na ambaye bado hajachagua idara anaona business-level records tu.
   - Hali hii inatumika pia kwa Super Admin pale anapokuwa ndani ya biashara iliyochaguliwa; bila biashara iliyochaguliwa picker bado inaona biashara zote.

3. Direct user permissions (`convex/access.ts`, `convex/maintenance.ts`)
   - Ruhusa halali za moja kwa moja sasa zinahesabiwa kwenye effective permissions, si zile za legacy short-list pekee.
   - Kutoa accounts/payroll/stock/purchasing permission kunaongeza module husika kwenye menuAccess, ikiwa biashara inaruhusu module hiyo.

4. Manager-only screens (`convex/accounting.ts`, `convex/payroll.ts`)
   - Accounts na Payroll sasa zinaheshimu `accounts.manage` / `payroll.manage` kwa custom users, bila kuhitaji role ya Manager pekee.
   - Trial Balance inahitaji `accounts.view`, kulingana na permission ya kuangalia accounts.

5. Role defaults (`convex/permissions.ts`)
   - Accountant default haina tena `dashboard.view`.

Marekebisho ya awali ya supplierId na MODULE_MANAGE_PERMISSION yamehifadhiwa.

TAHADHARI YA UTHIBITISHO:
- Mazingira haya hayana `node_modules`, kwa hiyo `npm test`, `npm run build` na `npm run lint` hazijaendeshwa tena hapa.
- Hii ni ZIP ya marekebisho ya source, si release iliyothibitishwa. Usii-push wala ku-deploy Production kabla ya commands zote tatu kupita kwenye PC yako.
