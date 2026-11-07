# Mabadiliko 39 - Skrini ya Sales rahisi (Send to cashier / Print)

- Mteja ni HIARI. Usipochagua, oda inaandikwa "Mteja / Customer". Hakuna tena ujumbe "Hakuna mteja bado" wala kulazimisha mteja.
- Sehemu ya "Chanzo cha mauzo" imeondolewa. **Discount ya mstari na Discount ya invoice zimebaki** kwenye skrini kuu (kwa maduka ya vifaa vya umeme, nguo, viatu). Tax ipo ndani ya kisanduku "Invoice ya mkopo".
- Punguzo linaingia kwenye oda: jumla ya oda (anachokusanya cashier) ni baada ya punguzo. Discount ya invoice inagawanywa kwenye mistari kulingana na thamani.
- Chini kuna vitufe 2 kama ukurasa wa mhudumu: **Send to cashier** na **Print**. Zote zinatumia `waiterOrders.submit`:
  oda inaenda kwenye foleni ya cashier ya biashara na idara anayoifanyia kazi mtumiaji; stock inapungua mara moja tu.
- Bei ni ya bidhaa; kupunguza bei ni kwa Discount. Invoice ya mkopo (mteja lazima) bado ipo kwenye kisanduku kilichofungwa.
- Faili: src/pages/sales/InvoiceEntry.tsx, src/lib/i18n-dict-access.ts

Majaribio mapya: convex/orderDiscount.test.ts. Faili za ziada: convex/schema.ts (discount kwenye mstari wa oda), convex/waiterOrders.ts.
