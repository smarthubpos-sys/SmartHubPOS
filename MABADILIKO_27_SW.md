# Mabadiliko 27 — Ruhusa ya kufuta (kubatilisha) oda

Kabla: ni meneja pekee aliyeweza kubatilisha invoice. Sasa unachagua nani.

## Namna ya kutoa ruhusa
1. **Kwa role nzima:** Maintenance → Role Management → Hariri role → kundi la *Sales* → tiki
   **"Delete / cancel orders"** (`sales.void`) → Hifadhi role.
2. **Kwa mtumiaji mmoja:** Maintenance → User Settings → Modify mtumiaji →
   *"Ruhusa maalum kwa mtumiaji huyu"* → tiki **"Anaweza kufuta / kubatilisha oda"** → Hifadhi.
   (Haiwezi kubadilishwa kwenye akaunti yako mwenyewe.)

Kitufe cha "Batilisha invoice iliyochaguliwa" (Sales → Invoicing) kinaonekana kwa wenye ruhusa tu,
na server pia inakagua (mtu asiye na ruhusa anakataliwa hata akijaribu kwa njia nyingine).

## Muhimu
- Role za mfumo: Administrator na Manager wanayo ruhusa hii kwa chaguo-msingi; Cashier, Accountant, Viewer hawana.
- Kama role ya Manager ilishahaririwa na kuhifadhiwa awali, fungua Role Management na tiki ruhusa hii mara moja.
- Kila ubatilishaji unaingia kwenye Audit Trail.

## Faili zilizobadilika
convex/permissions.ts, schema.ts, access.ts, maintenance.ts, sales.ts, tenants.ts, salesVoid.test.ts;
src/pages/maintenance/UsersPage.tsx, src/pages/sales/InvoiceEntry.tsx

---

# Sehemu ya 2 — Purchasing: Edit na Delete kila mahali (swichi 2)

Kuna ruhusa **mbili tofauti**, kila moja unaweza kumpa role nzima au mtu mmoja ambaye si meneja:

| Ruhusa | Inaruhusu |
|---|---|
| `purchasing.edit` — "Edit purchase invoices, purchase orders and GRNs" | Kuhariri |
| `purchasing.delete` — "Delete / cancel purchase invoices, orders, GRNs and purchase returns" | Kufuta (kubatilisha) |

**Namna ya kuweka:** Role Management → role → kundi *Purchasing* → tiki moja au zote mbili.
Au kwa mtu mmoja: User Settings → Modify → *"Ruhusa maalum kwa mtumiaji huyu"* → tiki
"Anaweza ku-edit Purchase" na/au "Anaweza kufuta Purchase".
Administrator na Manager wanazo kwa chaguo-msingi.

## Wapi vitufe vinaonekana (kwa wenye ruhusa tu)
- **Purchase Entry** — orodha ya "Purchase zilizopostiwa" (safu mpya ya *Vitendo*)
- **Purchase Invoice List** (ripoti) — kitufe kando ya *Open*
- **Purchase Orders**, **Goods Received Notes**, **Purchase Returns** — safu ya *Vitendo*

## Kila kitu kinafanya nini
| Hati | Edit | Futa |
|---|---|---|
| Purchase invoice | tarehe, namba ya invoice ya supplier, maelezo, bidhaa/qty/gharama. Stock, gharama wastani, deni la supplier na ledger zinarekebishwa kwa **tofauti tu** | stock inatolewa, malipo ya wakati wa kupokea yanarudi kwenye akaunti yake, deni linafutwa, ledger inabaki sawa |
| Purchase Order | supplier, tarehe, bidhaa (kabla ya kupokea) | inabatilishwa (GRN za rasimu zinabatilishwa pia) |
| GRN | GRN ya rasimu tu: tarehe, maelezo, kiasi | ya rasimu au iliyothibitishwa (stock inatolewa, PO inafunguka tena) |
| Purchase Return | — | bidhaa zinarudi stock, deni la supplier linarudishwa |

Hakuna kinachofutwa kabisa: hati inabaki na hali "cancelled", inatoka kwenye jumla na ripoti zote, na kila kitendo kinaingia Audit Trail.

## Vizuizi (kwa usalama wa hesabu)
- Invoice yenye Purchase Return: futa return kwanza.
- Hairuhusiwi kupunguza/kufuta kiasi ambacho stock yake imeshauzwa au kutumika (mfumo unaeleza bidhaa gani).
- Jumla mpya ya invoice haiwezi kuwa chini ya kilicholipwa tayari.
- PO yenye bidhaa zilizopokelewa: futa GRN kwanza.

## Bado haijafanywa
- **Supplier Payment** (malipo ya supplier yanayotolewa baadaye): bado hayana Edit/Futa. Malipo hayo hugawanywa kwa invoice za zamani kwanza, na hakuna rekodi ya mgawanyo huo; kuyafuta kwa usahihi kunahitaji kuongeza rekodi hiyo kwanza.
- Kubadilisha supplier wa invoice iliyopostiwa.

## Faili mpya / zilizobadilika
Mpya: convex/purchasingEdit.ts, convex/purchasingEdit.test.ts, src/components/PurchaseManage.tsx, src/hooks/use-purchase-rights.ts
Zilizobadilika: convex/permissions.ts, schema.ts, tenants.ts, purchasing.ts, purchaseReports.ts, paymentMethods.ts, _generated/api.d.ts;
src/pages/layout/_components/ModuleWorkspace.tsx, src/pages/purchasing/RegisterWorkspace.tsx, src/pages/purchasing/reports/PurchaseReports.tsx
