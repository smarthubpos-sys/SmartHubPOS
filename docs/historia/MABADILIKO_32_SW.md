# Mabadiliko 32 (2026-10-26)

1. Super Admin hapokei foleni ya cashier: `waiterOrders.list` inamrudishia oda zake mwenyewe tu; `markHandled`, `waiterCollections.owing/collect/receipts` zinamkataa; ukurasa wa Selling Point haumhesabu kama cashier; `/cashier` imefungwa kwake.
2. Cashier: ukurasa mpya `/cashier` (menyu "Cashier") wenye Pokea fedha, Weka malipo (staff code) na Waiter Directory. Vilitolewa chini ya Selling Point. Kuna kiungo cha haraka kutoka foleni ya oda.
3. Printer: `BillSheet` inamruhusu mwenye `waiterOrders.manage` kuchapisha hata role ya zamani isipo na `sales.print`; ujumbe wazi printer ikiwa ya "direct" (USB/Bluetooth), kwani chapa ya bili inatumia QZ Tray tu.
4. Bills: baada ya kuchapishwa kwa mafanikio bili inafungwa na invoice zake zinaondoka kwenye "Invoice za mteja" (tiki "Onyesha invoice zilizokwisha kwenye bili" kuziona); zinafunguka tena kupitia "Bili zilizopita". Print ikifeli, hakuna kinachoondoka.
5. Dashibodi: kadi mpya "Oda za wahudumu zisizolipwa" (oda zilizotumwa/kuchapishwa lakini fedha haijapokelewa; si mauzo bado). Oda iliyokwisha lipwa kwa cashier haiwezi tena kufutwa (ilikuwa inaacha mauzo na fedha kwenye jumla za dashibodi).

Imethibitishwa: tsc, eslint, vitest (348 zimepita), production build. Hakuna deploy wala push. Dashibodi inasoma jumla zilizohifadhiwa; kama namba za zamani bado si sahihi, Super Admin atumie "rebuild" ya takwimu kwa biashara husika.

## Nyongeza: mpangilio wa risiti (bili, invoice na oda)
Risiti sasa inafuata muundo wa risiti ya mfano (Rudy's Farm), kwa karatasi 58mm, 80mm na A4:
logo ya biashara (kutoka Maintenance > Company) -> kichwa ("BILI YA MTEJA" kwa bili, jina la idara/"Sales" kwa invoice, "ODA" kwa oda) -> jina la biashara, anwani, TEL -> mstari wa vistari -> Muda wa kufungua, Muda wa kuchapa (unasasishwa wakati wa kuchapa), Namba ya bili (namba za invoice), Mhudumu, Mteja, Namba ya meza (oda) -> IDADI / BIDHAA / KIASI -> bidhaa -> JUMLA INAYODAIWA (+ Imelipwa na Deni likiwepo malipo) -> mistari ya Mteja na Maelezo (bili) -> maelezo ya malipo (Voda/Tigo/benki) -> maandishi ya chini ya risiti (footer) kutoka System settings.
Faili: `src/components/BillSheet.tsx`, `src/lib/print-waiter-order.ts`, `src/lib/receipt-branding.ts` (mpya), `convex/customerBills.ts` (logo), simu za kuchapa oda (Selling Point, foleni ya cashier, Bills panel, Sales). Jaribio jipya la mpangilio liko `print-waiter-order.test.ts`.
Kumbuka: "Guests" haipo kwa sababu mfumo hauhifadhi idadi ya wageni; "Namba ya meza" inaonekana kwenye oda/bili za oda tu (invoice za kawaida hazihifadhi namba ya meza).
