# Mabadiliko 51 — Ripoti za mauzo (tarehe) na tarehe ya malipo

## 1. Ripoti za mauzo
- Ripoti zote za Sales zinatumia upau mmoja wa tarehe (`DateRange` kwenye `src/pages/shared/report.tsx`): tarehe, kisanduku cha **Siku moja**, au Kuanzia–Mpaka, kitufe cha **View Report**, na vitufe vya haraka: Leo, Jana, Siku 7, Mwezi huu.
- Kila ripoti ya Sales inafunguka kwa **siku ya leo tu**. Chagua tarehe kisha bonyeza View Report ili kuona mauzo ya siku hiyo.
- Hata Payment Received na List of Clients zina View Report sasa.
- Kosa la tarehe lililorekebishwa: tarehe za ripoti zilikuwa zinatumia UTC, kwa hiyo kati ya saa 6:00 usiku na 9:00 alfajiri (EAT) zilionyesha jana. Sasa zinatumia saa za Afrika Mashariki (`today()` kwenye `report-utils.ts`). Tarehe ya awali ya Invoicing nayo imerekebishwa hivyo.

## 2. Tarehe ya malipo (Pokea fedha za wahudumu)
- `convex/waiterCollections.ts` → `collect` inapokea `paymentDate` (hiari). Bila hiyo, inabaki leo kama zamani.
- Mauzo ya usiku yakilipwa asubuhi, cashier anachagua tarehe ya siku ya mauzo; fedha, journal na dashboard vinahesabiwa siku hiyo.
- Mipaka: si ya baadaye, na si kabla ya siku ya oda ya zamani zaidi iliyochaguliwa. Kipindi kilichofungwa bado kinakataliwa.
- Muda halisi wa kuingiza unabaki kwenye `createdAt`, na audit log inaandika "tarehe ya malipo X (iliingizwa Y)" kama tarehe ilibadilishwa.
- Orodha ya "Zilizopokelewa" ina kichagua tarehe, ili risiti ya tarehe ya nyuma isipotee.

## Tests mpya (hazijaendeshwa bado)
- `convex/waiterCollectionDate.test.ts`
- `src/pages/shared/report-utils.test.ts`

Endesha: `npx vitest run convex/waiterCollectionDate.test.ts src/pages/shared/report-utils.test.ts`, kisha `npx tsc -b`, `npx eslint .` na `npm run build`.
