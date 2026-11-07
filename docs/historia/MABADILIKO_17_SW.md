# MABADILIKO 17

## 1. Sales Invoice haiandikwi tena "BILI"
- Kichwa cha invoice (kwenye skrini ya Sales: invoice iliyohifadhiwa na ile iliyochaguliwa kwenye orodha, pamoja na uchapishaji na ujumbe wa WhatsApp) sasa kinaandika **jina la idara** ya invoice.
- Kama biashara haina idara, kinaandika **Sales**.
- Mstari wa "Idara: …" haujirudii tena kwenye invoice, na "Jumla ya bili" imekuwa "Jumla ya invoice".
- Skrini ya **Bills** haijabadilika (bado inaandika BILI).
- Faili: `src/components/BillSheet.tsx` (kigezo kipya `kind="invoice"`), `src/pages/sales/InvoiceEntry.tsx`.

## 2. Maintenance: kadi mpya "Clear Data File"
Njia: Maintenance > Data Management > **Clear Data File** (`/maintenance/clear-data`).

- Orodha ya makundi ya kuchagua (au "Chagua zote"):
  - **Sales Invoices**: invoices na mistari yake, malipo ya wateja, sales returns (namba ya invoice inaanza upya)
  - **Purchases**: manunuzi, purchase orders, GRN, malipo ya suppliers, purchase returns, historia ya bei (namba zinaanza upya)
  - **Suppliers**
  - **Customers**
  - **Stock**: stock movements, adjustments, na idadi ya bidhaa zote inakuwa 0
  - **Products**: bidhaa, groups, units
  - **Transaction Files**: journal entries, expenses, capital receipts, bills za gharama; salio la accounts linakuwa 0
  - **Audit Logs**
- Chini yake kuna sehemu ya **Password ya Super Admin**. Seva inaithibitisha upya (si kivinjari). Password ikiwa si sahihi, hakuna kinachofutwa na jaribio linaandikwa kwenye Audit Trail.
- Kuna ujumbe wa uthibitisho wa mwisho unaotaja makundi na jina la biashara.
- Inafuta data ya **biashara iliyochaguliwa tu** (idara zote za biashara hiyo). Biashara nyingine haziguswi. Super Admin lazima awe ameingia kwenye biashara.
- Kundi la Audit Logs linafutwa mwisho, na kumbukumbu ya kitendo hiki yenyewe inabaki.
- Dashboard inahesabiwa upya yenyewe baada ya kufuta.
- Faili: `convex/maintenance.ts` (`clearData`, `clearStepBatch`, `clearDataOverview`...), `convex/stats.ts` (`requestRebuild`), `src/pages/maintenance/DataPages.tsx` (`ClearDataPage`), `page.tsx`, `src/lib/i18n-dict-superadmin.ts`, jaribio jipya `convex/clearData.test.ts`.

## Tahadhari
- Kufuta hakurudishwi. Pakua Backup kwanza (Backup and Restore).
- HR/Payroll/Attendance na mipangilio ya kampuni, watumiaji na roles **havifutwi**.

## Uthibitishaji
`tsc -b` na `tsc -p convex` safi, `vite build` imefanikiwa, majaribio 73 yanapita (mapya 4). Hatua ya password (`retrieveAccount`) haiwezi kuigwa na `convex-test`, kwa hiyo jaribu mara moja kwenye deployment ya majaribio: password mbaya inakataliwa, sahihi inafuta.
