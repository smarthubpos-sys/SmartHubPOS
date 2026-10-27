# MABADILIKO 36 — Malipo ya sehemu kwa cashier + logo ya aina yoyote

## 1. Cashier: kupokea kiasi kidogo kuliko bili (deni la mhudumu)
Kabla: mfumo ulilazimisha kupokea jumla yote ya oda.
Sasa: cashier anaandika kiasi alichonacho mhudumu mkononi (njia moja au nyingi). Kiasi kisichozidi deni na kisicho sifuri.
- Pesa inagawanywa oda kuanzia ya zamani zaidi. Oda iliyolipwa yote inafungwa; ya sehemu inabaki na deni (`waiterOrders.paidAmount`).
- Deni linaonekana: kwenye skrini ya Cashier ("Deni litakalobaki", "imelipwa X kati ya Y"), kwenye "Zilizopokelewa leo", kwenye risiti ya malipo ("DENI LILILOBAKI"), kwenye Dashboard (oda zisizolipwa = kilichobaki tu), na kwenye ripoti ya Sales (Madeni ya wahudumu: yaliyotokea siku hiyo na yaliyobaki bado).
- Mapato, gharama ya bidhaa (COGS), stock earnings, takwimu za dashboard na bidhaa zinazouzwa zaidi zinahesabu sehemu iliyolipwa tu (cash basis, kama ilivyokuwa). Malipo ya baadaye ya deni yanaingia siku yanapopokelewa.
- Oda iliyolipiwa kiasi haiwezi kufutwa.
Faili: `convex/waiterCollections.ts`, `schema.ts` (`paidAmount`, `allocations`, `settledCount`, `shortfall`), `sales.ts`, `stats.ts`, `inventory.ts`, `dashboard.ts`, `waiterOrders.ts`, `WaiterCollection.tsx`, `SalesRegister.tsx`, `print-payment-receipt.ts`.

## 2. Logo: faili la logo linatambuliwa (si picha tu)
Kabla: logo ya zaidi ya KB 300 ilikataliwa, na faili bila aina ya picha halikutambuliwa.
Sasa (`src/lib/logo-image.ts`): inakubali jpg/jpeg/jfif/png/webp/gif/bmp/svg kwa aina au kwa jina la faili; logo kubwa (mfano 2576x2576) inapunguzwa yenyewe hadi 480px na kubanwa chini ya KB 250, haikatalwi. Faili lisilo picha linakataliwa kwa ujumbe wazi.

## Majaribio
`tsc -b` safi, eslint safi, vitest 394/394 (mapya: malipo ya sehemu, oda ya zamani kwanza, logo). Jaribio la zamani la "kiasi kidogo kinakataliwa" limebadilishwa. `vite build`, deploy na kuchapa kweli hazijaendeshwa.

## Hatua
`npx convex dev` (schema ina sehemu mpya za hiari, data ya zamani haiathiriwi) > `npm run build` > deploy.
