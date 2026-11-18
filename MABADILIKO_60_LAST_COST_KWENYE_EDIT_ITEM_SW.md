# MABADILIKO 60 - Last Cost kwenye fomu ya Edit Item

Tatizo: ukiedit item (Stock > Items) hakukuwa na mahali pa kuweka gharama; cost ilibadilika tu kupitia Purchase.

Suluhisho: kisanduku kipya "Last Cost (gharama ya mwisho kwa kipande)" kwenye fomu ya kuedit (kinaonyesha thamani ya sasa).
- Kinahifadhiwa kama lastPurchaseCost ya bidhaa, na kinaandikwa kwenye audit log ("last cost a -> b").
- Kama bidhaa HAINA cost ya wastani bado (0), cost ya wastani pia inawekwa sawa na Last Cost ili thamani ya stock na faida vihesabiwe.
- Kama bidhaa ina cost ya wastani tayari, wastani HAUBADILIKI (unaendelea kuhesabiwa kutoka Purchase).
- Mauzo yaliyopita hayabadiliki; mabadiliko yanahusu mauzo yajayo na thamani ya stock.

Faili: convex/products.ts (upsert: arg `lastCost`), src/pages/stock/StockWorkspace.tsx (fomu).
Inahitaji ruhusa ya stock.adjust (kama kuedit item kwa kawaida).
HAIJAJARIBIWA: npx tsc -b ; npx eslint . ; npx vitest run ; npx convex deploy ; npm run build
