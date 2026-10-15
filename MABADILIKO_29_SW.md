# Mabadiliko 29 — Marekebisho ya ukaguzi kamili (usalama, hesabu, uthibitishaji)

**Imethibitishwa kwa kuendesha:** `tsc -b` safi, `eslint --max-warnings=0` safi, tests 165/165 zinapita (28 files), `vite build` inafanikiwa.

## Usalama
| # | Tatizo | Marekebisho |
|---|---|---|
| 1 | `jwt_private_key.pem` ilikuwa kwenye mradi, haipo kwenye `.gitignore` | Faili imeondolewa kwenye zip hii; `*.pem` na `*.key` zimeongezwa `.gitignore`. **Wewe lazima** utengeneze ufunguo mpya na uuweke Convex (`JWT_PRIVATE_KEY` + `JWKS`) kwa sababu wa zamani ulishashirikiwa. Wote watatoka (sign out) mara moja. |
| 2 | `requirePasswordChange` ilikuwa UI tu | `requireActiveUser` sasa inakataa kila ombi la seva hadi nenosiri libadilishwe (isipokuwa kubadili nenosiri lenyewe). `Applayout` haiombi settings wakati huo. |
| 3 | `changeOwnPassword` haikufuta sessions za vifaa vingine | Sessions zote zinafutwa isipokuwa ya sasa. |
| 4 | Super Admin bila biashara alichaguliwa biashara ya kwanza kimya kimya | Ikiwa biashara ni zaidi ya moja, seva inakataa na kuomba achague biashara kwanza. |

## Hesabu na data
| # | Tatizo | Marekebisho |
|---|---|---|
| 5 | GRN iliongeza stock bila journal | Kuthibitisha GRN: Dr Inventory 1200 / Cr "Goods received not invoiced" 2050. Kufuta GRN kunarudisha zote mbili. |
| 6 | `NaN` ilipita kwenye discount, taxRate, paymentAmount (invoice na purchase) | `assertFinite` kwenye `createInvoice`, `receivePurchase`, `inventory.adjust`. |
| 7 | Tarehe ovyo ilikubaliwa | `assertDate` (tarehe halisi ya kalenda) kwenye invoice, malipo, marejesho, purchase, PO, GRN, purchase return, malipo ya supplier, marekebisho ya stock, edit ya purchase/PO/GRN. Kubadili tarehe ya purchase kwenda kipindi kilichofungwa sasa kunakataliwa. |
| 8 | Faida ya marekebisho ya stock iliingia kama "revenue" | Inaingia kama akaunti ya expense (inapunguza gharama). Akaunti 5100 zilizokwisha kuundwa zinabaki kama zilivyo. |
| 9 | `balanceSheet` haikubalansi | Imeongeza mstari "Current period earnings" (3999) kwenye Equity. |

## Kasi / kiwango
- `profitAndLoss`, `balanceSheet`, `trialBalance`: zinasoma kwa index ya tarehe/entry badala ya jedwali zima (P&L inategemea kipindi tu).
- `reconcileMovements`: ilikuwa bidhaa×movements; sasa inapanga mara moja.

## Lint / tests
- `departmentIsolation.test.ts`: fixture imerekebishwa (tawi la biashara U linaundwa kwenye test inayolihitaji tu) na `db.get` ina jina la table.
- `BusinessPicker.tsx`: hakuna `setState` ndani ya effect.
- `maintenance.ts`: makosa yana `cause`.
- Tests mpya: `convex/hardening.test.ts` (GRN journal na kufuta, NaN, tarehe, balance sheet, nenosiri la lazima, Super Admin).

## Lebo / nyaraka
- Dashboard: "Fedha zilizopokelewa (kwa tarehe ya invoice)" (ilikuwa inaelezea vibaya).
- README: akaunti ya kodi 2150, maelezo ya GRN na usalama.

## Yaliyobaki kwa makusudi (fahamu)
1. **GRN na invoice ya supplier:** invoice ya supplier ya bidhaa zilizopokelewa kwa GRN isiingizwe tena Purchase Entry (stock ingehesabiwa mara mbili). Salio la 2050 linasafishwa na mhasibu kwa journal ya mkono. Kuunganisha GRN→invoice kiotomatiki ni kazi ya baadaye.
2. `trialBalance`/`balanceSheet` bado zinasoma historia yote hadi tarehe husika (asili ya ledger); hazitumiki kwenye UI. Ripoti ya "quantity" ya Stock (historia kamili) bado inasoma movements zote.
3. Bei ya kuuza chini ya gharama inaruhusiwa (cashier anaweza kubadili bei).
4. Bei ya wastani ya gharama inahifadhiwa kwa desimali 2.
