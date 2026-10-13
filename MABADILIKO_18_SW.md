# MABADILIKO 18 — Purchasing: document ya kitaalamu na ripoti za kitaalamu

## 1. Purchase Invoice Document (muundo kama invoice ya Sakurahost)
Inafunguka kwa kitufe cha **Fungua / Open** kwenye Purchase Invoice List, Supplier Statement na Outstanding Supplier. Inachapishwa A4 / PDF.
- Juu: logo au jina la biashara upande mmoja; anwani, simu, email na TIN upande mwingine.
- Mstari mweusi wenye **Purchase Invoice #namba** na kisanduku cha hali chenye rangi: Paid (kijani), Partially paid (njano), Unpaid (nyekundu), Cancelled (kijivu).
- Tarehe ya invoice, tarehe ya mwisho kulipa (tarehe ya invoice + muda wa malipo wa supplier), namba ya invoice ya supplier, reference, aliyeandaa.
- Taarifa za supplier (jina, anwani, simu, email, TIN).
- Jedwali la bidhaa (#, maelezo, unit, idadi, bei, kiasi) lenye mistari ya kupishana rangi.
- Jumla ndogo, punguzo, gharama za ziada, kodi, **Total** (bar ya kijani), imelipwa, **deni lililobaki**.
- Chini ya mstari wa vistari: **Payment Receipt** yenye malipo yote ya invoice hiyo (tarehe, njia, reference, kiasi) na Amount Paid.
- Sehemu za sahihi (Prepared by / Approved by) na mstari wa mawasiliano wa biashara.

## 2. Ripoti za kitaalamu (zote zina letterhead ya biashara, kipindi, tarehe ya kutoa, KPI juu, jumla chini, sahihi, Print/PDF na Export CSV)
| Ripoti | Kilichoongezwa |
|---|---|
| Purchase Invoice List | hali yenye rangi, jumla (invoice zilizofutwa hazijumuishwi), kitufe cha kufungua document |
| Supplier Statement | muhtasari wa suppliers wote wenye **salio la mwanzo sahihi** (linajumuisha miamala kabla ya kipindi); ukichagua supplier: statement kamili yenye **salio linaloendelea** |
| Purchase Report | KPI 8, mwenendo wa kila mwezi wenye grafu ndogo |
| Purchase Analysis | yote ya juu + mabadiliko vs mwezi uliopita, hali ya malipo, suppliers 5 bora, bidhaa 5 bora (asilimia) |
| Purchase by Supplier | idadi ya invoice, jumla, wastani, imelipwa, deni, asilimia, ununuzi wa mwisho |
| Purchase by Product | idadi, jumla, gharama ya wastani, gharama ya mwisho, supplier wa mwisho, asilimia |
| Purchase Payment Report | malipo yote + muhtasari kwa njia ya malipo |
| Outstanding Supplier | **ageing**: bado hazijafika, 1–30, 31–60, 61–90, zaidi ya 90 siku, kwa kila supplier, pamoja na orodha ya invoice zilizo wazi na siku zilizopita; unachagua tarehe ya "As at" |
| Last Purchase Price | bei ya mwisho, ya awali, mabadiliko %, ya chini na ya juu |

## Faili
- Seva: `convex/purchaseReports.ts` (mpya), `convex/_generated/api.d.ts` (module imesajiliwa)
- Skrini: `src/components/PurchaseDocument.tsx`, `src/pages/purchasing/reports/{ReportSheet,PurchaseReports}.tsx`, `RegisterWorkspace.tsx` (ripoti sasa zinatumia muundo mpya)
- Tafsiri: `src/lib/i18n-dict-preports.ts`
- Majaribio mapya: `convex/purchaseReports.test.ts`, `src/pages/purchasing/reports/reports.test.tsx`

## Mipaka
- Orders, GRN na Returns hazijabadilika (bado jedwali la zamani).
- Uchapishaji ni A4 wima. Hakuna QR code kama ya sampuli.
- Last Purchase Price inatumia manunuzi ya kipindi ulichochagua.

## Uthibitishaji
`tsc -b` na `tsc -p convex` safi, `vite build` imefanikiwa, majaribio 80 yanapita (mapya 7). Uchapishaji halisi (A4 / Save as PDF) haujajaribiwa kwenye kivinjari; jaribu mara moja.
