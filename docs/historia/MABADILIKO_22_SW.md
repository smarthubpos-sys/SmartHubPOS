# MABADILIKO 22

## 1. Sold Item Report: chagua item moja na uichapishe
- Kila mstari una kitufe cha kuchagua (radio); kubonyeza mstari pia kunauchagua.
- Juu ya jedwali: aina ya printer (80mm / 58mm / A4), **Nakala** (idadi ya nakala, 1–10) na **Chapisha item iliyochaguliwa**.
- Slip inayochapishwa ina: jina la biashara, anwani, simu, namba ya invoice, tarehe, mteja, code, bidhaa, idadi, bei, discount na jumla. Haichapishi dashboard.
- Kwa hili `sales.salesRegisters` sasa inarudisha pia `company`.

## 2. Notifications: ukifungua inaonekana imesomwa mara moja
- Mabadiliko ya kusoma sasa yanaonekana papo hapo (optimistic update, `useMarkRead` kwenye `src/hooks/use-notifications.ts`): nukta/ujasiri unaondoka, notification inashuka chini ya ambazo hazijasomwa, na namba kwenye kengele inapungua bila kusubiri seva.
- Imetumika kwenye menyu ya kengele, ukurasa wa Notifications na popup ya matangazo.

## Uthibitishaji
`tsc -b` safi, `vite build` imefanikiwa, majaribio 103 yanapita. Uchapishaji haujajaribiwa kwenye printer halisi.
