# Mabadiliko 41 — Ratiba za wafanyakazi na makato ya mahudhurio

## Kilichoongezwa (Payroll)
- **Staff Schedules** (`/payroll/schedules`): panga kila siku ya wiki — Off, muda wa kuingia, muda wa kutoka. Unaweza kuchagua wafanyakazi wengi na kuwapa ratiba moja. Pia kuna **siku za mapumziko ya biashara (sikukuu)**.
- **Attendance Deductions** (`/payroll/deductions`): kiasi cha kukata mtu akichelewa (kiasi kimoja, au kwa kila dakika), dakika za kuvumilia (0 = hata dakika moja inakatwa), na kuwasha/kuzima kato la siku nzima asipoingia.
- **Sign In**: mfumo unalinganisha muda wa kuingia na ratiba ya siku hiyo. Akichelewa, skrini inamwambia dakika alizochelewa na kiasi atakachokatwa. Kiasi kinahifadhiwa wakati wa kuingia (kubadilisha sheria baadaye hakubadilishi historia). Meneja anaweza **Futa kato** (kabla payroll haijahesabiwa).
- **Hajaingia kabisa**: siku iliyopangwa, bila sign-in, na isiyo Off / sikukuu / likizo iliyoidhinishwa → mshahara wa siku nzima unakatwa (mshahara wa kipindi ÷ siku za kazi za kipindi).
- **Arifa kwa meneja**: "amechelewa dakika N", "hajaingia bado" (baada ya muda wa kuingia), na "hakuingia {tarehe}" (siku 3 zilizopita).
- **Process Payroll / Payslip**: makato ya kuchelewa na kutokuwepo yanaonekana kila mstari; makato hayashuki chini ya mshahara (net haiendi chini ya sifuri).
- **Late & Absence Report** (`/payroll/reports/attendance`).

## Maamuzi ya kuangalia
- Muda wa kuingia unahukumiwa kwa **saa ya biashara (UTC+3, saa ya seva)**, siyo saa ya simu/kompyuta ya mfanyakazi (ili asibadilishe saa ya kifaa kukwepa kato).
- Aliyelipwa kwa siku au kwa saa hakatwi kato la "siku nzima" (hawalipwi siku ambazo hawakufanya kazi); kato la kuchelewa linawahusu wote.
- Mfanyakazi asiye na ratiba hahesabiwi kuchelewa wala kutokuwepo.
- Ruhusa = Likizo iliyoidhinishwa kwenye HR (aina yoyote). Unpaid leave bado inapunguza mshahara wa kila mwezi kama zamani, bila kukatwa mara mbili.
- Wafanyakazi (employees) hawana akaunti ya kuingia, kwa hiyo arifa zinaenda kwa mameneja/wenye ruhusa ya payroll, siyo kwa mfanyakazi mwenyewe.

## Faili
Mpya: `convex/schedules.ts`, `convex/attendanceMath.ts`, majaribio `convex/schedules.test.ts` na `convex/attendanceMath.test.ts`, `src/pages/payroll/{Schedules,AttendanceRules,AttendanceReport}.tsx`, `src/lib/i18n-dict-schedule.ts`.
Zilizobadilishwa: `convex/schema.ts` (meza 3 mpya + sehemu za hiari), `convex/attendance.ts`, `convex/payroll.ts`, `convex/notifications.ts`, `convex/maintenance.ts` (backup), `convex/_generated/api.d.ts`, `src/lib/i18n.ts`, `src/lib/notify.ts`, `src/pages/payroll/{page,Attendance,Process,Payslip}.tsx`.

## Uthibitisho
`tsc -b` safi, `eslint --max-warnings=0` safi kwa faili zilizoguswa, `vite build` imepita, majaribio mapya 25 yamepita. Majaribio yote: 438 yamepita; 4 ya `waiterDirectory.test.ts` yalikuwa yanashindwa hata kwenye zip ya awali (hayahusiani na kazi hii).
Hakuna deploy wala push. Schema ina sehemu mpya za hiari tu, kwa hiyo data iliyopo haihitaji migration.
