# MABADILIKO 55 — Lugha moja kila mahali (English / Kiswahili)

- Kamusi mpya `src/lib/i18n-dict-complete.ts`: maneno/sentensi 615 zilizokuwa zinabaki Kiswahili ukihifadhi English (Purchasing, Warehouse/Production, Selling Point, Cashier, Bills, Clear Data, User Settings, risiti za malipo, makosa ya server).
- `tr()` sasa inatumika ndani ya vipengele vya pamoja (`page-kit`: kichwa, maelezo madogo, label, hint, vichwa vya jedwali) na ripoti (`ReportTable`): kichwa, maelezo, seli za maandishi, CSV, Excel, Print na Email.
- Barua pepe ya ripoti inatumwa kwa lugha ya mfumo (`lang`).
- Maandishi yanayohifadhiwa na server (maelezo ya ledger/malipo) yanatafsiriwa yanapoonyeshwa.
- Risiti/WhatsApp (Benki, Akaunti, Mteja, Meza, JUMLA), hali za Bills, ujumbe wa toast/confirm: zimefungwa na `tr()`.
- Jaribio jipya: `src/lib/i18n-complete.test.ts`. tsc safi; vitest 94+1 faili zimepita.

Kikomo kinachojulikana: rekodi za zamani zilizohifadhiwa na server kwa Kiswahili zinatafsiriwa tu kama zinalingana na sentensi iliyomo kwenye kamusi.
