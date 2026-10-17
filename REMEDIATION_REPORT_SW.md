# SmartHubPOS — Ripoti ya ukaguzi na marekebisho

> Ripoti ya kihistoria. Hatua ya Super Admin sasa inatumia `SUPER_ADMIN_USERNAME` (si `SUPER_ADMIN_EMAIL`); angalia README.md kwa maelekezo ya sasa.

Tarehe: 10 Oktoba 2026

## Marekebisho yaliyotekelezwa katika nakala hii

1. Rekebisha `src/main.tsx`: `mport` ilikuwa imekosa herufi `i`, na import ya `./App.tsx` haikulingana na faili halisi `./app.tsx`.
2. Rekebisha import yenye tofauti ya herufi kubwa/ndogo katika `Applayout.tsx` (ipo kwenye source ya awali).
3. Ongeza helper za backend katika `convex/access.ts` za kuhitaji mtumiaji hai, kuthibitisha role, kuchuja rekodi kwa tenant/branch na kuzuia IDOR kwa rekodi zisizo za ofisi/branch ya mtumiaji.
4. Ongeza `tenantId` na `branchId` za hiari kwenye schema ya bidhaa, makundi ya bidhaa, units, clients, suppliers, invoices, purchases na baadhi ya rekodi za uendeshaji. Hii ni mabadiliko ya schema ya Convex; hakikisha deployment ya majaribio inakubali schema kabla ya production.
5. Product, client na supplier queries sasa huchuja data kwa scope ya mtumiaji; detail endpoints hukataa rekodi za ofisi/branch nyingine; mutations za manager huangalia ownership kabla ya update na kuweka scope wakati wa kuunda.
6. Dashboard sasa huchuja invoices, purchases na products kwa tenant/branch kabla ya kuhesabu metrics. Company settings husomwa kwa scope badala ya kutumia rekodi ya kwanza ya database.
7. Ondoa hatari ya akaunti yoyote ya kwanza kuwa Super Admin moja kwa moja. Bootstrap inahitaji `SUPER_ADMIN_EMAIL` upande wa Convex na email ya identity ilingane; akaunti nyingine mpya huanza kama `viewer`.
8. Ongeza unit tests za helper za tenant/branch isolation katika `convex/access.test.ts` na nyongeza ya maelekezo ya provisioning kwenye README.

## Matokeo ya uthibitishaji

- **Ukaguzi wa ZIP:** ZIP imefunguliwa na muundo wa React/Vite + Convex/TypeScript umetambuliwa.
- **Dependency install:** `npm install --no-audit --no-fund` ilizidi muda wa mazingira; utegemezi haukupatikana kikamilifu.
- **Build:** imejaribiwa na imeshindwa kwa sababu dependencies hazipo; kabla ya kurekebisha, ilionyesha pia syntax/import errors katika `src/main.tsx`, ambazo zimesahihishwa. Build ya mwisho bado haijaweza kuthibitishwa.
- **Lint / tests:** zimejaribiwa lakini haziku-run kwa sababu `eslint` na `vitest` hazipo baada ya `npm install` kuzidi muda. Unit tests zimeandikwa lakini hazijathibitishwa ku-run.
- **Database migrations/deployment:** hazijatekelezwa; Convex schema validation kwenye deployment halisi haijathibitishwa.

## Vizuizi muhimu vilivyobaki — si tayari kwa production

- Sales, Stock, Purchasing, Payroll, Accounts na Maintenance bado zina routes nyingi zinazotumia `ComingSoon`; workflows zake hazijakamilika.
- Tenant/branch ownership bado haijaenezwa na kuthibitishwa kwa kila jedwali na endpoint. Invoice lines, payments, journals, payroll, audit logs, exports na endpoints nyingine zinahitaji audit na enforcement kamili.
- Schema fields ni optional kwa ajili ya migration isiyoharibu data ya zamani. Rekodi za zamani zisizo na tenant/branch zitafichwa kwa watumiaji wa kawaida; data migration ya kuziassign kwa ofisi sahihi bado inahitajika.
- Sales/purchase posting ya atomic, stock ledger, idempotency, refunds, double-entry accounting, financial decimal precision na reports hazijathibitishwa end-to-end.
- TRA si integration ya moja kwa moja iliyothibitishwa; credentials na API rasmi vinahitajika.
- Logo ya sasa iliyo kwenye ZIP imehifadhiwa; source ya awali ya `DISPENSARY_HOSPITAL.zip` haipo ndani ya ZIP hii kwa hivyo haiwezekani kuthibitisha kuwa ni faili ileile bila source hiyo.

## Kuendesha kwenye Windows PowerShell

1. Install Node.js inayolingana na dependencies za project.
2. Nakili `.env.example` kwenda `.env.local` na weka `VITE_CONVEX_URL` halisi. Login sasa imeandaliwa kutumia Convex Auth kwa username/password; OIDC authority/client ID/redirect URI hazihitajiki.
3. Endesha `npm install`.
4. Weka email ya Super Admin kwenye Convex deployment: `npx convex env set SUPER_ADMIN_EMAIL admin@example.com` (badilisha kwa email sahihi ya admin).
5. Weka `SUPER_ADMIN_USERNAME` kwenye Convex deployment, kisha endesha `npx convex dev` kwenye deployment ya majaribio ili kusawazisha auth config, schema na functions.
6. Endesha `npm test`, `npm run lint`, na `npm run build`; usitumie data halisi hadi blockers zilizo juu zifanyiwe kazi na majaribio.

## Uamuzi

Nakala hii ina mabadiliko halisi ya source na hatua za usalama zilizoongezwa, lakini **haijathibitishwa kuwa mfumo kamili au salama kwa uzalishaji**. Ripoti hii inatofautisha marekebisho yaliyofanywa na vipengele ambavyo bado havijatekelezwa au kupimwa.
