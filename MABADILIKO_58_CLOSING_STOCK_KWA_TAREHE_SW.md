# MABADILIKO 58 - Closing Stock ya siku yoyote (mwanzo, vilivyoongezeka, vilivyouzwa, mwisho)

Tatizo: skrini za Item Quantity / Quantity Report / Stock Value zinaonyesha stock ya leo tu (currentQty); hazina tarehe.

Suluhisho: ripoti mpya Stock > Stock Reports > "Closing Stock (kwa tarehe)".
Chagua tarehe (au Leo / Jana) -> kwa kila bidhaa: Mwanzo | Manunuzi | Marejesho | Adjustment | Production/Transfer | Mauzo | Mwisho | Cost | Thamani.
Mwisho = Mwanzo + vilivyoongezeka - Mauzo, imejengwa kutoka stock movements zenye tarehe (si kutoka stock ya leo).

Faili: convex/stockDaily.ts (query `closingStock`), convex/stockDaily.test.ts, convex/_generated/api.d.ts,
src/pages/stock/StockWorkspace.tsx (ClosingStockScreen + route reports/closing-stock), src/pages/stock/page.tsx (menu), src/lib/i18n-dict-daymove.ts.

Tahadhari:
- Thamani = Mwisho x cost ya sasa ya bidhaa. Kwa thamani ya FIFO ya siku ya nyuma tumia "Stock Value Report".
- Movements za Selling Point (waiter) zinaandikwa kwa tarehe ya UTC (waiterOrders.ts `now.slice(0, 10)`): bili ya saa 6:00-9:00 usiku (EAT) inaweza kuingia siku iliyotangulia. Bili zilizohamishwa kwa "Hamisha siku" zinafuata siku mpya.
Endesha: npx vitest run convex/stockDaily.test.ts ; npx tsc -b ; npx eslint . ; npx convex deploy ; npm run build
