# Mabadiliko 56 — Ripoti ya Generate sasa inalingana na Sales Report

## Tatizo
Sales Report ilihesabu kila oda ya Selling Point siku iliyouzwa (ilipwe isilipwe). Generate ilisoma journal (siku ya kupokea pesa), kwa hiyo cash iliyopokelewa siku nyingine ilipotea kwenye siku ya mauzo; pia `debts` ilisoma oda 2000 za zamani tu.

## Sheria mpya
1. Mauzo na mtaji wa Selling Point yanatoka kwenye oda, kwa siku ya mauzo (saa za EAT), kama Sales Report.
2. Pesa (CASH/LIPA/BANK) zinatoka kwenye journal kwa siku ya kupokea. Journal za `waiter_sale` hazihesabiwi tena kama mauzo/mtaji.
3. Siku HAIJAFUNGWA: pesa iliyopokelewa baadaye inarudi kwenye siku ya mauzo (cash ikiwemo).
4. Siku IMEFUNGWA (Unda Ripoti ya Siku): deni linahamia "Closed debts"; likilipwa baadaye ni MAREJESHO ya siku ya kupokea (leo). Haligusi mauzo ya siku iliyofungwa. Ripoti inaonyesha "Ikiwemo marejesho...".
5. `debts` na kufunga siku sasa zinasoma oda kwa tarehe (si kwa status), hakuna kikomo cha oda 2000 cha zamani.

## Faili
convex/reportCore.ts, convex/periodReport.ts, convex/waiterCollections.ts, src/pages/accounts/PeriodReportPage.tsx, src/pages/waiter-orders/WaiterCollection.tsx, src/lib/i18n-dict-paydate.ts, convex/periodReportStatement.test.ts, convex/periodReportWaiterSales.test.ts (mpya).

## Uthibitisho
tsc -b: 0 makosa; eslint (faili zilizoguswa): 0; vitest: 98 files, 670 tests zimepita (ikiwemo 4 mpya: unpaid, cash ya siku wazi, tarehe ya leo, siku iliyofungwa).

## Tahadhari
- Mauzo ya Generate hayajumuishi tax (Sales Report inajumuisha tax kwenye Jumla) wala hayakatwi returns kwa Sales Report; kama una tax au returns jumla zitatofautiana kwa kiasi hicho tu.
- Ripoti za siku zilizofungwa KABLA ya mabadiliko haya zinabaki kama zilivyo (hazibadilishwi). Ili kuzirekebisha: Futa (Super Admin) kisha Unda upya.
- Deploy: `npx convex deploy` kisha build ya frontend.
