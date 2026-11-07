# MABADILIKO 19 — Njia nyingi za malipo, njia za malipo zinazohaririwa, utafutaji wa supplier

## 1. Malipo ya invoice moja kupitia njia nyingi
Mteja anayedaiwa 30,000 sasa analipa kwenye risiti MOJA kwa mfano 10,000 simu + 10,000 bank + 10,000 cash.
- **Sales → Payment Received (Pokea Malipo):** chagua invoice, kisha kwenye "Njia za malipo" bonyeza **＋ Ongeza njia ya malipo** kwa kila njia. Kila mstari una njia, kiasi na reference (hiari). Kitufe cha **Jaza kilichobaki** kinajaza deni lililobaki kwenye mstari huo. Skrini inaonyesha "Jumla inayopokelewa" na "Kilichobaki"; jumla ikizidi deni inazuiwa.
- **Risiti:** inaonyesha njia zote, mfano `Cash 10,000 + M-Pesa 10,000 + CRDB 10,000`.
- **Purchasing:** utaratibu uleule kwenye **Supplier Payment**, na kwenye **Purchase Entry** (malipo ya papo hapo wakati wa kupokea bidhaa).
- **Ndani ya mfumo:** kila njia inahifadhiwa kama malipo yake (inaonekana kwenye Sales/Purchase Payment Report kwa jina la njia), zote zikiwa na `receiptNo` moja. Invoice inasasishwa mara moja (paid/partial) na kila njia inapata journal yake.
- Mbinu ya zamani (kiasi kimoja + njia moja) bado inafanya kazi.

## 2. Njia za malipo zinazohaririwa na kuongezwa
- **Maintenance → Njia za Malipo** (ukurasa mpya): ongeza Lipa Namba 3, benki 4, n.k. Kila njia ina jina (linaloonekana kwenye risiti), aina (Cash / Mobile Money / Bank / Cheque / Card / Nyingine), namba ya akaunti au Lipa Namba, jina la akaunti.
- Unaweza **kuhariri, kuzima (haitaonekana kwenye fomu), kufuta, na kupanga mpangilio** (juu/chini) ili zinazotumika sana ziwe mwanzo.
- Biashara mpya: mara ya kwanza ukifungua ukurasa huu mfumo unaunda Cash / Bank / Mobile Money ili uhariri. Kabla ya hapo, fomu za malipo zinatumia hizo tatu.
- Kufuta au kubadilisha jina hakuathiri historia: kila malipo yanahifadhi jina la njia.
- Njia za kila biashara/idara zinaonekana kwa biashara hiyo tu. Zimeongezwa kwenye Backup.
- Mameneja tu ndio wanaweza kuongeza/kuhariri.

## 3. Supplier — tafuta kwa jina
- **Supplier Management:** kisanduku cha utafutaji juu ya orodha (jina, code au simu).
- **Purchase Entry:** uchaguzi wa supplier ni sanduku la kuandika: andika sehemu ya jina, orodha inapungua; chagua kwa kubonyeza au Enter (mishale juu/chini inafanya kazi).
- **Purchase Reports:** kichujio cha supplier kinatumia sanduku hilohilo.

## Faili
`convex/paymentMethods.ts` (mpya), `convex/sales.ts`, `convex/purchasing.ts`, `convex/schema.ts` (jedwali `paymentMethods` + `receiptNo`/`paymentMethodId` hiari kwenye malipo), `src/components/PaymentSplit.tsx`, `src/components/SearchSelect.tsx`, `src/lib/payment-split.ts`, `src/hooks/use-payment-methods.ts`, `src/pages/maintenance/PaymentMethodsPage.tsx`, na tafsiri Kiingereza `src/lib/i18n-dict-payments.ts`.

## Uthibitishaji
`tsc -b` safi, `vite build` imefanikiwa, majaribio **93** yanapita (13 mapya: njia za malipo, malipo 10,000+10,000+10,000 kwenye invoice ya 30,000, kukataa kuzidi deni / njia iliyozimwa / njia ya biashara nyingine, supplier split, utafutaji). Skrini hazijajaribiwa kwenye kivinjari halisi hapa.

## Muhimu kujua
- **Uhasibu:** malipo yote bado yanaingia kwenye akaunti moja ya "Cash and equivalents" (1000), kama awali. Njia nyingi zinaonekana kwenye ripoti za malipo, lakini hazina akaunti zake tofauti (benki, mobile) kwenye ledger. Hilo ni hatua ya pili ukitaka.
- **Invoice mpya (Invoicing):** malipo ya papo hapo wakati wa kuuza hayajabadilika (invoice inahifadhiwa na deni, malipo yanapokelewa kupitia Pokea Malipo, kama ilivyokuwa).
- Baada ya kuweka zip hii, endesha `npx convex dev` (au deploy) ili jedwali jipya la `paymentMethods` liundwe.
