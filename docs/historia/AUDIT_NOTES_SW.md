# SmartHubPOS — Ukaguzi wa Ruhusa

## Lengo
Hii ni pakiti ya kukagua faili zilizotolewa kwenye `SmartHubPOS(20261025-155854).zip`. **Si ZIP ya ku-deploy production** na haibadilishi mfumo live.

## Tofauti muhimu kati ya ZIP na log
ZIP hii haifanani na code iliyotoa log ya tests ya baadaye: 
- `SYSTEM_ROLES` hapa inaweka Waiter/Waitress na ruhusa za `sales.view`, `sales.manage`, `sales.print` pekee.
- `convex/waiterOrders.ts` hapa inakagua `sales.view` / `sales.manage` kwa Selling Point, si `waiterOrders.view` / `waiterOrders.manage`.
- Log uliyotuma baadaye inahitaji `waiterOrders.view` na `waiterOrders.manage`, na inaonyesha Waiter/Waitress wawe Selling Point pekee. Hiyo ni hali tofauti ya code.

## Kwa nini sijaweka patch moja kwa moja
Patch kwenye ZIP hii haiwezi kuhakikisha inarekebisha code halisi iliyotoa log ya mwisho. Inaweza pia kubadilisha ruhusa za wafanyakazi kwa bahati mbaya. `sales.*` na `waiterOrders.*` lazima zibaki ruhusa tofauti; kutoa moja hakupaswi kutoa nyingine moja kwa moja.

## Hatua salama inayofuata
Tumia matoleo ya sasa kabisa kutoka working tree ya faili hizi: `permissions.ts`, `access.ts`, `rolePermissions.test.ts`, `sellingPoint.test.ts`, `waiterSwitches.test.ts`, `waiterOrders.ts`, `waiterSettings.ts`. Endesha tests kwenye code hiyo hiyo. Usipush wala ku-deploy mpaka tests na build zipite.

## Hali ya uthibitisho
- Faili zimekusanywa kwa ukaguzi: ndiyo
- Fix imetekelezwa: hapana
- Tests zimeendeshwa kwenye pakiti hii: hapana
- Production/Convex ime-deployiwa: hapana
