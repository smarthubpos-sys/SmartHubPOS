# Mabadiliko 11 — Risiti za Sales/Purchase na Cashier

- Risiti ya mauzo inaonekana baada ya kuhifadhi invoice, na ina kitufe cha kuchapisha.
- Risiti za kupokea malipo ya wateja zina chaguo la printer 58mm, 80mm na A4.
- Risiti za malipo ya supplier (malipo ya purchase ya awali na Supplier Payment) zinatumia component moja ya kuchapisha.
- Risiti zote zinatumia jina/anwani/simu/email/TIN ya kampuni na Receipt footer text kutoka System Setup.
- Sehemu ya malipo ya awali imeondolewa kwenye fomu kuu ya Sales. Invoice inatengenezwa bila malipo; cashier ndiye anayepokea malipo kupitia Cashier — Pokea Malipo kwenye dashboard ya mtumiaji mwenye role ya cashier.
- Kiungo cha Payment Received kimeondolewa kwenye menu ya kawaida ya Sales.
- Backend ya sales.recordPayment sasa inaruhusu role ya cashier au manager pekee; createInvoice inakataa paymentAmount isiyo sifuri ili malipo yasifanywe kwenye fomu ya invoice.

## Ukaguzi
Build haikuweza kuthibitishwa katika mazingira haya: `npm ci` ilikatizwa na timeout, na `npm run build` iliripoti type definition packages zinazokosekana kwenye node_modules. Tafadhali endesha `npm ci` na `npm run build` kwenye mazingira yenye mtandao kabla ya deploy.
