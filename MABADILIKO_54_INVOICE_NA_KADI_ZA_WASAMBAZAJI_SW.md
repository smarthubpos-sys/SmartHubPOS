# Mabadiliko 54 — Sababu ya invoice kutopatikana + kadi za wasambazaji kwenye Purchasing

## 1. Invoice haipatikani kwa cashier mwenye ruhusa ya edit/cancel
**Chanzo (kimethibitishwa kwa majaribio):** ruhusa ya `sales.edit` / `sales.void` haibadilishi *wigo wa idara*. Cashier wa idara moja haoni:
- invoice ya **idara nyingine** (mfano yuko Bar, invoice ni ya Kitchen);
- invoice ya **zamani isiyo na idara** (iliandikwa kabla idara hazijawekwa);
- invoice za watumiaji wengine, kama akaunti yake ina **"own data only"** (staff mode).
Skrini ilisema tu "Hakuna invoice iliyopatikana", bila sababu.

**Kilichobadilika:** utafutaji sasa unasema sababu halisi na hatua ya kuchukua, mfano:
> Invoice INV-00002 ipo, lakini ni ya idara "Kitchen" na wewe uko idara "Bar". Badilisha idara kwenye menyu ya juu kisha utafute tena.

Sababu zinazoonyeshwa: idara nyingine (na kama anaweza kubadilisha idara), invoice isiyo na idara, akaunti haijaunganishwa na idara, na staff mode. Hakuna maudhui ya invoice yanayotolewa, na biashara nyingine haivuji.

**Sheria za usalama hazijabadilika.** Kama unataka cashier aone invoice za idara zote, mpe "Idara zote" kwenye Users. Kama invoice za zamani zisizo na idara zinahitajika, zifunguliwe na msimamizi mwenye idara zote.

## 2. Kadi za wasambazaji na malipo (Purchasing)
Juu ya ukurasa wa Purchasing (kwa wenye ruhusa ya `purchasing.reports.view`):
- **Tunadaiwa jumla** (na idadi ya wasambazaji) → Outstanding Supplier
- **Zilizopitiwa na muda** (kulingana na masharti ya malipo ya msambazaji) → Outstanding Supplier
- **Manunuzi mwezi huu** → Purchase by Supplier
- **Malipo mwezi huu** (na idadi ya malipo) → Purchase Payment Report
- **Wasambazaji wanaodaiwa** → Supplier Statement
- Orodha mbili: **Tunaowadai zaidi** (5) na **Malipo ya karibuni** (5).
Kila kadi ikibonyezwa inaenda kwenye ripoti husika. Hesabu ni zile zile za Supplier Balances (opening + manunuzi − malipo − returns), na majaribio yanathibitisha zinalingana.

## Faili
Mapya: `convex/invoiceSearchHint.test.ts`, `convex/supplierSummary.test.ts`, `src/pages/purchasing/SupplierCards.tsx`, `src/lib/i18n-dict-finder.ts`, `src/lib/i18n-dict-supplier-cards.ts`.
Yaliyobadilika: `convex/sales.ts` (query `invoiceSearchHint`), `convex/purchaseReports.ts` (query `supplierSummary`), `src/pages/sales/InvoiceFinder.tsx`, `src/pages/purchasing/page.tsx`, `src/pages/layout/_components/ModuleMenu.tsx` (inapokea `children`), `src/lib/i18n.ts`.
Hakuna mabadiliko ya schema. Deploy ya Convex inahitajika kwa queries mpya.
