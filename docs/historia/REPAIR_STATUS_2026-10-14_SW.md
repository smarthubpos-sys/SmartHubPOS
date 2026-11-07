# Hali ya marekebisho — 14 Oktoba 2026

## Mabadiliko yaliyofanywa kulingana na log iliyotumwa

- `convex/access.ts`: helpers za kusoma rows sasa zinatumia `QueryCtx` na `TableNames` badala ya context/table zisizo na aina maalum, ili callback ya `withIndex` ipate aina ya query.
- `convex/biometric.ts`: `cd.origin` hukaguliwa kuwa string kabla ya kuilinganisha na `APP_ORIGIN`.
- `convex/ledger.ts`: `isMoneyAccount` ina aina ya akaunti ya Convex iliyoainishwa.
- `convex/paymentMethods.ts`: `sumAccount` hutumia `QueryCtx` na `Id<"accounts">`; `reallocate` hutumia document na account ID types badala ya `any`; ramani za account zinahifadhi IDs zenye aina sahihi.
- `convex/purchaseReports.ts`: `letterhead` hutumia aina inayorudishwa na `requireActiveUser`, ili `branchId` ibaki `Id<"branches">` badala ya kuifanya `db.get` kuwa na matokeo ya tables nyingi.
- `src/pages/layout/_components/ModuleWorkspace.tsx`: calls za `select` sasa zinalingana na saini ya helper iliyopo.
- `src/pages/layout/Applayout.tsx`: ukaguzi wa `requirePasswordChange` unashughulikia hali ya `user` kutokuwepo kwa kutumia optional chaining.

## Matokeo yaliyotumwa na mtumiaji

- Vitest: mafaili 20 yalipita.
- ESLint: log inaonyesha 465 errors na warnings 2; hayajathibitishwa kuwa yameisha.
- Build: log ya awali inaonyesha makosa 10 ya TypeScript; mabadiliko yaliyopo yanalenga makosa hayo, lakini build haijaendeshwa tena hapa kwa sababu dependencies hazikuweza kusakinishwa katika mazingira haya.

**Muhimu:** Hii si uthibitisho wa kuwa build/lint zote zimepita. Endesha `npm run lint`, `npm test`, na `npm run build` baada ya `npm install`; tuma log mpya ili makosa yaliyobaki yashughulikiwe bila kubadilisha data za production.
