# MABADILIKO 21 — Kasi ya mfumo na kuchapisha ripoti

## 1. Kuchapisha ripoti (Sales report na ripoti zote zenye jedwali)
- Tatizo: kitufe cha **Print** kwenye ripoti kilikuwa kinatumia `window.print()`, ambayo huchapisha ukurasa mzima (dashboard, menyu, vichwa).
- Sasa kinachapisha **ripoti husika tu** kupitia `printElement` (`src/lib/print-area.ts`), kwenye fremu isiyoonekana: kichwa cha ripoti, tarehe ya kuchapisha, jedwali kamili na mstari wa JUMLA. Karatasi ni A4 (landscape ikiwa ripoti ina safu zaidi ya 6). Kichwa cha jedwali kinajirudia kila ukurasa.
- Inahusu ripoti zote zinazotumia `ReportTable` (Sales, Stock, Payroll). Print ya **labels za barcode** (Stock) nayo imerekebishwa kwa njia hiyo hiyo.

## 2. Mfumo mzito / sehemu zinakaa "inapakia"
- **Kurasa zinapakiwa kwa mahitaji (lazy loading)**: awali kila ukurasa (Sales, Stock, Payroll, Accounts, n.k.) ulipakiwa wote wakati wa kufungua mfumo. Sasa kila moduli inapakiwa unapoifungua tu (`src/app.tsx`, `Applayout.tsx`); menyu inabaki na kinazunguka kinaonekana wakati ukurasa unapakiwa.
- **Ripoti za Sales**: query ya `salesRegisters` ilikuwa inasoma mistari ya bidhaa ya kila invoice (na bidhaa, group, unit, supplier) hata kwa ripoti zisizoihitaji (Invoices, Summary, Payments, Tax, By Client, Staff, Source, Statement, orodha ya wateja, Invoice Entry). Sasa mistari inasomwa tu kwa ripoti za bidhaa (Analysis, By Product, Client/Product, Sold Items, By Supplier) kupitia kigezo kipya `withLines`.

## 3. Ukaguzi wa mwisho (marekebisho ya ziada)
- **JUMLA ilipotea kwenye ripoti ukiweka mfumo kwa English**: safu za kujumlishwa zilitafsiriwa lakini majina ya safu hayakutafsiriwa, hivyo hazikulingana. Sasa zinalingana kwa lugha zote mbili (`ReportTable`, inahusu ripoti zote za Sales/Stock/Payroll).
- **Hitilafu ya ukurasa mmoja haizimi mfumo mzima**: kurasa sasa zimefungwa kwenye `ErrorBoundary` ndani ya layout; menyu inabaki, na ukihamia ukurasa mwingine hitilafu inaondoka bila kupakia upya.
- **Stock Register** ilikuwa inasoma invoices zote tangu mwanzo; sasa inasoma za kipindi kilichochaguliwa tu (kupitia index ya tarehe).

## 4. Supplier Register: suppliers hawaonekani / huwezi kuongeza mpya
Sababu zilizopatikana kwenye msimbo na kurekebishwa (`convex/suppliers.ts`):
- **Supplier code ilikuwa ya kipekee kwa biashara ZOTE**: ukiweka code ambayo biashara nyingine imeshatumia (au ukaiacha wazi mara ya pili) ilikataliwa na "already exists". Sasa ni ya kipekee ndani ya biashara moja tu, na ukiiacha wazi inajazwa yenyewe (SUP-0001, SUP-0002...). Ujumbe wa kosa sasa unaonyesha supplier anayeitumia.
- **Suppliers walifungwa kwenye idara moja**: supplier aliyehifadhiwa idara moja hakuonekana kwenye nyingine, na kuhifadhi kulihitaji kuchagua idara. Sasa suppliers ni wa biashara nzima (orodha, malipo, manunuzi na ripoti zinatumia hivyo).
- **Suppliers wa zamani wasio na biashara** (waliohifadhiwa kabla ya mfumo wa biashara nyingi) hawaonekani kwa mtu yeyote. Super Admin akichagua biashara, juu ya Supplier Register inaonekana kitufe "Wahamishie biashara hii" kinachowaunganisha na biashara hiyo.
- Majaribio mapya: `convex/suppliers.test.ts`.

## 5. Stock Register na lint
- Stock Register (ripoti za Stock, Dashboard ya Stock, Movements, Summary) sasa zinasoma movements za kipindi tu kupitia index mpya `by_tenant_date`; salio la kuanzia = stock iliyopo − movements za kuanzia tarehe hiyo. Skrini za bidhaa pekee (Products, Groups, Barcodes, Expiry, Reorder, Prices, Out of stock) hazisomi movements kabisa. Skrini za **Quantity / Item Quantity** zinaendelea kusoma historia yote ili kulinganisha stock na movements. Kuna index mpya kwenye schema: `npx convex dev` itaijenga.
- Lint: yamerekebishwa `crons` (dakika 22:07 badala ya saa kamili), `Reports.tsx` (vigezo visivyotumika) na `ExpensesPage.tsx` (dependency). Yaliyobaki (348 `any`, 202 `db.get` bila jina la table, 4 `set-state-in-effect`, 14 `only-export-components`) ni uboreshaji wa aina/mtindo, si hitilafu za utendaji.

## Uthibitishaji
`tsc -b` safi. `vite build` na majaribio (`vitest`) **havikuweza kuendeshwa hapa** (binaries za `node_modules` ni za Windows). Endesha `npm run build` na `npm test` kwako.

## Muhimu
- Zip hii haina `node_modules` wala `dist`: endesha `npm install`, kisha `npx convex dev` (au deploy) ili `withLines` ipakiwe, kisha `npm run build`.
- Ikiwa ukurasa fulani bado unakaa "inapakia" baada ya hapo, nitumie jina la ukurasa huo (mf. Stock → Stock Register) ili nikague query yake. Ninashuku `stockRegisters` na `listMovements` (zinasoma stock movements zote tangu mwanzo) ndizo zitakazofuata.
