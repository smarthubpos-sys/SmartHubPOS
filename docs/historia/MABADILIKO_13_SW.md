# MABADILIKO 13 — Kazi 2

## Chanzo cha matatizo yote mawili
`convex/reportEmails.ts` ilikuwa na kosa la TypeScript (TS7022/TS7023: circular type kwenye `sendReport`).
`npx convex dev` hukagua types kabla ya kupeleka (push) backend, kwa hiyo push ilikuwa inashindwa na
deployment ya Convex ilibaki na validators za zamani. Matokeo:
1. Kusajili user -> "Object contains extra field `ownDataOnly` that is not in the validator".
2. Kuhariri biashara (`tenants.getEditable` / `tenants.update`) kutofanya kazi.

## Marekebisho
- `convex/reportEmails.ts`: aina za wazi (`Promise<{ sent; recipients }>` na aina ya `context`). `tsc -b` sasa inapita bila kosa.
- `src/pages/maintenance/UsersPage.tsx`: wakati wa kuunda user mpya, `ownDataOnly` inatumwa tu ikiwa imetiwa tiki.
- Jaribio `access-modules.test.ts` (linajumuisha `tenants.update` / `getEditable`) linapita.

## Cha kufanya baada ya kufungua ZIP
1. `npm install`
2. `npx convex dev` (au `npx convex deploy` kwa production) — hakikisha inamaliza na "Convex functions ready" bila kosa la type.
3. Pakia upya ukurasa (hard refresh), kisha jaribu kusajili user na kuhariri biashara.
