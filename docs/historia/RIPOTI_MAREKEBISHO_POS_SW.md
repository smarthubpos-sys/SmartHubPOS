# Ripoti: marekebisho ya POS, Cashier na Dashboard

## Files zilizobadilishwa
- convex/maintenance.ts — getSettings: cashier mwenye idara/tawi sasa anapata mipangilio ya hardware (printer) iliyohifadhiwa kwa biashara nzima.
- convex/waiterOrders.ts — `list`/`listForBills` hazitupi server error idara isipochaguliwa; `listForBills` inaficha bills zilizochapishwa; mutation mpya `markBillPrinted`.
- convex/schema.ts — field mpya ya hiari `billPrintedAt` (additive, hakuna data inayofutwa).
- convex/tenants.ts — flag mpya `canViewSales`.
- convex/dashboard.ts — "Recent invoices/purchases" sasa hazionyeshi rekodi zilizobatilishwa.
- src/lib/print-waiter-order.ts — `qzPrinterFrom()`: sheria moja ya printer kwa mhudumu, cashier na Bills.
- src/pages/waiter-orders/{page,SellingPoint,BillsPanel}.tsx, src/pages/sales/InvoiceEntry.tsx, src/pages/bills/page.tsx
- Tests: print-waiter-order.test.ts, SellingPoint.test.tsx

## Vyanzo
1. Printer: settings zinasomwa kwa (biashara + tawi); cashier mwenye tawi hakuona settings zilizohifadhiwa bila tawi, na code ilidai `printerSource === "installed"` kabisa.
2. Cards za Staff code / Waiters: zilionyeshwa kwa cashier yeyote lakini queries zinahitaji `sales.view` → Server Error. Sasa zinaonekana kwa wenye ruhusa tu. Queries za foleni hazivunjiki idara isipochaguliwa.
3. Bills: BillsPanel imehamishwa kwenye menu ya Bills; bill ikichapishwa kwa mafanikio tu inaondoka kwenye pending (rekodi inabaki).
4. POS: cards ndogo, cart inabaki upande bila horizontal scroll.

## Majaribio
TypeScript: safi. ESLint: safi. Build: imefaulu. Vitest: tests zote zilizoendeshwa zimefaulu (kabla ya marekebisho ya mock, SellingPoint.test ilishindwa 2; imerekebishwa na kupita).

## Bado hayajathibitishwa
- Picha 3 na 4 hazikuonekana kwangu; chanzo cha server error kimetokana na code. Kama bado kuna "Could not find public function", inahitaji `npx convex deploy`.
- Dashboard: kimerekebishwa kipengele kimoja tu (recent lists). Kadi nyingine hazikuonekana kuwa na hitilafu bila data halisi; niambie kadi mahususi.
- Schema ina field mpya; deploy ya Convex haijafanywa (inahitaji ruhusa yako).

## Awamu ya 2: oda za Send hazifiki kwa cashier
- Ukurasa ulitambua cashier kwa orodha ya majina ya role (cashier, manager...). Role maalum (mf. "Kassa") haikuonyesha foleni. Sasa role yoyote isiyo waiter yenye ruhusa `waiterOrders.manage` ni cashier (`canManageWaiterOrders` kwenye tenants.current).
- Foleni inachuja kwa biashara + idara ile ile ya mhudumu. Cashier asiyekuwa na idara ile ile (au asiyechagua idara) alikuwa akipata error/foleni tupu wakati Super Admin (aliyechagua idara sahihi) anaona. Sasa ujumbe wazi "Chagua idara..." unaonekana badala ya Server Error. Cashier lazima awe idara ile ile na mhudumu; hii ni kwa mujibu wa isolation iliyopo, sikuibadilisha.

## Awamu ya 3
1. Oda hazifiki kwa cashier: cashier/manager sasa anaona oda za idara yake, au za idara zote kama hajachagua idara (`viewScope` kwenye waiterOrders.ts). Mhudumu bado amefungwa kwenye idara yake. Test: convex/waiterCollections.test.ts.
2. Printer: `getSettings` inatafuta hardware kwenye scope ya mtumiaji, kisha ya biashara nzima, kisha ya hivi karibuni zaidi kwenye biashara. `BillSheet` (inayochapisha Bills) sasa inatumia `qzPrinterFrom` badala ya kudai `printerSource === "installed"`.
3. Bills za mhudumu: zinachapishwa kupitia printer ile ile na kuondoka kwenye orodha baada ya kuchapishwa kwa mafanikio (`markBillPrinted`).
4. Kupokea fedha za wahudumu: kadi mpya "Pokea fedha za wahudumu" kwenye Selling Point ya cashier (WaiterCollection.tsx + convex/waiterCollections.ts). Cashier anachagua mhudumu, oda, njia za malipo (split); jumla lazima ilingane; oda zinawekwa settled (hazifutwi). Jedwali jipya `waiterCollections`.
5. Dashboard: (a) mauzo ya Selling Point yanahesabiwa siku cashier anapopokea fedha (siku hiyo, mara moja) kwenye totals, graphs na top products, na yanabaki baada ya rebuild; (b) rebuild ya statsDaily ilifuta rows 4000 za zamani tu, na biashara kubwa zilihesabiwa mara mbili siku za karibuni; sasa inafuta rows za dirisha linalojengwa upya tu.

## Bado hayajathibitishwa / tahadhari
- Malipo yaliyopokelewa kutoka kwa wahudumu hayajaingizwa kwenye journal/account za njia za malipo (ni rekodi ya mauzo na makusanyo kwenye dashboard tu). Niambie kama yanahitaji kuingia kwenye ledger.
- Oda zilizotumwa kabla ya mabadiliko haya zitaonekana kwenye "Pokea fedha" na zikipokelewa zitahesabiwa siku ya kupokelewa.
- Deploy ya Convex inahitajika (schema mpya + function mpya), kisha dashboard inajijenga upya yenyewe.
- Top products inatumia sampuli ya invoice mpya (kikomo cha kiufundi cha awali); sikubadilisha.
