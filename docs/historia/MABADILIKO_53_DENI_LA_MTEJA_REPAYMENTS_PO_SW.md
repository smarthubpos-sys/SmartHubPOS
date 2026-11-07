# Mabadiliko 53 - Malipo kwa siku ya mauzo, deni la mteja, repayments, Purchase Orders

(Zip hii pia ina Mabadiliko 52: mauzo ni mauzo, yamelipwa au la.)

## 1. Malipo yanaenda siku ya mauzo
- `waiterCollections.collect`: bila tarehe, fedha zinahesabiwa kwenye siku ya bili (saa za Afrika Mashariki). Kubadili tarehe ni hiari (tiki "Badilisha tarehe ya malipo").
- Oda za siku tofauti: bila kuchagua tarehe, mfumo unakataa; pokea siku moja moja au chagua tarehe.
- Tarehe haiwezi kuwa ya baadaye wala kabla ya siku ya bili ya zamani zaidi.

## 2. Purchase Orders na Purchase Entry
- Purchase Orders inafunguka kama Purchase Entry: supplier, tarehe, na bidhaa zote kwenye jedwali (`PurchaseOrderEntry.tsx`).
- Baada ya kuhifadhi, order inaonekana kama karatasi ya A4 yenye vitufe vya Print / PDF na Save to Excel (`PurchaseOrderSheet.tsx`). Order zilizopo zinafunguliwa kwa orodha "Fungua order (PDF / Excel)".
- Purchase Entry: sehemu mpya "Pokea kutoka Purchase Order". Ukichagua order, bidhaa zinajaa na salio la kupokea (punguza / ongeza / sifuri); bidhaa za ziada zinaongezwa kwenye mistari tupu.
- Switch ya "Upload kwenye stock": ikiwa imewashwa, Hifadhi inaongeza kilichopokelewa kwenye stock; ikizimwa ni ukaguzi tu, hakuna kinachohifadhiwa.
- Order inabaki `partially_received` hadi kiasi chote kipokelewe, kisha `fully_received`.
- Order lazima iwe approved kwanza (kitufe cha Approve kipo kwenye orodha ya orders).

## 3. Elekeza deni la mhudumu kwa mteja
- Cashier: "Elekeza deni kwa mteja (mkopo)": chagua bili, chagua mteja aliyehifadhiwa (wa biashara/idara husika), bonyeza Elekeza.
- Kinachotokea: invoice ya mteja (tarehe ya mauzo, salesSource = Selling Point), journal (receivable / mauzo / gharama), na mhudumu hadaiwi tena. Ripoti za madeni zinaonyesha jina la mteja.
- Bili iliyoelekezwa kwa mteja haiwezi kufutwa (`cancel` na `cancelBillFromFinder` zinakataa).
- Sehemu ambayo mhudumu alishalipa inabaki kwake; mteja anapewa kiasi kilichobaki tu.

## 4. Kitabu cha Repayments (cashier)
- Chagua mteja, tiki madeni (au andika kiasi: linalipa la zamani kwanza), chagua njia ya malipo.
- Fedha inaingia kwenye cash ya siku ya leo (tarehe ni leo; unaweza kuibadilisha, si ya baadaye).
- Ripoti ya Payment Received inaonyesha "Repayment ya <jina la mteja>".
- List of Clients: safu mpya "Amelipa (kipindi)" pamoja na Balance (anachodaiwa).

## Faili mpya
`convex/customerDebt.ts`, `convex/waiterMath.ts`, `src/pages/waiter-orders/CustomerRepayments.tsx`, `src/pages/purchasing/PurchaseOrderEntry.tsx`, `src/pages/purchasing/PurchaseOrderSheet.tsx`, `src/lib/repayment.ts`, `src/lib/po-excel.ts`. Tests: `convex/customerDebt.test.ts`, `convex/purchaseOrderReceive.test.ts`, `src/lib/repayment.test.ts`, `src/lib/po-excel.test.ts`.

## Schema
Sehemu mpya za hiari tu (data ya zamani haivunjiki): `waiterOrders.assignedAmount/assignedClientId/assignedInvoiceId` na `purchases.purchaseOrderId`.
