# MABADILIKO 35 — Ripoti zinafuata module, bili za wahudumu, mauzo ya counter na risiti ya malipo

## 1. Clear Data File: ukifuta Sales/Purchases/Stock, ripoti zake zote zinafutwa pia
Tatizo: kundi lilifuta jedwali kuu tu, lakini ripoti zinasoma journals, historia ya stock na ripoti za kipindi zilizohifadhiwa, kwa hiyo vitu vilibaki. Sasa (biashara iliyochaguliwa tu):
- **Sales Invoices**: pamoja na hapo, journals za mauzo (sale, sale_return, sale_void, malipo ya wateja, waiter_sale), historia ya stock ya mauzo (sale, sale_return, waiter_order), mistari ya sales returns na ripoti za kipindi zilizohifadhiwa.
- **Purchases**: journals za manunuzi (purchase, GRN, returns, malipo ya suppliers), historia ya stock ya manunuzi na ripoti za kipindi zilizohifadhiwa.
- **Stock**: movements, adjustments, Store/Ghala (stock, transfers, movements), journals za stock na ripoti za kipindi; idadi ya bidhaa inakuwa 0.
- **Transaction Files**: pia ripoti za kipindi zilizohifadhiwa.
Takwimu za dashibodi zinawekwa sifuri papo hapo kama kabla. Biashara nyingine haiguswi. Journals za kuingiza kwa mkono (manual) na za kundi jingine hazifutwi isipokuwa kundi lake lichaguliwe.
Faili: `convex/maintenance.ts` (`journalSources`, `movementTypes`), `convex/clearData.test.ts`.

## 2. Bili za wahudumu hazielekei tena kwa cashier zenyewe
- Kila mtu anaona bili zake mwenyewe tu kwenye skrini ya Bills.
- Mhudumu: chagua oda > **Unda bili** > ndipo vinafunguka **Chapisha bili** na **Tuma kwa cashier**. Ukibadili uchaguzi, lazima uunde bili upya.
- Cashier anaona bili ya mhudumu **baada ya mhudumu kuituma** (inaonyesha jina la mhudumu). Server inakataa kuonyesha au kujumlisha bili ambazo hazijatumwa.
- Hakuna kinachobadilika kwenye stock, malipo wala mauzo.
Faili: `convex/waiterOrders.ts` (`sendBillToCashier`, `billVisible`), `convex/schema.ts` (`billSentAt`, `billSentBy`), `src/pages/waiter-orders/BillsPanel.tsx`.

## 3. Cashier: swichi ya "Mauzo ya counter"
Kwenye ukurasa wa **Cashier** kuna swichi. Ikiwashwa, cashier anauza kwa wateja wake wa counter (chagua bidhaa, njia ya malipo moja au nyingi, **Uza na pokea malipo**). Ikizimwa, anarudi kwenye kupokea fedha za wahudumu. Chaguo linakumbukwa kwa kila mtumiaji kwenye kifaa.
Mauzo ya counter yanafanyika kwa hatua moja salama (`waiterCollections.counterSale`): stock inapungua mara moja, malipo yanarekodiwa, hesabu (journal) na dashibodi zinasasishwa, na hakuna deni la mtu. Kubonyeza mara mbili hakurudufu. Stock isipotosha, kila kitu kinarudishwa nyuma.
Faili: `convex/waiterCollections.ts`, `src/pages/cashier/page.tsx`, `src/pages/waiter-orders/SellingPoint.tsx` (`counter`).

## 4. Risiti ya malipo (hiari)
- Kwenye **Pokea fedha** na kwenye **mauzo ya counter** kuna tiki "Chapisha risiti ya malipo" (inakumbukwa).
- Kwenye "Zilizopokelewa leo" kuna kitufe cha **Chapisha risiti** kuchapa tena.
- Inatumia printer ile ile ya QZ Tray ya Maintenance > Hardware, na nembo/jina/footer ya biashara.
Faili mpya: `src/lib/print-payment-receipt.ts`, `src/lib/print-receipt-choice.ts`.

## Majaribio
`tsc -b` safi, `eslint` safi kwenye faili zilizobadilishwa, `vitest` yote yamepita (majaribio mapya ya Clear Data yamo) yamepita (ikiwemo majaribio mapya ya bili zilizotumwa, mauzo ya counter, ruhusa za module na risiti). Majaribio mawili ya zamani yaliyosema "cashier anaona bili zote za idara" yamebadilishwa kulingana na sheria mpya.
Haijaendeshwa: `vite build`, deploy, na kuchapa kweli kwa QZ Tray (inahitaji printer halisi).

## Hatua
`npx convex dev` (schema ina sehemu mpya) > `npm run build` > deploy.
