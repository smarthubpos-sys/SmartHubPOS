# Mabadiliko 37 - Kila biashara ijitegemee (username na PIN)

Tatizo: `Username "admin" tayari inatumika (majina ya watumiaji ni ya kipekee kwa biashara zote...)`.
Username na PIN za wahudumu zilikuwa za kipekee kwa MFUMO MZIMA, hivyo biashara moja ilijua/ilizuiwa na data ya nyingine.

## Sasa
- Username ni ya kipekee NDANI ya biashara moja tu. `admin` wa Racruz na `admin` wa biashara nyingine ni watu tofauti.
- PIN ya mhudumu ni ya kipekee NDANI ya biashara moja tu. Ujumbe wa "PIN imetumika" hauonyeshi tena chochote cha biashara nyingine.
- Skrini ya login ina sehemu ya **Msimbo wa biashara** (mf. RACRUZ). Kwa PIN ni lazima (inakumbukwa kwenye kifaa). Kwa username/password ni hiari: Super Admin anaacha wazi.
- Watumiaji WALIOPO tayari wanaendelea kuingia kama kawaida (hawabadilishwi). Watumiaji WAPYA wa biashara wanapata utambulisho wa login wa biashara husika (`jina@<idYaBiashara>.login.smarthub.invalid`).
- Kubadilisha username (renameUsername) nayo inakagua ndani ya biashara hiyo tu.

## Faili
convex/schema.ts (index by_tenant_username), convex/maintenance.ts, convex/auth.ts, convex/users.ts (resolveLoginEmail),
src/components/ui/signin.tsx, src/lib/i18n-dict-access.ts,
majaribio: convex/businessIsolation.test.ts (mpya), convex/pinOnly.test.ts, convex/usernameChange.test.ts.

## Baada ya deploy
1. `npx convex deploy` (index mpya inajengwa yenyewe).
2. Wahudumu wa PIN waandikiwe msimbo wa biashara yao mara ya kwanza.
