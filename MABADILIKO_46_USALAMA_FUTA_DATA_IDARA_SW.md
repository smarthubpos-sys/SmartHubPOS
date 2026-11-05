# MABADILIKO 46 — Usalama wa "Futa data ya idara"

Faili zilizobadilika: `convex/maintenance.ts`, `src/pages/maintenance/DataPages.tsx`, `convex/departmentClear.test.ts`.
Hakuna deploy wala mabadiliko ya data ya production. Chukua backup kabla ya kutumia.

1. **Hakuna tena kufuta biashara nzima kimakosa.** Backend (`authorizeClear`) inakataa kama hujachagua idara na hujabonyeza "Biashara nzima" waziwazi. Skrini haianzi tena na "Biashara nzima" kama huna idara ya kufanyia kazi; kufuta idara ZOTE kunahitaji kuandika jina la biashara.
2. **Bidhaa za pamoja (zisizo na idara) hazibadilishwi** na wipe ya idara moja (kurudisha stock kunahusu bidhaa za idara hiyo tu).
3. **Mteja aliyeandikiwa invoice na idara nyingine hafutwi** wakati wa kufuta Customers za idara; sales returns za idara nyingine pia zinabaki.
4. **Ripoti zilizohifadhiwa za "zote"** zinafutwa pamoja na idara (ni nakala tu, zinatengenezwa upya). Dashboard stats zinafutwa kwa kurasa bila kikomo cha 8000, na rebuild inaanza baada ya kurasa za mwisho.

Kumbuka: `accounts.balance` haijawahi kubadilishwa na mfumo (salio linahesabiwa kutoka journals), kwa hiyo haikuhitaji marekebisho.

Tests: 4 mpya kwenye `departmentClear.test.ts`; jumla 581/581 zimepita, TypeScript safi, ESLint safi.
