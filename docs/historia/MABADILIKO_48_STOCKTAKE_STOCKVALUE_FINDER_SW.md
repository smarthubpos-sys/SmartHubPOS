# MABADILIKO 48

1. Stock Taking Report sasa ni ACTIVE (Stock > Stock Reports > Stock Taking Report)
   - Orodha ya bidhaa zote active: unaandika kiasi ulichohesabu, mfumo unaonyesha tofauti na thamani yake papo hapo.
   - Chuja kwa Group, tafuta kwa jina/code/barcode, "Zenye tofauti tu", "Jaza kiasi cha mfumo kwa zilizobaki",
     "Chapisha karatasi ya kuhesabia".
   - "Hifadhi Stock Take": bidhaa zenye tofauti tu ndizo zinarekebishwa (kama Quantity Adjustment, pamoja na ledger),
     zote chini ya namba moja ya stock take (ST-YYYYMMDD-XXXX). Ikiwa kuna mstari usio sahihi, hakuna kinachohifadhiwa.
   - Inahitaji ruhusa ya stock.adjust (anayopewa na Super Admin). Wasio na ruhusa wanaona historia tu.
   - Historia chini inaonyesha kila stock take/adjustment pamoja na namba yake.
2. Card mpya: Stock Value Report (Stock Reports) - thamani ya stock kwa cost na kwa bei ya kuuza, faida inayotarajiwa,
   thamani kwa group na kwa bidhaa (zimepangwa kuanzia yenye thamani kubwa), chuja group, Print / CSV / Email.
3. Invoice Finder: meneja / admin / owner sasa anaona bili za wahudumu WOTE (hata zile ambazo mhudumu hajazituma kwa cashier)
   na anaweza kutafuta kwa namba, jina la mteja au jina la mhudumu. Cashier bado anaona zilizotumwa tu; mhudumu anaona zake.

Faili: convex/inventory.ts, convex/waiterOrders.ts, src/pages/stock/StockTakeValue.tsx (mpya), StockWorkspace.tsx, page.tsx,
src/pages/sales/InvoiceFinder.tsx, src/lib/i18n-dict-stocktake.ts (mpya), src/lib/i18n.ts, convex/stockTakeAndFinder.test.ts (mpya).
Hakuna badiliko la schema. Convex deploy inahitajika (convex/inventory.ts na convex/waiterOrders.ts zimebadilika).
