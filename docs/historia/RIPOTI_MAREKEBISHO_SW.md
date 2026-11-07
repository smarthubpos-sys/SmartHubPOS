# Ripoti ya ukaguzi na marekebisho (2026-10-25)

Hakuna commit, push wala deploy iliyofanyika.

## A. Chanzo cha matatizo
1. **Convex `waiterDirectory:list` na `waiterOrders:listForBills`:** Zote mbili zipo kwenye commit `58dde21` (`export const list` mstari 19, `export const listForBills` mstari 365) na `convex/_generated/api.d.ts` inazirejea. `vercel.json` haina `buildCommand` na `npm run build` ni `tsc -b && vite build` tu, bila `convex deploy`. Kwa hiyo Vercel hujenga frontend peke yake, na Convex hupokea kodi mpya tu mtu akiendesha `npx convex deploy`. Dalili (kuzikosa kwenye dashboard ya Production) inaendana na kwamba deploy ya Convex haikufanyika baada ya commit hiyo. **Haijathibitishwa** (hakuna `.env`/ufikiaji wa Vercel kwenye zip): mmiliki aangalie kuwa `VITE_CONVEX_URL` ya Production kwenye Vercel inaelekeza `deafening-clownfish-627`.
2. **Scrolling:** Shell (`Applayout.tsx`) ni `h-dvh overflow-hidden` na `<main>` ndiyo inayosogea. Matatizo yaliyopatikana: (a) `window.scrollTo` mahali pawili haifanyi kitu kwa sababu ukurasa haisogei, `main` ndiyo inasogea; (b) dialog/alert-dialog/sheet ndefu zilikatika bila kusogea; (c) `<main>` ndani ya `<main>` kwenye kurasa 6. Sikuweza kuthibitisha kwenye browser; ni uchambuzi wa kodi.
3. **Kurasa mbili za mauzo:** `Sales → Invoicing` (invoice kamili: mteja, punguzo, kodi, malipo) na `Selling Point` (kuchukua oda kwa tablet, hutuma kwa cashier). Zilikuwa zinashindana kwenye sidebar na hakuna iliyo mlango mkuu.

## B. Mabadiliko
- **Mlango mkuu wa mauzo = "Sales"** (`/sales` → Invoicing). "Selling Point" inaonekana kwenye sidebar kwa waiter/waitress na kwa biashara zilizowasha Waiter Orders tu (`sidebar.tsx`). Biashara ya reja reja (hardware) haioni kitu cha ziada.
- Reja reja bila makundi/meza/vyumba: `SellingPoint.tsx` sasa ina kisanduku cha kutafuta/scan code (Enter huongeza bidhaa), bidhaa bila kundi zinaonekana chini ya "Zote"; `InvoiceEntry.tsx` huchagua moja kwa moja mteja wa "Cash/Walk-in" akiwa mmoja tu.
- Hospitality imehifadhiwa na ni hiari: eneo (meza/chumba/ghorofa) liko ndani ya `<details>` "Eneo la huduma (hiari)" (`ServicePointFields.tsx`), na hutunzwa kwenye uwanja uleule wa `tableNumber` (hakuna mabadiliko ya schema). Meza peke yake ("5") inabaki "5".
- Maandishi ya zamani kwenye `InvoiceEntry` ("Send na Print havipunguzi stock") yamerekebishwa kuwa sahihi (vinapunguza mara moja tu).
- `<main>` ndani ya `<main>` imebadilishwa kuwa `<div>` (SalesClients, SalesRegister, InvoiceEntry, StockWorkspace, SupplierWorkspace, RegisterWorkspace).
- Jaribio jipya `src/api-references.test.ts`: kila `api.module.fn` ya frontend lazima iwe function ya umma ndani ya `convex/`.
- Line endings: mabadiliko ya CRLF yaliyobadilisha faili 111 yamerudishwa; sasa ni faili 19 tu zenye mabadiliko halisi.
- Nakala zilizokuwa root (`Applayout.tsx`, `sidebar.tsx`) zimehamishiwa `backup-stray-root-copies/` (hazijafutwa).
- Mabadiliko ya awali yaliyobaki: scroll (`app-scroll.ts`, `Applayout`, `index.css`, dialog/sheet), `ErrorBoundary` kwa kila panel na ujumbe wa "Convex haijapokea toleo jipya", na marekebisho ya herufi zilizoharibika.
- Hakuna kodi ya `convex/` iliyobadilishwa: ruhusa, utengano wa idara/tawi na `listForBills` havijaguswa.

## C. Uthibitisho (uliendeshwa kweli)
`npm ci` ok; `npx tsc -b` safi; `npm run lint` safi; `npx vitest run`: faili 48, tests **308 zimepita, 0 zimefeli**; `npm run build` ok. Haikujaribiwa kwenye browser.

## D. Hatua bado inahitajika Production
Deploy ya Convex iliyoidhinishwa tofauti (`npx convex deploy` kwa deployment `deafening-clownfish-627`) ili `waiterDirectory:list` na `waiterOrders:listForBills` (na `submit`, `byStaffCode`, `settleInvoices`, schema `staffCode`) zifike. Hii haikufanywa. Baada ya hapo: hakikisha `VITE_CONVEX_URL` ni ya deployment hiyo. Pendekezo: `npx convex deploy --cmd "npm run build"` kwenye Vercel build ili frontend na backend zitoke pamoja.

## E. Git
Zilizobadilishwa (19): BillSheet, error-boundary, ui/alert-dialog, ui/dialog, ui/sheet, index.css, i18n-dict-sellingpoint, PeriodReportPage, Applayout, sidebar, RegisterWorkspace, SupplierWorkspace, InvoiceEntry, SalesClients, SalesRegister, StockWorkspace, AnnouncementsAdmin, SellingPoint, waiter-orders/page.
Mpya: `src/lib/app-scroll.ts`, `src/lib/sales-flow.ts`, `src/lib/sales-flow.test.ts`, `src/components/ServicePointFields.tsx`, `src/api-references.test.ts`, `backup-stray-root-copies/`, ripoti hii. Backups/`.bak` hazijaguswa.

## Orodha ya kukagua scrolling (mkono)
- Sales/Invoicing: ongeza mistari 30+, ukurasa unasogea juu hadi chini; scan code inafanya kazi; kitufe cha Hifadhi kinafikika kwenye simu.
- Selling Point (tablet na simu): bidhaa nyingi zinasogea, kikapu cha kulia/chini kinafikika, Send/Print vinaonekana.
- Admin (Maintenance, Settings, User Settings, ripoti ndefu, majedwali mapana): kurasa zote zinasogea; jedwali pana linasogea upande ndani ya eneo lake.
- Sidebar ndefu inasogea yenyewe bila kuzuia ukurasa; header inabaki juu.
- Dialog/sheet ndefu: inasogea; ukiifunga ukurasa wa chini unasogea tena.
- Badilisha ukurasa: unaanza juu. Chapisha: ripoti inachapisha eneo lake tu.
