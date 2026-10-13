# Mabadiliko awamu ya 7

## 1. Idara kwenye kusajili biashara
Fomu ya **Sajili biashara mpya** (skrini unayoiona baada ya kuingia kama Super Admin) haikuwa na sehemu ya idara; ilikuwepo kwenye ukurasa mwingine (`/super-admin`) ambao hauna kiungo popote. Sasa fomu ya kusajili ina **Idara / sehemu za biashara (hiari)** — ongeza Bar, Lounge, Jiko n.k. au iache tupu. Kadi za biashara zinaonyesha "Idara: n".

## 2. Usajili: Demo au Amelipia
- Kwenye fomu ya kusajili chagua **Demo (siku 3)** au **Amelipia** (miezi + kiasi).
- Biashara mpya ikiachwa bila kuchagua ni **Demo ya siku 3** (leo, kesho, keshokutwa; inafungwa siku ya 4).
- Kwenye kila kadi ya biashara kuna kitufe cha **kadi ya malipo (💳)**: hapo unaongeza malipo, unarudisha demo, na unaona **historia ya malipo** (tarehe, kiasi, miezi, kuanzia–hadi).
- Ukiongeza malipo wakati usajili bado unaendelea, miezi mipya inaanza **baada ya tarehe ya mwisho ya sasa** (hakuna siku zinazopotea). Ukiongeza baada ya kuisha, inaanza leo.
- Tarehe ya mwisho inahifadhiwa kwenye database; kadi inaonyesha "Demo · siku n zimebaki", "Imelipiwa hadi …" au "Imeisha …".
- **Ukiisha**: watumiaji wa biashara hiyo wanaona skrini ya "Usajili umeisha" na backend inakataa maombi yao (Super Admin hazuiwi). Data haifutwi; ukilipa wanaendelea mara moja.
- **Biashara za zamani** (zilizoundwa kabla ya mabadiliko haya) hazina tarehe ya mwisho, kwa hiyo **hazifungwi**. Zipe usajili kupitia kitufe cha 💳 ukitaka.
- **Taarifa**: kuanzia **siku 7 kabla** ya kuisha (demo au imelipiwa), admin/manager/owner wa biashara anapata: (a) taarifa mpya kila siku kwenye Notifications (kengele), (b) mstari wa onyo chini ya TopBar unaoonyesha siku zilizobaki. Siku 2 au chini → rangi nyekundu.
- Eneo la saa: tarehe zinahesabiwa saa za Afrika Mashariki (UTC+3).

## 3. Matangazo na ujumbe kwa wateja wote (Super Admin)
Kwenye skrini ya kuchagua biashara kuna kichupo kipya **Matangazo na ujumbe**:
- **Ujumbe kwa wateja**: unamfikia kila mtumiaji (wa biashara zote, au biashara moja uliyochagua). Unaonekana kwenye Notifications na unafunguka kama dirisha mara ya kwanza mtumiaji anapoingia; ukishasomwa haurudi.
- **Tangazo (bango)**: bango lenye rangi, picha (hiari) na kitufe cha kiungo (hiari) juu ya **Dashboard**, kama bango za app za simu; linazunguka kila sekunde 6, mtumiaji anaweza kulifunga.
- Unaweza kuweka tarehe ya kuanza na kuisha, kuficha/kuonyesha, au kufuta. Orodha ya "Yaliyotumwa" inaonyesha idadi ya watumiaji wanaofikiwa.
- Picha na viungo lazima viwe `https://`. Picha ni **kiungo** (bado hakuna kupakia faili).

## Faili mpya / zilizobadilika
- Backend: `convex/plans.ts`, `convex/subscriptions.ts`, `convex/announcements.ts`, `convex/schema.ts`, `convex/tenants.ts`, `convex/notifications.ts`, `convex/access.ts`, `convex/_generated/api.d.ts`.
- Frontend: `src/pages/super-admin/*` (BusinessPicker, PlanFields, SubscriptionPanel, AnnouncementsAdmin), `src/components/ads-carousel.tsx`, `src/components/announcement-popup.tsx`, `src/pages/layout/_components/SubscriptionBanner.tsx`, `Applayout.tsx`, dashboard, notify, tafsiri (`i18n-dict-subscriptions.ts`).

## Jinsi ya kuweka
1. `npm install`
2. `npx convex dev` (inapakia schema mpya: jedwali `subscriptionPayments` na `announcements`).
3. `npm run dev`

## Majaribio
`npx vitest run`: majaribio 61 yanapita (8 mapya: tarehe/miezi, demo na kulipia, kuongeza malipo, ruhusa, kufungwa baada ya kuisha, taarifa za siku 7, ujumbe wa wote/biashara moja, mabango). `npx tsc -b` na `vite build` zinapita. Sikujaribu dhidi ya Convex ya live wala kwenye kivinjari halisi.
