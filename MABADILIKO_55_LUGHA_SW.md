# MABADILIKO 55 — Lugha moja kila mahali (English / Kiswahili)

- Kamusi mpya `src/lib/i18n-dict-complete.ts`: maneno/sentensi 615 zilizokuwa zinabaki Kiswahili ukihifadhi English (Purchasing, Warehouse/Production, Selling Point, Cashier, Bills, Clear Data, User Settings, risiti za malipo, makosa ya server).
- `tr()` sasa inatumika ndani ya vipengele vya pamoja (`page-kit`: kichwa, maelezo madogo, label, hint, vichwa vya jedwali) na ripoti (`ReportTable`): kichwa, maelezo, seli za maandishi, CSV, Excel, Print na Email.
- Barua pepe ya ripoti inatumwa kwa lugha ya mfumo (`lang`).
- Maandishi yanayohifadhiwa na server (maelezo ya ledger/malipo) yanatafsiriwa yanapoonyeshwa.
- Risiti/WhatsApp (Benki, Akaunti, Mteja, Meza, JUMLA), hali za Bills, ujumbe wa toast/confirm: zimefungwa na `tr()`.
- Jaribio jipya: `src/lib/i18n-complete.test.ts`. tsc safi; vitest 94+1 faili zimepita.

Kikomo kinachojulikana: rekodi za zamani zilizohifadhiwa na server kwa Kiswahili zinatafsiriwa tu kama zinalingana na sentensi iliyomo kwenye kamusi.

# MABADILIKO 56 — Stock Take: Uza upungufu

- Chini ya jedwali la Stock Take kuna swichi **"Uza upungufu (bei ya kuuzia)"** na orodha ya kuchagua mtumiaji.
- Bidhaa iliyohesabiwa chini ya mfumo (mfano mfumo 12, halisi 10) inauzwa vipande 2 kwa **bei ya kuuzia** kwa mtumiaji uliyemchagua. Inatengeneza oda moja ya Selling Point kwenye akaunti yake; cashier anaipokea kupitia "Pokea fedha za wahudumu".
- Ziada (mfumo 10, halisi 12) haiuzwi: inaongezwa kwenye stock kama adjustment ya kawaida.
- Swichi ikizimwa, kila kitu kinabaki kama kilivyokuwa.
- Kama bidhaa yenye upungufu haina bei ya kuuzia, stock take nzima inakataliwa na hakuna kinachobadilika.
- Faili: `convex/inventory.ts` (`stockTake`, `sellableStaff`), `src/pages/stock/StockTakeValue.tsx`, jaribio `convex/stockTakeSell.test.ts`.
- tsc safi; vitest: faili 96, majaribio 664 yamepita.

# MABADILIKO 57 — Madeni yaliyofungwa (Closed debts)

- Ripoti ya **siku** ikihifadhiwa (Period Report, period = day), oda za wahudumu ambazo hazijalipwa za siku hiyo zinaondoka kwenye "Pokea fedha za wahudumu" (Madeni ya kawaida) na kuhamia **Madeni yaliyofungwa**.
- Cashier bado anaweza kuyapokea kupitia kitufe cha "Madeni yaliyofungwa" kwenye skrini ile ile ya kupokea. Hakuna kinachofutwa wala kuandikwa kama hasara.
- Ripoti inaendelea kuyaonyesha kama deni la mhudumu husika (yamo kwenye jumla ya mauzo).
- Ripoti ya siku ikifutwa (Super Admin), madeni yake yanarudi kwenye Madeni ya kawaida.
- Faili: `convex/schema.ts` (closedAt, closedReportId, index), `convex/periodReport.ts`, `convex/waiterCollections.ts` (closedOwing), `src/pages/waiter-orders/WaiterCollection.tsx`, jaribio `convex/closedDebts.test.ts`.
- tsc safi; vitest: faili 97, majaribio 666 yamepita.
