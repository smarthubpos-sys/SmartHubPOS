# SmartHubPOS - marekebisho ya Selling Point (2026-10-25)

Faili hizi ni zile zilizobadilishwa/mpya tu. Nakili kwenye mradi wako (njia zile zile), usiandike juu ya backup zako.

Backend: convex/maintenance.ts, waiterOrders.ts, waiterSettings.ts, sellingPointAccess.test.ts (mpya)
Frontend: src/lib/i18n.ts, i18n-dict-sellingpoint.ts, i18n.test.ts, selling-point-access.ts (mpya), selling-point-access.test.ts (mpya),
  src/pages/layout/Applayout.tsx (CRLF), _components/sidebar.tsx, src/pages/maintenance/UsersPage.tsx, src/pages/waiter-orders/SellingPoint.test.tsx (mpya)

Kagua: npx vitest run ; npx tsc -b ; npx eslint . --max-warnings=0
Production HAIJABADILISHWA. Usi-deploy bila kuthibitisha: npx convex function-spec --prod (kusoma tu), kisha npx convex deploy --dry-run.
