# Lipoti la kazi — SmartHubPOS (2026-10-24, muda ulioruhusiwa: dakika 10)

Kazi ilisimamishwa kwa mujibu wa agizo la muda. Ni sehemu ndogo tu ya Task 1 iliyokamilika; Tasks 2, 3 na 4 HAZIJAFANYWA upya katika kipindi hiki.

## Kilichofanyika

### Task 1 — Mauzo ya siku (sehemu)
Uchunguzi wa msimbo (convex/dashboard.ts, convex/stats.ts, convex/sales.ts, src/lib/format.ts, convex/plans.ts):
- Kadi ya "Today's Sales" inasoma jedwali la `statsDaily` (jumla ya `invoice.total`, yaani mauzo baada ya punguzo na kodi), inayosasishwa na `bumpStats` kwenye createInvoice (+), void (-), na return (-). Kila invoice inahesabiwa mara moja; invoice zilizobatilishwa na marejesho zinaondolewa; kichujio cha tenant/branch kipo.
- **Chanzo cha tatizo kilichothibitishwa (tarehe):** seva inahesabu "leo" kwa saa za Afrika Mashariki (`tzToday()` = UTC+3), lakini kivinjari kilitumia saa za kifaa (`localDate()` kwa `getTimezoneOffset`). Kifaa chenye saa tofauti na EAT kiliomba tarehe isiyo sahihi (na kuandika `invoiceDate` isiyo sahihi), hivyo jumla ya leo haikulingana na mauzo halisi karibu na usiku wa manane.
- **Urekebishaji:** `src/lib/format.ts` — `localDate()` sasa inatumia UTC+3 (Africa/Dar_es_Salaam) kama seva. Jaribio jipya: `src/lib/format.test.ts` (mpaka wa siku saa 00:00 EAT, na offset ya siku).

### Majaribio
- `vitest run`: faili 43 zimepita (zikiwemo jaribio jipya la format). 
- `tsc -b`: ilikuwa bado inaendeshwa muda ulipokwisha — HAIJATHIBITISHWA. `npm run build` na `npm run lint` HAZIJAENDESHWA.

## Matokeo ya uchunguzi ambayo HAYAJAREKEBISHWA (yanahitaji uamuzi wako)
1. **"Cash Received" inaandikwa kwa tarehe ya invoice, si tarehe ya malipo:** `recordPayment` (convex/sales.ts ~mstari 423) inaita `bumpStats` kwa `invoice.invoiceDate`, na `rebuild` (convex/stats.ts ~mstari 184) inatumia `i.amountPaid` kwa tarehe ya invoice. Deni la jana likilipwa leo, fedha inaonekana jana, si leo. Suluhisho sahihi: kuhesabu `collected` kutoka `customerPayments` kwa `paymentDate` (index `by_tenant_date` ipo), pamoja na void/return kurekebisha kwa tarehe za malipo husika, na kusasisha rebuild. Haikufanyika kwa sababu inabadilisha hesabu za fedha na inahitaji majaribio makini.
2. Dashibodi haitenganishi bado: mauzo ya jumla (gross), punguzo, marejesho, mauzo halisi (net), fedha taslimu, na madeni — kadi ya sasa inaonyesha `total` baada ya punguzo na kodi.
3. Majaribio mahususi ya Task 1 yaliyoombwa (invoice iliyobatilishwa, marejesho, punguzo, mauzo ya mkopo, kuhesabu mara mbili, branch isolation) hayajaongezwa; baadhi yapo kwenye salesVoid/salesReturn/statsRebuild/departmentIsolation tests zilizopo.

## Hazijaanzwa / hazijakamilika
- **Task 2:** foleni ya cashier, orodha ya waiter, muhtasari wa mauzo/madeni, historia ya invoice na reprint, ruhusa — haikuchunguzwa kwa kina wala kubadilishwa kipindi hiki. Maelezo ya awali tu: `waiterOrders.list` inachuja kwa `tenantId` + `branchId` ya mtumiaji, hivyo cashier na waiter wa branch tofauti hawataonana; cashier huona oda za `pending` tu.
- **Task 3 (Kiswahili kote):** haijaanza.
- **Task 4 (risiti, bold, footer, malipo):** haijaanza.

## Hali ya mabadiliko
- Faili zilizobadilishwa/kuongezwa na kazi hii: `src/lib/format.ts`, `src/lib/format.test.ts`, `LIPOTI_KAZI_32_SW.md`.
- Hakuna commit, hakuna push, hakuna deploy (dev wala production). Hakuna data wala backup iliyofutwa.
- Hakuna mipangilio ya mmiliki wa biashara inayohitajika kwa mabadiliko haya.

