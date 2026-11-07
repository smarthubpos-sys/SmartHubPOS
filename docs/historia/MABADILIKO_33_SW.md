# MABADILIKO 33 — Stock/ripoti za Selling Point na login ya PIN tu

## Stock na hesabu
- Malipo ya wahudumu (waiterCollections.collect) sasa yanaandika journal `waiter_sale`: Dr cash, Cr mapato, Dr COGS, Cr inventory. Gharama inatoka kwenye stock movements za oda.
- `waiterCollections.bookMissingJournals` + kitufe kwenye Maintenance > Database Maintenance: huingiza journals za malipo ya zamani (haidurufu).
- Stock Earnings (inventory.stockRegisters) na ripoti za Sales (sales.buildSalesRegister) zinajumuisha mauzo ya Selling Point.
- Schema: index mpya `stockMovements.by_reference`.

## PIN tu
- Login ya PIN haina username; PIN 4–6 tarakimu, ya kipekee kwenye mfumo mzima (`users.pinLookup`, index `by_pin_lookup`).
- Waiter/waitress husajiliwa kwa PIN bila password; PIN iliyopo inakataliwa kabla ya akaunti kuundwa.
- Kikomo: majaribio 30 yasiyo sahihi/dakika 10 husimamisha login ya PIN dakika 5 (`pinLoginGuard`); password haiathiriwi.
- PIN za zamani zinahamishwa zenyewe kwenye login ya kwanza.
- Siri ya fingerprint: `PIN_LOOKUP_SECRET` (au `JWT_PRIVATE_KEY`).

## Hatua
`npm install` → `npx convex dev` → `npm run build && npm run lint && npm test` → bonyeza "Ingiza hesabu zilizokosekana" kwa kila biashara.

## Haijathibitishwa
Majaribio mapya (pinOnly.test.ts, waiterCollections.test.ts) na build havikuendeshwa wakati wa kuandika.
