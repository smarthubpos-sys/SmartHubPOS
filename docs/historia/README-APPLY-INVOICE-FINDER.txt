SMART HUB POS — INVOICE FINDER: EDIT / DELETE-CANCEL / PRINT

PATCH INAYO BADILISHA:
1. convex/waiterOrders.ts
2. convex/sellingPoint.test.ts
3. src/pages/sales/InvoiceFinder.tsx

MABADILIKO:
- Selling Point bills sasa zinaonyesha Print, Edit na Delete / Cancel kulingana na ruhusa sales.print, sales.edit na sales.void.
- Edit inasasisha jina la mteja, meza, maelezo, quantity, bei na punguzo kwenye waiterOrder ileile.
- Invoice number haibadilishwi.
- Stock ya mistari ya zamani inarudishwa kwa stock movement, kisha stock ya mistari mipya inakatwa tena ndani ya mutation moja. Ikishindikana, Convex mutation hurudisha mabadiliko yote nyuma.
- Edit inafungua tena hali ya kuchapisha kwa kuondoa billPrintedAt.
- Delete/Cancel inahitaji sababu; haitafuta rekodi. Inaweka status=cancelled na kurudisha stock.
- Bili zilizopokelewa na cashier, zilizolipwa au zenye settlement/collection haziruhusiwi ku-edit/cancel.
- Bili zilizobatilishwa zinaendelea kupatikana kwenye Invoice Finder kwa historia.

JINSI YA KUTUMIA:
1. Fanya backup ya mafaili 3 yaliyotajwa.
2. Extract ZIP ndani ya folder kuu la SmartHubPOS na ukubali Replace kwa mafaili hayo tu.
3. Endesha:
   git diff --check
   npx tsc -b
   npx vitest run convex/sellingPoint.test.ts
   npx vitest run
   npm run lint
   npm run build
4. Kagua git diff kabla ya commit/push.

USIFANYE:
- Usifanye Convex deploy kabla ya vipimo vyote kupita.
- Usifute invoice record kwa database.
- Usibadilishe invoice number iliyopo.
- Usitumie patch hii kwenye production bila kujaribu kwanza local.

HALI YA UHAKIKI:
Patch hii imetengenezwa kwa kuangalia source ZIP uliyotuma. Mazingira ya hapa hayana node_modules, kwa hiyo TypeScript, lint na Vitest hazijaendeshwa hapa. Lazima vipimo viendeshwe kwenye kompyuta yako kabla ya push/deploy.