---
# Awamu ya 2 (dakika 10 za pili) — "Cash Received" kwa tarehe ya malipo

## Kilichorekebishwa
- **Chanzo:** fedha zilizokusanywa ziliandikwa kwenye `statsDaily` kwa tarehe ya invoice, si tarehe ya malipo; `rebuild` ilitumia `amountPaid` ya invoice.
- `convex/sales.ts`: `recordPayment` sasa inaandika `collected` kwa `paymentDate`; `voidInvoice` inarudisha `collected` kwa siku ya kila malipo; `salesReturn` inaondoa fedha iliyorejeshwa kwa `returnDate`. Mauzo (`sales`), madeni na idadi ya invoice bado ni kwa tarehe ya invoice.
- `convex/stats.ts`: `rebuild` ina hatua mpya `payments` inayohesabu `collected` kutoka `customerPayments` kwa `paymentDate` (malipo yaliyobatilishwa hayahesabiwi; marejesho ni safu hasi). Hesabu ya `collected` kutoka invoice imeondolewa.
- Jaribio jipya: `convex/statsRebuild.test.ts` (malipo ya leo kwa invoice ya zamani yanaonekana leo; ya zamani yanabaki siku yake; malipo yaliyobatilishwa yanapuuzwa).

## Matokeo
- `vitest run`: faili 43 zimepita. `tsc -b`: imepita (exit 0). `build` na `lint` hazijaendeshwa.

## Tahadhari / hatua ya mmiliki
- Data ya zamani yenye `amountPaid` bila safu za `customerPayments` (kama ipo) haitahesabiwa kwenye "Cash Received" baada ya rebuild. Baada ya kupeleka, endesha rebuild ya takwimu (dev kwanza) na ulinganishe jumla na ripoti ya malipo.

## Bado hazijafanyika
Task 1: mgawanyo wa gross/punguzo/marejesho/net kwenye kadi na majaribio ya ziada; Tasks 2, 3, 4 kama ilivyoelezwa hapo juu. Hakuna commit/push/deploy.

---
# Awamu ya 3 (dakika 10) — Task 2: orodha ya wahudumu kwa cashier

## Kilichofanyika
- **Uchunguzi wa foleni ya oda:** mtiririko wa waiter → cashier tayari upo (`placed` → `pending` kwa Send; cashier huona `pending` tu kwa reactive query; `markHandled` inazuia kuchakata mara mbili; stock haipunguzi kwenye place/send/print/accept). Haukubadilishwa.
- **Pengo lililorekebishwa:** `markHandled` (cashier kupokea/kuchapisha oda) haikuandika audit log. Sasa inaandika `accept_waiter_order` (`convex/waiterOrders.ts`).
- **Mpya `convex/waiterDirectory.ts` (kusoma tu):**
  - `list`: wahudumu (waiter/waitress) wa biashara na tawi la mtumiaji tu; utafutaji kwa jina/username. Waiter mwenyewe amekatazwa (server-side).
  - `summary`: kwa mhudumu na kipindi (leo / siku 7 / siku 30 / tarehe maalum) — idadi ya invoice, zilizofutwa, mauzo halisi, punguzo, kilicholipwa, mauzo ya mkopo, madeni ya wateja (si deni la mhudumu), malipo kwa njia, na oda kwa hali. Mhudumu wa biashara/tawi lingine anakataliwa.
- **UI:** `src/pages/waiter-orders/WaiterDirectory.tsx` (Kiswahili) inaonekana chini ya skrini ya Waiter Orders kwa cashier/meneja/admin.
- `convex/_generated/api.d.ts` imesasishwa kwa mkono kusajili `waiterDirectory` (itasasishwa yenyewe `convex dev` ikiendeshwa).
- **Majaribio mapya:** `convex/waiterDirectory.test.ts` (utenganisho wa biashara, utafutaji, hesabu za muhtasari, kukataliwa kwa waiter na biashara nyingine).

## Matokeo
- `vitest run`: faili 44 zimepita. `tsc -b`: imepita. `eslint` kwenye faili zilizoguswa: safi. `vite build`: imefaulu. `lint` ya mradi mzima haijaendeshwa.

## Bado hakijafanyika kwenye Task 2
- Kuona/kufungua invoice za mhudumu, historia ya malipo na reprint ya risiti kutoka kwenye orodha hii.
- Cashier kurekodi malipo ya deni kutoka kwenye orodha hii (kuna mtiririko uliopo wa malipo kwenye Sales).
- Utafutaji kwa staff ID (hakuna uwanja wa staff ID kwenye `users`).
- Mgawanyo wa marejesho kwenye muhtasari; jaribio la real-time la oda hadi cashier kwa pande zote.
- Tasks 3 na 4 hazijaanza. Hakuna commit/push/deploy.

