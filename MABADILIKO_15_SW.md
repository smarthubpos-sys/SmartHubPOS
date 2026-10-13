# MABADILIKO 15

## 1. Kadi za biashara (Admin dashboard)
- Kila biashara sasa ni kichipu kidogo (nukta ya hali, jina, code na idadi ya idara), safu 2 kwenye simu, 3 tablet, 4 kwenye skrini kubwa. Biashara 10 zinakaa kwenye safu 2-3 tu.
- Ukibonyeza kichipu kinafunguka kwa upana mzima na kuonyesha usajili, jumla iliyolipwa na vitufe (Ingia, Simamisha/Washa, Usajili, Hariri).

## 2. Edit Business: Idara (departments)
- Paneli ya "Hariri biashara" sasa ina sehemu ya **Idara / sehemu za biashara**: orodha ya idara zilizopo (X kuondoa) na kisanduku cha kuongeza idara mpya (kitufe au Enter). Inafanya kazi kwenye Business Picker na kwenye ukurasa wa Super Admin.
- Idara yenye watumiaji au rekodi haiwezi kuondolewa (ujumbe unaeleza).

## 3. Invoicing — uza bidhaa
- Kwenye orodha ya invoices chini: chagua invoice moja (radio) kisha **Chapisha invoice iliyochaguliwa**; unaweza pia kuchagua aina ya printer (80mm / 58mm / A4) na kutuma WhatsApp.
- Invoice ikihifadhiwa, inaonekana mara moja kwa muundo uleule wa Bili (jina la biashara, anwani, simu, namba ya invoice, mteja, bidhaa/idadi/bei/jumla, jumla, imelipwa, deni).
- **Kuchapisha**: sasa kunafanyika kwenye fremu tofauti isiyoonekana (`src/lib/print-area.ts`), kwa hiyo menyu, dashboard na vichwa vya ukurasa havichapishwi tena. Imetumika pia kwenye Bills na kwenye risiti ya malipo.
- `BillSheet` imehamishiwa `src/components/BillSheet.tsx` ili itumike Bills na Sales.

## Uthibitishaji
`tsc -b` safi, `vite build` imefanikiwa, majaribio 69 yanapita. Uchapishaji haujajaribiwa kwenye printer/kivinjari halisi hapa; jaribu kwa 80mm/58mm/A4 (angalia "Save as PDF" kwanza).
