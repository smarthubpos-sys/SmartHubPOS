# MABADILIKO 16 — Kuandaa mfumo kwa watumiaji 100+ na data ya miaka 2+

Lengo: mfumo uendelee kuwa wa haraka na sahihi watumiaji wakifika 100 na historia ya mauzo ikikua.

## Yaliyorekebishwa

| # | Tatizo | Marekebisho | Faili |
|---|--------|-------------|-------|
| 1 | Kila login ilisoma jedwali zima la `users` na kuandika `lastLogin` kila mara (watu wengi wakiingia pamoja waligongana) | Skani ya `users` inafanyika mara moja tu kwa akaunti mpya. `lastLogin` inaandikwa mara moja kwa saa. | `convex/users.ts` |
| 2 | `listInvoices` ilipakia invoice zote tangu mwanzo | Inaleta invoice mpya 200 (juu 1000) kupitia index. Skrini ya Sales inatumia 20 za mwisho tu. | `convex/sales.ts` |
| 3 | `salesRegisters` ilipakia invoice, malipo, bidhaa, makundi, units na suppliers wote, na kurudia kila bidhaa ilipobadilika | Inasoma kipindi kilichochaguliwa tu kupitia index za tarehe; bidhaa/kundi/unit/supplier zinatafutwa pale zinapotumika tu. Salio la mteja = salio la mwanzo + madeni yaliyo wazi (`by_tenant_outstanding`). Kipindi kikiwa kikubwa mno (invoice > 1500) skrini inaonyesha onyo. | `convex/sales.ts`, `convex/schema.ts`, `src/pages/sales/SalesRegister.tsx` |
| 4 | `products.importBatch` ilisoma bidhaa za biashara ZOTE | Inasoma biashara/idara husika tu (`by_scope`). | `convex/products.ts` |
| 5 | Namba za PO/GRN/PR zilisoma jedwali la biashara zote | Zinasoma biashara husika tu. | `convex/purchasing.ts` |
| 6 | Mauzo ya wakati mmoja yaligongana kwenye safu ya `statsDaily` | Hesabu za siku zinagawanywa kwenye safu 4 (`shard`); dashboard inajumlisha. Rebuild ya usiku inaziunganisha tena. | `convex/stats.ts`, `convex/schema.ts` |
| 7 | Kengele (notifications) ilisoma likizo, payroll na tiketi za biashara zote | Inasoma biashara husika tu (`by_scope`). | `convex/notifications.ts` |
| 8 | Audit log ilichukua logs mpya za biashara zote kisha kuchuja (meneja aliona chache au hakuona) | Inatumia index ya `tenantId + timestamp`; kichujio cha module kinafanya kazi sahihi. | `convex/maintenance.ts` |

## Index mpya (schema)
- `invoices.by_tenant_outstanding` (`tenantId`, `outstanding`)
- `customerPayments.by_tenant_date` (`tenantId`, `paymentDate`)
- `statsDaily.by_tenant_date_shard` (`tenantId`, `date`, `shard`) + sehemu mpya ya hiari `shard`

Hakuna data inayohitaji kuhamishwa. Ukiendesha `npx convex dev` au `npx convex deploy`, Convex inajenga index kwa data iliyopo yenyewe.

## Mabadiliko ya tabia unayoweza kuyaona
- Super Admin ambaye hajachagua biashara haoni tena data za biashara zote kwenye skrini za Sales (analazimika kuchagua biashara, kama skrini zingine za biashara).
- `listInvoices` inarudisha invoice mpya 200 badala ya zote.
- Salio la mteja linahesabiwa kwa madeni yaliyo wazi; linalingana na hesabu ya zamani kwa malipo yote yanayounganishwa na invoice (ndivyo mfumo unavyorekodi malipo).

## Bado yapo (si ya haraka kwa watumiaji 100)
- Namba ya invoice (`salesSequences`) na kiasi cha bidhaa kinachouzwa sana bado ni safu moja; mauzo ya wakati mmoja kwenye bidhaa ileile hurudiwa na Convex kiotomatiki.
- Kengele bado inasoma bidhaa zote za biashara na inahesabiwa upya kila mauzo; likiwa na bidhaa nyingi sana (maelfu) fikiria kuihamishia kwenye `statsTotals`.
- Skrini za Super Admin (`announcements.list`, `listUsers`, `tenants.list`) zinasoma jedwali zima; ni sawa kwa biashara/watumiaji mamia, si maelfu.

## Ukaguzi uliofanyika
Syntax ya faili zote zilizobadilishwa imekaguliwa. Typecheck na majaribio (`npm test`) hayakuendeshwa kwa sababu hapakuwa na mtandao wa kusakinisha dependencies. Tafadhali endesha: `npm install && npm run build && npm test`.
