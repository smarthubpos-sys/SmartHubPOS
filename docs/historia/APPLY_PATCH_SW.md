# SmartHubPOS — Warehouse Branch Isolation Patch

## Muhimu
Haya ni marekebisho yaliyotengenezwa kutokana na `convex/warehouses.ts` na `convex/warehouses.test.ts` ulizotuma. Hayajaendeshwa ndani ya repo yako ya Windows; lazima tests zipite kabla ya commit/push/deployment.

## Kutumia kwa usalama
1. Fungua PowerShell kwenye `C:\Users\ageof\OneDrive\Desktop\SmartHubPOS`.
2. Hakikisha backup yako `.ix-backup\warehouse-final-20261017-151659` bado ipo.
3. Nakili mafaili ya ZIP kwenda folder ya muda, kisha linganisha yaliyomo.
4. Kabla ya kubadilisha faili za project, tengeneza backup mpya ya mafaili mawili.
5. Nakili `warehouses.ts` na `warehouses.test.ts` kutoka ZIP kwenda `convex\` (overwriting baada ya backup).
6. Endesha:
   - `npx vitest run convex/warehouses.test.ts`
   - `npm test`
   - `npm run lint`
   - `npm run build`
7. Ukiona error, usifanye commit/push; tuma output yote ya error.

## Mambo yaliyolengwa
- Queries za warehouses/stock/movements/valuation/loss/reconcile kuchuja branch iliyochaguliwa.
- Writes na transfer lifecycle kuangalia branch access ya source/destination.
- Idempotency key isiweze kurudisha result ya movement/transfer kutoka warehouse au operation tofauti.
- Tests za branch isolation na transfer dispatch/receipt.

## Tahadhari
Patch hii inategemea `user.branchId` kuwa tawi lililochaguliwa na profile ya mtumiaji. Inahifadhi tenant-wide access kwa watumiaji wasio na `branchId`, kulingana na tabia iliyopo kwenye project. Hii haibadilishi schema wala kufanya migration.
