# Mabadiliko 8 — Hariri biashara ilikuwa ukurasa mweupe

**Tatizo:** ukibonyeza penseli/Hariri, ukurasa wote ulikuwa mweupe.

**Sababu (mbili):**
1. Backend ilikuwa na makosa ya TypeScript (`convex/stats.ts` na `convex/dashboard.ts`), kwa hiyo `npx convex dev` / `npx convex deploy` haikusukuma kodi mpya. Kazi ya `tenants.getEditable` haikufika kwenye server, na `useQuery` ikaangusha React yote.
2. Programu haikuwa na kinga ya hitilafu (error boundary), kwa hiyo hitilafu yoyote ilimaliza ukurasa mzima.

**Marekebisho:**
- `convex/stats.ts`, `convex/dashboard.ts`: makosa ya aina (types) yameondolewa; `tsc` sasa haina kosa.
- `convex/_generated/api.d.ts`: `stats` imeongezwa.
- `src/components/error-boundary.tsx` (mpya): sasa hitilafu inaonyesha ujumbe na kitufe cha **Jaribu tena** / **Pakia upya** badala ya ukurasa mweupe. Imewekwa kwenye `App`, `BusinessPicker` na `/super-admin`.

**Cha kufanya:** toa zip, kisha endesha `npx convex dev` (au `npx convex deploy`) ili backend mpya ipakiwe, halafu `npm run dev`.
