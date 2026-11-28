# MABADILIKO 62 - Bidhaa ya menu (si stock item) na lugha

1. Tiki mpya "Ni stock item" (Stock > Add / Modify Stock). Ukiiondoa, bidhaa ni ya menu:
   - haibebi idadi (inalazimishwa 0; namba za zamani zinapuuzwa), haionekani kwenye stock value, out of stock, reorder, notifications, stock take, quantity adjustment, batch.
   - ikiuzwa (invoice, Selling Point, kuhariri invoice) inachukua viungo vya recipe yake (hata bila tiki ya auto-on-sale); bila recipe inakataa; viungo vikiisha inakataa ("Hakuna stock ya kutosha ya ...") hata allowNegativeStock ikiwa imewashwa.
   - kughairi/kurejesha mauzo hakurudishi idadi kwenye bidhaa ya menu (na viungo havirudi).
2. Lugha: maandishi ~60 ya Kiswahili yasiyokuwa kwenye kamusi sasa yanatafsiriwa (src/lib/i18n-dict-menu.ts).
Faili: convex/schema.ts, autoProduce.ts, sales.ts, waiterOrders.ts, products.ts, inventory.ts, production.ts, stats.ts, notifications.ts; src/pages/stock/*, src/pages/sales/InvoiceEntry.tsx; jaribio convex/menuItem.test.ts.
Endesha: npx convex deploy ; npm run build. tsc safi; vitest: faili 114, majaribio 753 yamepita.
Mipaka: Purchase bado haikatazwi kupokea bidhaa ya menu; Cashier/Kiosk hazikukaguliwa; hesabu za Inventory hazirekebishwi bidhaa ikigeuzwa kuwa menu.

## Awamu ya 2 (karatasi ya maelekezo)
1. Upana wa karatasi: sasa unafuata Hardware Setup ya biashara husika tu (resolvePaper). Thamani ya 58mm iliyobaki kwenye browser kutoka biashara nyingine haitumiki tena (ilikuwa inashinda setting ya biashara). Risiti, bili, ripoti, invoice na Bills zote zinafuata. Biashara isiyo na setting = 80mm.
2. Barcode scanner kwenye Selling Point: ukiscan, bidhaa inaingia yenyewe kwenye "Oda ya sasa" bila kuweka cursor kwenye kisanduku (inatumia Scanner suffix ya setting: Enter/Tab). Kuandika ndani ya kisanduku hakuhesabiwi kama scan. Msimbo usiopatikana unatoa "Bidhaa haijapatikana."
3. Customer display: ukurasa mpya /customer-display (kitufe "Fungua Customer Display" kwenye Selling Point kikiwa kimewashwa kwenye Hardware Setup). Unaonyesha bidhaa, idadi ya kila moja, idadi ya vitu vyote na jumla ya kulipa, vikiongezeka kadri bidhaa zinavyoongezwa. Inafanya kazi kwenye kompyuta/browser ileile (dirisha la pili kwenye skrini ya mteja).
4. Customer display: chaguo jipya Hardware Setup > "Customer display ionyeshe nini": "Bidhaa, idadi na jumla" (kawaida) au "Namba tu: idadi na jumla" (kwa mashine zenye display ya namba kama ya kaunta ya bili; majina ya bidhaa hayaonyeshwi).
