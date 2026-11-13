# MABADILIKO 57 - Mauzo ya usiku (baada ya saa 6 usiku) yarudi siku iliyopita pamoja na cash

Tatizo: bar/restaurant ikiuza baada ya saa 6 usiku (00:00 EAT), bili inaingia siku mpya.
- "Edit bill" kubadilisha tarehe kulirudisha malipo (cash ilipotea), na
- risiti ya cashier haikuweza kupewa tarehe kabla ya tarehe ya bili.
Matokeo: cash+mobile+bank hazikulingana na siku ya mauzo.

Suluhisho: `convex/waiterDayMove.ts` -> `moveToDay({ orderIds, day })`
Inahamisha kwa pamoja (yote au hakuna): bili, stock history ya bili, risiti za cashier (waiterCollections.date),
journal ya risiti (entryDate) na counters za dashboard. Malipo HAYARUDISHWI.
Kinga: siku ya baadaye imekataliwa; kipindi cha hesabu kilichofungwa kimekataliwa; siku iliyofungwa kwenye ripoti (closedAt) imekataliwa;
risiti iliyolipa bili nyingine ambazo hukuzichagua imekataliwa (chagua bili zote za risiti hiyo); mhudumu hawezi.

Skrini: Pokea fedha za wahudumu
1. Tiki bili -> "Mauzo ya usiku...? Yarudishe siku iliyopita" -> chagua siku -> Hamisha bili zilizotiki. Kisha pokea fedha kama kawaida (zinaenda siku hiyo).
2. Orodha ya "Zilizopokelewa" -> kitufe "Hamisha siku" -> chagua siku -> "Hamisha na fedha" (kwa bili ambazo tayari zilipokelewa).

Faili: convex/waiterDayMove.ts (mpya), convex/waiterDayMove.test.ts (mpya), convex/waiterCollections.ts (receipts inarudisha orderIds, date),
convex/_generated/api.d.ts, src/pages/waiter-orders/WaiterCollection.tsx, src/lib/i18n-dict-daymove.ts (mpya), src/lib/i18n.ts.

HAIJAJARIBIWA (hakuna node_modules kwenye ZIP): endesha
  npx vitest run convex/waiterDayMove.test.ts && npx tsc -b && npx eslint .
kisha `npx convex deploy` na build ya frontend.
