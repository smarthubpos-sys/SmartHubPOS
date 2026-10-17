# Mabadiliko 30 — kurekebisha vitest 2 zilizoshindwa

1. `convex/features.test.ts` (biometric/WebAuthn): server inakataa kazi bila `APP_ORIGIN` (fail closed, kwa usalama). Test sasa inaweka `APP_ORIGIN=http://localhost:5173` kwa `vi.stubEnv` na kuiondoa baada ya test. Imeongezwa test mpya inayothibitisha kuwa bila `APP_ORIGIN` usajili unakataliwa.
2. `convex/idempotency.test.ts`: `sales.createInvoice` sasa inapokea `requestKey` (hiari). Ufunguo ule ule ukitumwa tena hurudisha invoice ile ile (`duplicate: true`) bila kuunda invoice ya pili wala kupunguza stock mara mbili.
   - `convex/schema.ts`: `invoices.requestKey` + index `by_tenant_request_key` (hiari, data za zamani hazibadiliki).
   - `src/pages/sales/InvoiceEntry.tsx`: inatuma `requestKey` moja kwa kila jaribio la kuuza; inabadilishwa baada ya kuhifadhi kwa mafanikio.

Endesha: `npm test`, `npx tsc -b`, `npm run lint`. Kisha `npx convex dev --once` ili schema mpya (index) ipelekwe.
