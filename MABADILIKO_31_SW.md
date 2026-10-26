# Mabadiliko 31 - Waiter Orders (Weka Order -> Send / Print), Bills, Edit Business

## 1. Waiter Orders - mtiririko mpya
1. Mhudumu anajaza oda, anabonyeza **Weka Order**. HAPA TU stock inapungua (kila bidhaa inaingia kwenye Stock Movements kama `waiter_order`). Stock isiyotosha inakataliwa.
2. Oda iliyowekwa inaonyesha vitufe 2: **Send** (inatumwa kwa cashier) na **Print** (inachapishwa).
   Send na Print HAVIPUNGUZI stock (vimejaribiwa kwa tests).
3. Cashier anaiona oda kwenye skrini ya Waiter Orders **baada ya Send tu**. Hakuna kitufe cha "Pokea" tena: cashier anabonyeza **Print**, na hapo oda inapokelewa na kuchapishwa. Mhudumu anapata notification "Oda imepokelewa" (kengele ya notifications, inabaki siku 3). Kubonyeza Print mara ya pili hakudhuru.
4. Mhudumu anaona oda zake mwenyewe tu.
Backend: convex/waiterOrders.ts (`place`, `sendToCashier`, `markPrinted`, `markHandled`), schema (stockDeducted, sentAt, printedAt).

## 2. Bills
Vitufe viwili tu: **Send** (WhatsApp) na **Print**. Havihusiani na stock. Mhudumu anachagua invoice zake kama kawaida.

## 3. Edit Business - Save
`tenants.update` sasa inaonyesha hatua iliyoshindwa (jina/code, sarafu/Waiter settings, au audit log) badala ya "Server Error" tupu.
Chaguo la "Namna ya waiter orders" limeondolewa kwenye skrini (mtiririko mpya hauhitaji).

## Muhimu kabla ya kutumia
Deploy Convex (schema imebadilika): `npx convex deploy`. Tests zote 259 zimepita; tsc na eslint safi kwenye mafaili yaliyobadilika.

## Sehemu ya 2 - dirisha la Sales kwa waiter / waitress
- Kwa waiter au waitress (kama Waiter Orders imewashwa kwa role yake), kitufe cha "Hifadhi Invoice" kinabadilika kuwa **Weka Order**. Baada ya kubonyeza, vitufe **Send** na **Print** vinatokea. Stock inapungua kwenye Weka Order tu. Bei ya oda inachukuliwa kutoka bei ya bidhaa.
- Watumiaji wengine (cashier, meneja) wanaendelea kuona "Hifadhi Invoice" kama kawaida.
- **Futa oda** kwenye Waiter Orders inatumia ruhusa ile ile ya `sales.void` (Role Management / User Settings); stock inarudi.
- Makosa ya `sales:createInvoice` na ya Waiter Orders sasa yanaonyesha sababu halisi (mfano "Stock haitoshi kwa Bia", "si mteja wako") badala ya "Server Error" tupu. Production ilikuwa inaficha maandishi yote ya makosa ya kawaida.
