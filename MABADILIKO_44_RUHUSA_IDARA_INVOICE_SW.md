# Mabadiliko 44 - Ruhusa za users, idara, invoice (UI + tests imeongezwa; HAIJAJARIBIWA)

Msingi: Mabadiliko 43. Hakuna push wala deployment iliyofanyika.

## Yaliyoongezwa
1. Invoice UI: `src/pages/sales/InvoiceFinder.tsx` - tafuta kwa namba, fungua, chapisha, hariri, futa kabisa AU rekebisha bidhaa/idadi.
   Imeunganishwa kwenye `SalesRegister.tsx` (reports/product-client, by-product, sold-items, invoices).
2. `convex/sales.ts` editInvoice: ukaguzi wa credit limit ya mteja deni likiongezeka.
3. Tafsiri SW/EN: `src/lib/i18n-dict-superadmin.ts` (INVOICING_DICT).
4. Tests mpya: `convex/userAccessGrant.test.ts`, `convex/departmentClear.test.ts`, `convex/invoiceFinder.test.ts`, `src/pages/sales/InvoiceFinder.test.ts`.

## Hali ya uthibitisho
- Syntax ya faili zilizoguswa imekaguliwa kwa TypeScript parser: OK.
- npm install / npm test / npm run lint / tsc -b HAZIJAENDESHWA (mtandao ulizimwa). Tests mpya hazijaendeshwa na zinaweza kuhitaji marekebisho madogo.

## Fanya kabla ya deploy
npm install; npx convex dev (schema mpya); npm test; npm run lint; tsc -b.

## Maelezo
- Prefix ya default ni `INV-` (INV-00001). Kwa 00001 tupu: Maintenance > Document Numbering, prefix tupu.
