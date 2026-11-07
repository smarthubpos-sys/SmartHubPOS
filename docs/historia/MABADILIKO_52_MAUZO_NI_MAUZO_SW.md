# Mabadiliko 52 — Mauzo ni mauzo: Selling Point inahesabiwa siku ya bili

Kabla: ripoti za Sales zilihesabu bili za wahudumu siku ambayo cashier alipokea fedha, na kiasi kilicholipwa tu. Bili iliyotumwa usiku na isiyolipwa haikuonekana kwenye ripoti ya siku hiyo.

Sasa (`convex/sales.ts` → `buildSalesRegister`):
1. Kila bili ya muhudumu iliyotumwa/ikichapishwa (pending / accepted / printed) inahesabiwa kuwa **mauzo ya siku ya bili** (saa za Afrika Mashariki), kwa jumla yake kamili, ikiwa imelipwa, imelipwa kiasi, au haijalipwa. Bili iliyofutwa na draft hazihesabiwi.
2. Kwenye ripoti, kila bili ni mstari mmoja wenye Jumla, Imelipwa na Deni. Mauzo ya mkopo na cash yako kwenye orodha moja.
3. Fedha zilizopokelewa zinabaki kwenye siku ya kupokea (`Jumla iliyopokelewa` / njia za malipo), pamoja na tarehe ya malipo iliyochaguliwa (Mabadiliko 51).
4. Ripoti za bidhaa, faida na gharama zinatumia bili nzima siku ya bili.
5. Day-end: deni la wahudumu sasa liko ndani ya "Deni" (jina: Wahudumu (Selling Point)), kwa hiyo mauzo = yaliyopokelewa + deni.
6. Sasa dashboard na ripoti za Sales zinatumia sheria moja ya "siku ya mauzo".

Tests zilizosasishwa: `waiterCollections.test.ts` (mauzo 4000 hata kama 1000 tu imelipwa) na `waiterCollectionDate.test.ts` (mkopo, saa 01:30, bili iliyofutwa).
Convex deploy inahitajika, kisha git push.
