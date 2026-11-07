# Marekebisho ya ukaguzi wa source — 16 Oktoba 2026

## Marekebisho yaliyofanywa

1. `convex/biometric.ts`: uthibitishaji wa WebAuthn sasa unakataa kufanya kazi ikiwa `APP_ORIGIN` haijawekwa kwenye mazingira ya Convex, badala ya kuruhusu origin yoyote wakati variable haipo. Origin lazima ilingane kikamilifu na origin ya tovuti inayotumika.
2. `convex/biometric.ts`: sign counter sasa inasomwa kama unsigned 32-bit integer kwa `DataView.getUint32`, ili thamani za juu zisigeuke hasi kwa sababu ya JavaScript bitwise signed integers.
3. `.env.example` na `README.md`: zimeongezewa maelekezo ya `APP_ORIGIN`. Hii ni variable ya Convex backend, si variable ya `VITE_` ya frontend.

## Jinsi ya kuweka APP_ORIGIN kwenye kompyuta yako

Tumia origin halisi ya app yako (scheme + hostname + port ikiwa ipo). Mfano wa local development:

```powershell
npx convex env set APP_ORIGIN http://localhost:5173
```

Kwa deployment nyingine, weka origin ya tovuti husika kwenye Convex deployment husika. Usitumie mfano huu bila kuthibitisha origin inayotumika. Ikiwa biometrics haitumiki, unaweza kuacha feature hiyo bila kusanidiwa; maombi ya biometric yatakataliwa kwa makusudi.

## Uthibitishaji

Dependencies hazikuweza kuthibitishwa kuwa zimesakinishwa katika mazingira ya maandalizi kwa sababu `npm ci` ilibaki ikisubiri registry, na Node iliyopo hapa ni v22.16.0 wakati baadhi ya dependencies zinahitaji v22.19.0 au zaidi. Kwa hiyo `npm run build`, `npm run lint`, `npm test` na `npx convex dev --once` hazijathibitishwa hapa. Hii ZIP haidai kuwa makosa yote ya type/lint yamerekebishwa.

## Kwenye Windows kabla ya deployment

```powershell
node -v
npm ci
npx tsc -b
npm run lint
npm test
npm run build
npx convex dev --once
```

Rekebisha kila error itakayobaki kabla ya deployment. Usishiriki `.env.local`, private keys, token au output yenye secrets.
