# Lipoti — Selling Point na Cashier (2026-10-25)

Kazi ilisimamishwa kwa mujibu wa agizo la muda (dakika 5). Msimbo wote umeandikwa, LAKINI majaribio na build HAVIJAENDESHWA (angalia "Tatizo kubwa").

## Tatizo kubwa (soma kwanza)
- Zip haikuwa na `node_modules` na mtandao wa sandbox umezimwa, kwa hiyo **`vitest`, `tsc -b`, `eslint` na `npm run build` HAVIJAENDESHWA**. Nilifanya ukaguzi wa syntax tu (TypeScript transpile) kwenye faili zote zilizoguswa: makosa 0. Hiyo si uthibitisho wa types wala wa majaribio.
- Tafadhali endesha kwenye kompyuta yako: `KAGUA_KABLA_DEPLOY.ps1` (npm ci, tsc, eslint, test, build) kabla ya kitu kingine. Usi-deploy hadi ipite. Hakuna deploy iliyofanyika.

## Kilichofanyika
### 1. Selling Point
- "Waiter Orders" imebadilishwa kuwa **Selling Point** (menyu, jina la module kwenye Role/User Settings, kichwa cha ukurasa, mipangilio ya Super Admin). Anwani mpya `/selling-point`; `/waiter-orders` inaelekeza huko.
- Waiter/waitress baada ya kuingia (PIN au password) wanapelekwa moja kwa moja Selling Point. Dashboard imefichwa kwenye menyu, `/dashboard` inawarudisha Selling Point, na seva (`dashboard.getMyDashboard`) inawakataa.
- Skrini mpya `SellingPoint.tsx`: vitufe vya makundi vinatoka kwenye product groups za biashara (`products.listGroups`), tiles kubwa za bidhaa kwa tablet, kugusa = +1, vitufe `+` na `−`, namba ya meza (hiari), vitufe viwili: **Send** na **Print**.

### 2. Stock na usalama wa oda
- Mutation mpya `waiterOrders.submit` (inaunda oda + kupunguza stock + kuiweka Sent/Printed kwa hatua moja). Kila kikapu kina `clientKey`; ombi lile lile likirudiwa (kugusa mara mbili, retry, tab mbili) linarudisha oda ile ile bila kupunguza stock tena.
- Kupunguza stock kunalindwa na bendera `stockDeducted` ndani ya mutation moja (helper `deductStockOnce`). Stock inakaguliwa kwanza kwa bidhaa zote; ikikosa, kila kitu kinarudi nyuma (hakuna oda, hakuna harakati).
- `sendToCashier` na `markPrinted` (mtiririko wa zamani wa "Weka Order") sasa pia vinapunguza stock mara moja tu. `markHandled` (cashier kupokea/kuchapisha) HAIPUNGUZI stock.
- Baada ya mafanikio vitufe vinafungwa na hali inaonekana ("Imetumwa kwa cashier" / "Imechapishwa" + "Stock imepunguzwa mara moja"); kuna kitufe cha "Oda mpya". Kufuta oda (sales.void) kunarudisha stock iliyopunguzwa mara moja.
- Kuchapisha tena (Bills au invoice) ni upande wa kivinjari tu: hakuna mauzo, malipo wala stock.

### 3. Bills
- `waiterOrders.listForBills` (utafutaji kwa meza/jina; waiter anaona zake, cashier anaona za tawi), `billSummary` (jumla ya oda nyingi inahesabiwa na seva kutoka mistari iliyohifadhiwa, oda zilezile hazihesabiwi mara mbili). UI: `BillsPanel.tsx` — oda zimepangwa kwa meza ("Bila meza" kwa zisizo na meza), chagua moja au nyingi, jumla, Chapisha bili.

