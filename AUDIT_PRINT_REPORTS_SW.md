# Ukaguzi wa Reports na Print — SmartHubPOS

## Mabadiliko yaliyofanyika
- `src/lib/print-area.ts`: uchapishaji unaendelea kutumia element iliyochaguliwa pekee kwenye iframe tofauti; hauchukui sidebar/dashboard ya ukurasa mzima.
- Print sasa inaficha inputs, selects, buttons na textarea kwenye nakala ya kuchapisha.
- Imeboreshwa kusubiri fonts na picha/logo zipakie (kwa muda wenye kikomo) kabla ya kufungua print dialog, pamoja na fallback ya browser.
- A4 portrait/landscape na paper sizes za 58mm/80mm zimehifadhiwa.
- `.env.local` imeondolewa kwenye ZIP ya kushirikisha. Tumia `.env.example` kutengeneza `.env.local` kwenye kompyuta/deployment yako; usipandishe `.env.local` GitHub.

## Sehemu za report zilizopitiwa kwa source
- Sales: `src/pages/sales/SalesRegister.tsx` na `src/pages/shared/report.tsx`.
- Stock: `src/pages/stock/StockWorkspace.tsx`.
- Payroll: `src/pages/payroll/Reports.tsx` na `src/pages/payroll/Payslip.tsx`.
- Purchasing: `src/pages/purchasing/reports/PurchaseReports.tsx` na `ReportSheet.tsx`.
- Financial period reports: `src/pages/accounts/PeriodReportPage.tsx`.
- Shared print utility: `src/lib/print-area.ts`.

## Uhakiki
- `npm run build` haikuweza kufika kwenye compile ya project kwa sababu dependencies/type definitions hazikuwa zimekamilika kwenye mazingira ya ukaguzi (`@types/node`, `@types/react` na nyingine hazipatikani). Hii si ushahidi wa build kufaulu au kushindwa kwenye mashine yako.
- Kabla ya ku-push, endesha `npm ci`, kisha `npm run build`, `npm test`, na `npm run lint`. Rekebisha errors zozote zinazoonekana kabla ya deployment.
- Uchapishaji wa browser hutegemea browser/printer settings; jaribu angalau Sales report, Stock report, Purchasing report, Period report na Payslip kwenye print preview.
