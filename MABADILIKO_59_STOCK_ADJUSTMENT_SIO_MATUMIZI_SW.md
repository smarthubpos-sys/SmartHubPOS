# MABADILIKO 59 - Stock adjustment haihesabiwi kama matumizi kwenye ripoti

Tatizo: marekebisho ya stock (Quantity Adjustment na Stock Take) yanaandikwa kwenye journal kwa akaunti 5200 (Stock shrinkage) / 5100 (Stock adjustment gain),
ambazo ni akaunti za "expense". Ripoti ya Siku/Mwezi/Mwaka iliyahesabu kama Matumizi na kupunguza faida.

Suluhisho: mistari ya matumizi ya journal yenye sourceType "stock_adjustment" haisomwi tena kwenye ripoti.
- convex/reportCore.ts (entryRows): inaruka mistari ya expense ya stock_adjustment -> Matumizi, faida na daily havibadiliki.
- convex/periodReport.ts: haiingizi stock adjustment kwenye orodha ya matumizi (items).
- convex/accounting.ts (profitAndLoss): journal za stock_adjustment hazihesabiwi kwenye Income Statement.
- convex/reportCore.test.ts: test mpya.

Tahadhari:
- Quantity ya stock, stock movements, na journal (Inventory 1200) HAVIJABADILIKA; Stock Value / Closing Stock zinaendelea kuwa sahihi.
- Balance Sheet bado inajumuisha journal hizo (ili ibaki ikilingana na thamani ya Inventory); Income Statement haizijumuishi.
- Ripoti zilizohifadhiwa (reportRuns) kabla ya mabadiliko haya hazibadiliki; zalisha upya ukitaka.

Endesha: npx vitest run convex/reportCore.test.ts ; npx tsc -b ; npx eslint . ; npx convex deploy ; npm run build
HAIJAJARIBIWA (hakuna node_modules kwenye ZIP).