### 4. Cashier — staff code
- Uwanja mpya `users.staffCode` + mutation `maintenance.setStaffCode` (ya kipekee ndani ya biashara, haijali herufi kubwa/ndogo, inaingia Audit Trail). Kwenye User Settings kuna sehemu mpya "Staff code".
- `waiterDirectory.byStaffCode`: cashier akiandika code anaona jina, mauzo, invoice, bills/oda, malipo kwa kila njia na salio kwa kipindi; biashara na tawi pekee; waiter amekatazwa.
- `StaffSettlement.tsx`: chagua invoice zenye deni, weka malipo yaliyogawanywa (cash + bank + mobile money kwa kutumia `PaymentSplit` na njia za malipo zilizopo). Hesabu ya mgawanyo iko `src/lib/settlement.ts` (oldest first, sent kwa sent, bila makosa ya senti, inakataa malipo yanayozidi deni, reference haitumiki mara mbili). Kila invoice inalipwa kupitia `sales.recordPayment` ILIYOPO (cashier/meneja tu, journal, stats). Kuchapisha tena invoice kunatumia `BillSheet` iliyopo.

## Faili zilizobadilika / kuongezwa
Backend: `convex/schema.ts`, `waiterOrders.ts`, `waiterDirectory.ts`, `maintenance.ts`, `dashboard.ts`, `permissions.ts`, `notifications.ts`.
UI: `src/app.tsx`, `src/pages/layout/Applayout.tsx`, `src/pages/layout/_components/sidebar.tsx`, `src/pages/waiter-orders/page.tsx`, `SellingPoint.tsx` (mpya), `BillsPanel.tsx` (mpya), `StaffSettlement.tsx` (mpya), `src/pages/maintenance/UsersPage.tsx`, `src/pages/super-admin/EditBusinessPanel.tsx`, `src/lib/i18n-dict-import.ts`, `src/lib/settlement.ts` (mpya), `src/lib/i18n-dict-sellingpoint.ts` (mpya), `src/lib/i18n.ts`.
Majaribio: `convex/sellingPoint.test.ts` (mpya), `src/lib/settlement.test.ts` (mpya), `convex/waiterSwitches.test.ts` (nimesasisha madai ya zamani yaliyosema "Send/Print hazipunguzi stock", kwa sababu sheria sasa imebadilika).

## Majaribio
- Yameandikwa: kupunguza mara moja, ufunguo unaorudiwa, kukosa stock (rollback), cashier kupokea mara mbili, mtiririko wa zamani, jumla ya bills nyingi, utengano wa biashara/waiter, staff code (utafutaji, upekee, waiter kukataliwa), Dashboard ya waiter, mgawanyo wa malipo.
- **HAYAJAENDESHWA.** Yanaweza kuhitaji marekebisho madogo ya types au matarajio.

## Mambo yaliyobaki / tahadhari
1. Endesha tsc, eslint, vitest na build (angalia juu).
2. (Imeshughulikiwa awamu ya 3) Settlement ya invoice nyingi sasa ni mutation moja ya Convex (`sales.settleInvoices`) — angalia chini.
3. (Imeshughulikiwa awamu ya 2) Maandishi mapya yameingizwa kwenye kamusi mpya `src/lib/i18n-dict-sellingpoint.ts` (Kiswahili + Kiingereza) na kusajiliwa kwenye `i18n.ts`. Haijaendeshwa `i18n.test.ts`; ikilalamika kuhusu ufunguo uliorudiwa ("Waiter Orders" sasa inaonyesha "Selling Point") litarekebishwe.
4. Jina la mteja halihitajiki tena kwenye Selling Point (chaguo-msingi "Mteja"). Bidhaa zisizo na kundi zinaonekana chini ya "Zote" tu.
5. Kugusa bidhaa isiyo na stock hakuzuiwi kwenye skrini; seva inakataa Send/Print na kueleza stock iliyopo.
6. Oda za zamani zenye `stockDeducted` ya zamani hazibadilishwi. Oda zilizokuwa `pending` kabla ya mabadiliko haya hazikupunguza stock na hazitapunguza baadaye (`markHandled` haipunguzi).
7. Hakuna commit, push wala deploy. Mmiliki aamue kabla ya production.

