# MABADILIKO 51 - Jumla ya pesa zilizopokelewa (Cash + Mobile + Bank)

Tatizo: Mauzo (jumla) yalikuwa sawa, lakini jumla ya pesa zilizopokelewa (CASH + LIPA + BANK) haikulingana kwenye skrini tofauti.

Sababu mbili zilizopatikana (zimejaribiwa kwa test, zote zimerekebishwa):

1. Ripoti ya Sales (kadi "Malipo yaliyopokelewa"): ilihesabu malipo ya wateja (invoices) tu na kuacha pesa alizopokea cashier kutoka kwa wahudumu (Selling Point).
   Mfano: bili ya mhudumu 10,000 ilipokelewa (cash 6,000 + M-Pesa 4,000) - kadi ilionyesha 0, wakati "Muhtasari wa hesabu" ulionyesha 10,000.
   Sasa: kadi inaonyesha jumla kamili (wateja + Selling Point, njia zote) - ni namba ile ile ya "Jumla iliyopokelewa" kwenye muhtasari.
   Faili: convex/sales.ts (totals.received mpya), src/pages/sales/SalesRegister.tsx

2. Ripoti ya Daily/Monthly (sehemu 4 "Pesa Zilizopokelewa"): invoice iliyolipwa kisha ikapunguzwa (Edit invoice) ikarudishwa pesa kwa mteja - marejesho hayakutolewa kwenye CASH/LIPA/BANK, kwa hiyo jumla ilikuwa kubwa kuliko ya kweli.
   Mfano: invoice 10,000 ililipwa cash, ikapunguzwa hadi 4,000 (marejesho 6,000) - Daily report ilionyesha 10,000, Dashboard na Sales ilionyesha 4,000.
   Sasa: marejesho ya Edit invoice yanatolewa; skrini zote zinaonyesha 4,000.
   Faili: convex/reportCore.ts (cashSource: sale_edit -> customer_refunds)

Zilizojaribiwa na zinalingana kwenye skrini zote (Sales card, Muhtasari, Daily report, Dashboard Cash Received): malipo ya mchanganyiko cash+mobile+bank, kulipa sehemu, counter sale, void invoice, unpay, return items, kufuta bili iliyolipwa (refund).

Test mpya: convex/receivedTotals.test.ts
Test: 672 zinapita (faili 99), tsc inapita.
Convex deploy inahitajika (npx convex deploy), kisha push GitHub kwa Vercel.

Kumbuka (haijabadilishwa kwa makusudi): bili ya mhudumu iliyouzwa jana na kupokelewa leo inahesabiwa siku ya kuuzwa (jana), si siku ilipopokelewa - kwa hiyo "Cash Received" ya leo haiioni. Ukitaka ihesabiwe siku ilipopokelewa, niambie.