---
# Awamu ya 4 (dakika 10) — Task 2: invoice, malipo na kuchapisha tena kwa mhudumu

## Kilichofanyika
- `convex/waiterDirectory.ts`: `invoices` (invoice za mhudumu kwa kipindi, utafutaji kwa namba ya invoice au mteja) na `invoicePayments` (historia ya malipo ya invoice). Zote ni za kusoma tu, na zinakagua seva-upande: si waiter, biashara sawa, tawi sawa, invoice ni ya mhudumu.
- `src/pages/waiter-orders/WaiterDirectory.tsx`: jedwali la invoice, historia ya malipo na kuchapisha tena kupitia `BillSheet` iliyopo (inasoma invoice asili; haitengenezi mauzo, haipunguzi stock, haurekodi malipo). Invoice zilizofutwa zinaonekana kwenye orodha lakini hazichapishwi tena (`billData` inazikataa).
- Majaribio: `waiterDirectory.test.ts` imeongezwa (utafutaji, malipo, kukataliwa kwa biashara nyingine, na deni halibadiliki kwa kuangalia).

## Matokeo
- `vitest run`: tazama hapo chini; `tsc -b` imepita; eslint ya faili zilizoguswa safi; `vite build` umefaulu.

## Bado hakijafanyika kwenye Task 2
- Kurekodi malipo ya deni kutoka kwenye orodha hii (mtiririko wa Sales > Payments upo; haujaunganishwa hapa).
- Utafutaji kwa staff ID (hakuna uwanja huo). Marejesho kwenye muhtasari. Kuhakiki kwa jaribio la UI kwamba oda inafika kwa cashier real-time.
- Kuchapisha tena hakujajaribiwa kwa printer halisi/QZ Tray. Task 3 na 4 hazijaanza. Hakuna commit/push/deploy.

---
# Awamu ya 5 (dakika chache) — Task 4 (sehemu): taarifa za malipo kwenye risiti

## Kilichofanyika
- Sehemu ya "Maandishi ya chini ya risiti" tayari ilikuwepo (Mipangilio > System, tenant-scoped, inatumika kwenye BillSheet na risiti). Nimeongeza sehemu za hiari: mtoa huduma wa pesa za simu + namba, jina la benki, jina la akaunti, namba ya akaunti, na maelekezo ya malipo (`src/pages/maintenance/SettingsPages.tsx`).
- `convex/customerBills.ts` (`billData`) inasoma sehemu hizo kutoka mipangilio ya biashara hiyo tu na kurudisha `paymentInfo`; `src/components/BillSheet.tsx` inachapisha mistari iliyojazwa tu (bold ndogo), sehemu tupu hazionekani. Kuchapisha tena kunatumia footer ya sasa ya biashara na data asili ya invoice.
- `convex/maintenance.ts`: uthibitisho wa seva kwa funguo za `system` (aina ya maandishi na urefu: footer 500, simu 40/30, benki 60/80/40, maelekezo 300). Kuhariri kunahitaji ruhusa `maintenance.system` (meneja amekataliwa kwenye jaribio).
- Jaribio: `convex/customerBills.test.ts` (mistari iliyosanidiwa tu, tupu hazionekani, urefu uliozidi unakataliwa, meneja asiye na ruhusa anakataliwa).

## Matokeo
- `vitest`: faili zote zimepita (tazama jumla hapo juu kwenye uendeshaji wa mwisho); `tsc -b` imepita; eslint ya faili zilizoguswa safi; `vite build` umefaulu.

## Bado hayajafanyika kwenye Task 4
- Kuongeza herufi nzito (bold) kimkakati na kuhakiki mpangilio wa 58mm/80mm kwa printa halisi; `TransactionReceipt.tsx` na njia nyingine za kuchapisha (mfano oda ya mhudumu) hazijaguswa na taarifa mpya za malipo.
- Footer yenye mistari mingi (sehemu ni ya mstari mmoja), onyesho la awali (preview) kabla ya kuhifadhi, na footer tofauti kwa tawi.

## Matokeo ya uchunguzi kwa Task 3 (hayajarekebishwa)
- Kuna uharibifu wa encoding (mojibake) kwenye baadhi ya ujumbe wa seva, mfano ujumbe wa urefu wa password/session timeout kwenye `convex/maintenance.ts` (maandishi kama "8Ã¢â‚¬â€œ64"). Hii inahitaji ukaguzi wa mradi mzima; haijafanyika.
- Ukaguzi wa maandishi ya Kiingereza yaliyobaki haujafanyika.