## Awamu ya 2 (dakika 5)
- Kamusi ya i18n imekamilika (kipengele 3 juu). Settlement ya mutation moja (kipengele 2) HAIJAFANYWA: inahitaji kutoa msimbo wa `recordPayment` kuwa helper ya pamoja, na bila kuweza kuendesha majaribio ni hatari kwa hesabu za fedha; inashauriwa kufanywa baada ya majaribio kupita kwenye kompyuta yako.
- Majaribio/build bado hayajaendeshwa (hakuna `node_modules`/mtandao).

## Awamu ya 3 (dakika 5) — atomic settlement, staff code, encoding
- **Settlement atomic:** `convex/sales.ts` — mantiki ya `recordPayment` imehamishiwa kwenye helper moja `applyCustomerPayment` (tabia ileile: split, journal, salio la invoice, stats); `recordPayment` inaiita tu. Mutation mpya `sales.settleInvoices` (cashier/meneja tu) inaita helper hiyo kwa kila invoice ndani ya transaction MOJA: invoice yoyote ikikataliwa (malipo ya ziada, invoice iliyofutwa, ya mhudumu mwingine, split mbovu), hakuna malipo yoyote yanayorekodiwa. Inakagua: invoice zote ni za mhudumu aliyechaguliwa, hakuna invoice mara mbili, 1–50 invoice; inaandika Audit Trail `staff_settlement`. `StaffSettlement.tsx` sasa inaita mutation hii moja; ujumbe wa kosa unasema "hakuna malipo yaliyorekodiwa".
- **Staff code:** ukaguzi wa upekee unatumia index `by_scope` kwa kiambishi `tenantId` pekee, hivyo unaona idara ZOTE za biashara; msimbo umesafishwa na maelezo yameongezwa. Utafutaji wa cashier unabaki ndani ya idara yake. Jaribio jipya linathibitisha upekee hata watumiaji wakiwa idara tofauti.
- **Encoding:** mistari 16 ya `convex/maintenance.ts` yenye herufi zilizoharibika (`Ã¢â‚¬â€œ` n.k.) imerekebishwa kuwa `–` na `─`; hakuna mistari iliyobaki. Nimetafuta pia faili nyingine za `convex/` na `src/`: hakuna zenye tatizo hilo (backups hazikuguswa).
- **Majaribio mapya (`convex/sellingPoint.test.ts`):** malipo ya invoice mbili kwa split (cash + mobile) — salio, idadi ya malipo na audit sahihi; malipo ya sehemu; invoice moja ikifeli HAKUNA kinachorekodiwa; invoice ya mhudumu mwingine/mara mbili/orodha tupu/asiye cashier zinakataliwa; cashier wa biashara nyingine amekataliwa; settlement haiguzi stock; staff code ya kipekee kati ya idara. Jaribio la "Send/Print kurudiwa haipunguzi stock mara mbili" lipo tangu awamu ya 1.
- Faili zilizoguswa awamu hii: `convex/sales.ts`, `convex/maintenance.ts`, `convex/sellingPoint.test.ts`, `src/pages/waiter-orders/StaffSettlement.tsx`, `src/lib/i18n-dict-sellingpoint.ts`.
- **Bado HAIJAENDESHWA:** tsc, eslint, vitest, build (ukaguzi wa syntax tu, makosa 0). Hatari kuu: refactor ya `recordPayment` na test za idara (`withDepartment`) zinaweza kuhitaji marekebisho madogo. Usi-push hadi `KAGUA_KABLA_DEPLOY.ps1` ipite; `splitPayments.test.ts` iliyopo ni kipimo cha kwanza cha kuhakikisha `recordPayment` haijabadilika tabia.
