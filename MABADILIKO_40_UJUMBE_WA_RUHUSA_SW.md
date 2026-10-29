# Mabadiliko 40 — Ujumbe wa ruhusa na makosa ya mtumiaji (kwa lugha iliyosetiwa)

## Tatizo
Mtu asiye na ruhusa (au aliyekosea kitu) alikuwa anaona "Something went wrong" / "Server Error" / "Hitilafu imetokea",
kana kwamba mfumo umeharibika.

## Chanzo
Seva ilikuwa inatupa `Error` ya kawaida. Kwenye production Convex huficha maandishi yake na skrini inapokea "Server Error" tu.
Ujumbe wa ruhusa ulionekana tu pale ambapo `surfaceError` ilitumika (maeneo machache).

## Marekebisho
1. **Seva (`convex/*.ts`, faili 36):** kila `throw new Error(...)` (maeneo 529) sasa ni `throw new ConvexError(...)`.
   Maandishi sasa yanamfikia mtumiaji. Ujumbe wenyewe haukubadilishwa, kwa hiyo majaribio ya zamani yanaendelea kupita.
2. **`src/lib/i18n-dict-friendly.ts` (mpya):** ujumbe rafiki kwa Kiswahili na Kiingereza.
   - Ruhusa: "Huna ruhusa ya kufanya kitendo hiki ... Muombe msimamizi akupe ruhusa (ruhusa inayohitajika: X) kupitia Role Management au User Settings."
   - Makosa ya mtumiaji: kinachokosewa + cha kufanya (mf. "Stock haitoshi kwa Bia. Iliyopo: 2, inahitajika: 5. Punguza kiasi au pokea stock zaidi.").
   - Ujumbe zaidi ya 170 wa seva ambao haukuwa na tafsiri sasa una Kiswahili na Kiingereza.
   - Ujumbe wa dharura (hitilafu halisi tu) sasa unasema "Jaribu tena; tatizo likiendelea wasiliana na msimamizi."
3. **`src/lib/i18n.ts`:** `errorText` inasoma maandishi ya `ConvexError`; imeongezwa `errorKind()` (signin / permission) na `rawErrorText()`.
   Lugha inafuata ile iliyosetiwa kwenye Maintenance > Language Settings.
4. **`src/components/error-boundary.tsx`:** ukurasa wa ruhusa sasa unaonyesha sababu kamili kwa lugha ya mfumo;
   "Muda wako wa kuingia umeisha" unaonyesha kitufe cha "Ingia tena"; makosa ya kiufundi ya JavaScript hayaonyeshwi kwa mtumiaji (yanabaki kwenye console).
5. **Skrini zilizokuwa zinaonyesha ujumbe mbichi:** `maintenance/helpers.ts` (useRun), `shared/report.tsx`, `stock/ProductionPage.tsx` sasa zinatumia `errorText`.

## Majaribio
- Mapya: `convex/permissionErrors.test.ts`, na sehemu mpya ya `src/lib/i18n.test.ts`.
- Yote yamepita: faili 63, majaribio 417 (tsc na eslint pia vimepita).

## Kuweka (deploy)
Lazima utume `convex` upya (`npx convex deploy`) pamoja na frontend, vinginevyo skrini mpya itakutana na seva ya zamani.
