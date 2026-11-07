# MABADILIKO 25 — Marekebisho ya lint (haijathibitishwa kwa kuendesha)

**Muhimu:** Marekebisho haya yalifanywa bila `node_modules` na bila intaneti, kwa hiyo `npm run lint`, `npm test` na
`npm run build` HAVIJAENDESHWA. Faili zote 41 zilizobadilika zimepita ukaguzi wa syntax (TypeScript parser), lakini
ukaguzi wa aina (`tsc -b`) haujafanyika. Endesha hatua za chini kisha tuma log ili makosa yatakayobaki yarekebishwe.

## 1. `@convex-dev/explicit-table-ids` (convex/)
- Miito ya `ctx.db.get / patch / delete` bila jina la table (210) sasa inatumia fomu iliyo wazi, mfano
  `ctx.db.get("products", id)`, `ctx.db.patch("invoices", id, {...})`, `ctx.db.delete("roles", id)`.
- Jina la table lilichukuliwa kutoka `convex/schema.ts` na kutoka kwenye `v.id("...")` ya argument au query iliyozaa
  rekodi hiyo. Hakuna table wala field iliyobuniwa; hakuna mantiki ya biashara iliyobadilishwa.
- Jumla ya miito yenye jina la table sasa: 228 (ikiwemo iliyokuwepo tayari).
- Mafaili: announcements, attendance, biometric, capital, clients, customerBills, hr, inventory, ledger, maintenance,
  paymentMethods, payroll, periodReport, products, purchasing, sales, settings, stats, suppliers, support, tenants, users,
  access, bills, dashboard, accounting, plans, notifications, reportEmails, purchaseReports, subscriptions
  na majaribio (`*.test.ts`).

## 2. Table zinazochaguliwa wakati wa kuendesha (`any` imeondolewa)
- `maintenance.ts`: backup/export, health check, assign-unscoped na **Clear Data** zilitumia `ctx.db as any`.
  Sasa zinapita kwenye `dynamicDb()` (interface moja iliyoandikwa) na kila `delete/patch` inapewa jina la table wazi
  (`db.delete(step.table, id)`), kwa hiyo Convex inakagua kuwa id ni ya table hiyo. Mantiki ya kufuta haijabadilika.
- `purchasing.ts` (purchaseReport): `ctx.db.get(id as any)` → `ctx.db.normalizeId("suppliers", id)` kisha `get("suppliers", ...)`.
- `sales.ts` (salesRegisters): `getDoc(any)` → vitafuta vyenye aina kwa kila table (users, products, productGroups,
  unitsOfMeasure, suppliers, invoices) vyenye cache ile ile.
- `maintenance.ts`: `saveSetting` sasa inakagua aina ya `minPasswordLength` / `sessionTimeoutMinutes` / `language`
  badala ya `as any` (namba pekee zinakubaliwa); `tenant: any` imeondolewa.
- `any` za wazi zilizobaki kwenye src+convex: 175 → 154.

## 3. React hooks — `PurchaseReports.tsx`
- Ondoa `eslint-disable-line react-hooks/exhaustive-deps` zote 7. `live`, `liveIds`, `returns` na `rows` sasa ni
  `useMemo`, na kila `useMemo` ina dependencies sahihi (`data.purchases`, `data.lines`, `data.suppliers`, `data.payments`...).

## Havijaguswa (kwa makusudi, kwa sababu ya hatari bila compiler)
- `any` iliyobaki (154): hasa `convex/access.ts` (`user: any`, `scopedRows(): any[]`), `sales.ts`, `stats.ts`,
  `dashboard.ts`, `purchaseReports.ts`, na majaribio. Kubadilisha saini za `access.ts` kunagusa maktaba nzima na kunahitaji `tsc`.
- `maintenance.ts`: `readSettingsMap/securityPolicy/assertCanAssign` zina `ctx: any` (zinaitwa pia kutoka action).
- Sheria `react-hooks/set-state-in-effect` (faili 16 zenye `useEffect`), auth/callback, `src/lib/printers.ts`,
  uchapishaji wa ripoti na tahadhari za SVG kwenye majaribio: hazijaguswa.
- Hakuna jaribio jipya lililoongezwa.

## Hatua za kuthibitisha (kwenye kompyuta yako)
```
npm install
npx tsc -b            # makosa ya aina (kama yapo, tuma output)
npm run lint
npm test
npm run build
npx convex dev        # kuhakikisha backend inakubali mabadiliko
```
Kama `tsc` inalalamika kwenye `ctx.db.get("jina", ...)`, maana yake id si ya table hiyo — tuma mstari na nitarekebisha.

## Usalama
- `jwt_private_key.pem` ipo kwenye mzizi wa mradi na **haipo** kwenye `.gitignore`. Hakikisha haikuwahi kuwekwa kwenye git
  wala kushirikiwa; kama ilishirikiwa, tengeneza mpya (rotate) na uiweke kama environment variable ya Convex.

---
## Raundi ya 2 (baada ya log ya mtumiaji: tsc 7 errors, lint 210 errors + 3 warnings, tests 118 zilipita)
- `convex/access.ts`: `businessRows` / `scopedRows` sasa zinapitia `byScope()` (interface ndogo iliyoandikwa) kwa sababu `table`
  inachaguliwa wakati wa kuendesha na index `by_scope` haipo kwenye aina ya union ya tables zote (makosa 6 ya TS2345/TS2339).
- `convex/biometric.ts:150`: `cd.origin` inakaguliwa kuwa string kabla ya `new URL(...)` (kosa 1 la TS2345).
- `PeriodReportPage.tsx`: `departments` imewekwa kwenye `useMemo` (warnings 2).
- `PurchaseReports.tsx`: `typeof data.lines` → `Registers["lines"][number]` (warning 1).
- Makosa 210 ya `no-explicit-any` yaliyobaki: yako kwenye `access.ts` (`user: any`, `scopedRows(): any[]`), faili za majaribio,
  `sales.ts`, `stats.ts`, `dashboard.ts` n.k. Kuyabadilisha kunahitaji aina mpya za pamoja (mfano `UserDoc`) na kutafanya
  `tsc` itoe makosa mapya kwenye call sites; yatafanywa kwa hatua, faili moja baada ya jingine, ukitumia log ya `tsc`.
