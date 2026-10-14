# MABADILIKO 24 — Marejesho ya sehemu ya bidhaa + Ripoti ya Siku/Mwezi/Mwaka kwa idara

## 1. Marejesho ya sehemu ya bidhaa (Sales > Invoicing)
Kitufe kipya **Rejesha bidhaa (sehemu)** (meneja pekee) karibu na "Batilisha invoice iliyochaguliwa".
Chagua invoice, weka kiasi kinachorudishwa kwa kila bidhaa (au "Zote"), sababu, tarehe, kisha Hifadhi.

Kinachotokea (kila kitu ndani ya muamala mmoja; kikikosea hakuna kinachohifadhiwa):
- **Stoo**: kiasi kilichorudishwa tu kinarudi (movement `sale_return`).
- **Deni kwanza**: deni la mteja kwenye invoice linapunguzwa kwanza; kilichobaki ndicho kinarudishwa kwa mteja
  kutoka kwenye njia ya malipo uliyochagua (akaunti yake yenyewe), kama malipo hasi (`customerPayments` yenye `-`).
- **Invoice**: subtotal / discount / tax / jumla vinapungua kwa thamani iliyorudishwa; kiasi kilichouzwa kinabaki kwenye mstari
  na `returnedQty` inaonyesha kilichorudi. Ripoti za Sales (By Product, Sold Items n.k.) zinahesabu kilichobaki kuuzwa tu.
  Marejesho ya mwisho yanaisafisha invoice hadi jumla 0 (hali `returned`).
- **Ledger**: Dr Sales returns (akaunti mpya **4100**) + Dr Tax payable; Cr Receivable / Cr akaunti ya pesa; Dr Inventory, Cr COGS.
  Kipindi kilichofungwa kinakataa marejesho.
- Rekodi: `salesReturns` (SR-00001...) + `salesReturnLines`, audit log.
- **Kubatilisha invoice baada ya marejesho ya sehemu** sasa kunarudisha stoo iliyobaki tu (si mara mbili), na kunashughulikia malipo hasi.
- Mfano: invoice 4 × 10,000 + kodi 18% = 47,200, umelipa 20,000. Rejesha 1 → thamani 11,800; deni 27,200 → 15,400; hakuna pesa
  inayotoka. Kama invoice ililipwa yote, 11,800 inarudishwa kwa mteja.

## 2. Ripoti ya Siku / Mwezi / Mwaka kwa idara (Accounts)
- **Accounts > Reports > Ripoti ya Siku / Mwezi / Mwaka** (`/accounts/period-report`).
- **Accounts > Expense Payments**: kipande kipya **Maliza siku** chenye swichi *"Nimemaliza kuingiza matumizi ya siku"*.
  Ukiiwasha, kinatokea kitufe **Unda ripoti ya siku**, kinachokupeleka kwenye ripoti ya leo na kuiunda papo hapo.
- Chaguo: **Siku / Mwezi / Mwaka**, tarehe/mwezi/mwaka, na **Idara: zote au moja** (A, B, C...). Mtumiaji aliyefungwa kwenye idara moja
  anaona idara yake tu. Biashara isiyo na idara inaonyesha "Biashara nzima".
- Idara zote zikichaguliwa: jedwali lina safu ya kila idara + **JUMLA**.
- Muonekano wa kimataifa (karatasi A4, tayari kuchapishwa / kuhifadhi PDF): letterhead ya biashara, kipindi, idara, sarafu;
  kadi 4 za namba kuu; **1. Income Statement** (Mapato, Marejesho, Mauzo halisi, COGS, Gross profit + margin%, Mapato mengine,
  Matumizi kwa kila aina, Net profit/(loss) + margin%; hasi ziko kwenye mabano); **2. Mwenendo wa fedha** kwa kila akaunti ya pesa
  na kwa chanzo (wateja, wasambazaji, bili, mishahara, mtaji...); **3. Taarifa nyingine** (mabadiliko ya madeni, kodi, idadi ya invoices,
  zilizobatilishwa, marejesho); **4. Chati ya mwenendo** (kwa siku kwa mwezi, kwa mwezi kwa mwaka); sehemu ya sahihi
  (Imeandaliwa / Imekaguliwa / Imeidhinishwa) na maelezo ya msingi wa hesabu (accrual).
- **Historia (jedwali jipya `reportRuns`)**: kila ripoti inayoundwa inahifadhiwa (nani, lini, idara, mauzo, matumizi, faida) na
  inaweza kufunguliwa tena kama ilivyokuwa siku ilipoundwa.
- Namba zote zinatoka kwenye ledger (miamala iliyopostiwa), hivyo zinalingana na Profit and Loss: mauzo, marejesho, invoices zilizobatilishwa,
  bili, mishahara na journal za mkono vyote vinahesabiwa.
- Ripoti ya mwezi/mwaka inasomwa kwa vipande vya siku 7 (kipande kikubwa mno kinagawanywa nusu), kwa hiyo mwaka mzima haukwami.
- Maandishi yote yamo kwenye Kiswahili na English (`i18n-dict-periodreport.ts`).

## Faili
Mpya: `convex/reportCore.ts`, `convex/periodReport.ts`, `src/pages/accounts/PeriodReportPage.tsx`, `src/pages/sales/ReturnPanel.tsx`,
`src/lib/i18n-dict-periodreport.ts`, `convex/salesReturn.test.ts`, `convex/reportCore.test.ts`.
Zilizobadilika: `convex/schema.ts` (salesReturns, salesReturnLines, invoiceLines.returnedQty, index `journalEntries.by_tenant_date`, `reportRuns`),
`convex/sales.ts`, `convex/_generated/api.d.ts`, `ExpensesPage.tsx`, `accounts/page.tsx`, `InvoiceEntry.tsx`, `i18n.ts`.

## Uthibitishaji (kuwa wazi)
- Injini ya ripoti (`reportCore.ts`) imejaribiwa kwa kuiendesha hapa: hesabu za mauzo, marejesho, COGS, matumizi, fedha, kuunganisha vipande, tarehe — zote zinapita; `tsc --strict` safi kwa faili hiyo.
- Faili zote zilizobadilika zimepitishwa kwenye ukaguzi wa syntax (hakuna makosa).
- **Haijaendeshwa**: `tsc -b`, `vite build`, `vitest` na Convex halisi — `node_modules` hazikuwemo kwenye zip na hakuna intaneti hapa.
  Majaribio mapya (`salesReturn.test.ts`: marejesho kwa deni, kwa malipo kamili, kuzuia kupita kiasi, meneja pekee, void baada ya marejesho,
  ripoti kutoka ledger, historia) yameandikwa lakini hayajaendeshwa. Endesha: `npm install`, `npx convex dev` (ili schema/index mpya zijengwe), `npm run build`, `npm test`.

## Mipaka inayojulikana
- Ripoti ya fedha inaonyesha **mwenendo** (zilizoingia/zilizotoka), si salio la kuanzia/kufunga: salio linahitaji kusoma historia yote ya akaunti.
- Marejesho yanapokea fedha kwa njia ya kurudisha pesa tu; hakuna "store credit" bado.
- Marejesho ya sehemu kwa **manunuzi (purchases)** hayajaguswa (yana mfumo wake wa `purchaseReturns`).
- Siku moja yenye miamala ya hesabu zaidi ya 1,200 haiwezi kuundiwa ripoti (kikomo cha usalama cha seva).
