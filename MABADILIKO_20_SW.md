# MABADILIKO 20 — Kila malipo yanaenda kwenye akaunti ya njia yake

## Tatizo
Malipo yote (simu, benki, cash) yalikuwa yanaingia kwenye akaunti moja ya "Cash and equivalents" (1000) kwenye ledger.

## Marekebisho
- Kila njia ya malipo (Maintenance → Njia za Malipo) sasa ina akaunti yake kwenye ledger (inaundwa mara ya kwanza ikitumika, namba 1300 kuendelea). Njia ya aina "Cash" inaendelea kutumia akaunti 1000. Ukibadilisha jina la njia, jina la akaunti linafuata.
- Inatumika kwenye: Pokea Malipo (Sales), malipo ya awali ya invoice, Supplier Payment, malipo wakati wa Purchase Entry, Bili (Expenses), Mapokezi ya Mtaji na Mishahara.
- Skrini za Expenses, Capital na Payroll sasa zinaonyesha njia zako za malipo (si Cash/Bank/Mobile tu).
- Mpya: `paymentMethods.balances` (salio la kila njia kutoka ledger) na `paymentMethods.repairOldPayments` (kuhamisha malipo ya zamani yaliyokaa kwenye Cash kwenda akaunti za njia zao; inaweza kuendeshwa tena bila madhara).
- Malipo ya zamani yenye njia za zamani (`bank`, `mobile`) yanaenda 1010 Bank / 1020 Mobile money.

## Uthibitishaji
`tsc -b` safi; majaribio 99 yanapita (6 mapya kwenye `convex/methodAccounts.test.ts`).

## Muhimu
- Baada ya kuweka zip, endesha `npx convex dev` (au deploy) ili schema mpya ipakiwe.
- Kwa data ya zamani, mwita `paymentMethods.repairOldPayments` mara moja (kama meneja).
- Skrini hazijajaribiwa kwenye kivinjari halisi hapa.
