# Mabadiliko 52 — Kifaa cha pamoja cha mahudhurio (kiosk), PIN kisha kidole, na zamu ya usiku

## 1. Zamu inayovuka usiku wa manane (kosa lililorekebishwa)
- Mtu aliyeingia saa 20:00 na kutoka saa 02:00 sasa anaweza kutoka. Hapo awali mfumo ulitafuta rekodi ya tarehe mpya na kusema "Hajaingia kazini leo".
- `convex/attendanceMath.ts`: `hoursBetween` (masaa kuvuka usiku) na `rowToSignOut` (rekodi ya leo kwanza, vinginevyo ya jana iliyo wazi).
- Rekodi ya jana inafungwa tu ikiwa chini ya masaa 18 (`MAX_OPEN_SHIFT_HOURS`). Zaidi ya hapo ni "alisahau kutoka" na haifungwi na siku mpya.
- Orodha ya "Mahudhurio ya leo" (`attendance.today`) inamwonyesha aliyeingia jana usiku na bado yuko kazini kama "Yupo kazini" na `(jana)` kando ya muda wa kuingia, si "Hajaingia".

## 2. Akaunti ya kifaa cha pamoja (role "Attendance Kiosk")
- Ruhusa mpya `attendance.kiosk` (kwenye kundi la Payroll) na role mpya ya mfumo `attendance` (Attendance Kiosk) yenye ruhusa hiyo tu.
- Akaunti yenye ruhusa hiyo pekee: inaelekezwa moja kwa moja kwenye `/kiosk`, haioni menyu, top bar wala mishahara, na **haitolewi kwa kutotumika** (idle sign-out). Akaunti nyingine zote (Manager, Admin, Super Admin) hazibadiliki.
- `src/pages/layout/Applayout.tsx` sasa inasubiri orodha ya ruhusa ipakie kabla ya kuonyesha menyu, ili kifaa cha kiosk kisiangaze menyu kwa muda mfupi.
- Kikomo cha usalama kilichopo cha mfumo bado kinatumika: kikao kimoja hakizidi **masaa 14**. Kwa hiyo kifaa kinaingizwa kwenye mfumo mara moja kwa siku. Inashauriwa akaunti ya kifaa iwe na Staff PIN (login ya haraka kwa PIN).

## 3. Kujitambulisha kwanza (PIN au namba), kisha kidole
- Skrini mpya `/kiosk` (`src/pages/kiosk/page.tsx`): hatua 1 weka Staff PIN au namba ya mfanyakazi; hatua 2 thibitisha kwa kidole.
- `convex/kiosk.ts` → `identify`: PIN inatafutwa kupitia mtumiaji aliyeunganishwa na mfanyakazi (HR) mwenye PIN iliyowashwa; vinginevyo namba ya mfanyakazi (`employeeCode`, herufi kubwa/ndogo sawa). Jina la mfanyakazi linaonyeshwa kabla ya kidole ili makosa yaonekane.
- `convex/biometric.ts`: seva inakataa alama ya kidole ambayo si ya mfanyakazi aliyejitambulisha (haitegemei skrini). Akaunti ya kiosk haiwezi kufungua "chagua jina lolote" (`authOptions`) wala kuthibitisha bila kujitambulisha.
- Kinga dhidi ya kubashiri: majaribio 5 yasiyo sahihi ndani ya dakika 10 yanasimamisha kiosk ya biashara hiyo kwa dakika 5. Kikomo hiki ni cha biashara hiyo tu na hakiathiri login ya PIN ya kawaida.
- Mfanyakazi asiye na alama iliyosajiliwa anaambiwa amwone Manager/HR.
- Manager na skrini ya Payroll > Staff Sign In vinabaki kama zamani (orodha ya majina, kuingiza kwa mkono).

## Namna ya kuweka kifaa
1. HR > Employees: sajili alama ya kila mfanyakazi **kwenye kifaa hicho hicho cha kazini** (kidole chake kiwe kimewekwa kwenye mipangilio ya kifaa, mfano Windows Hello). Usajili unafungwa kwenye kifaa hicho na kwenye jina la domain (`APP_ORIGIN`); kifaa au domain ikibadilika, wasajiliwe upya.
2. Maintenance > Users: tengeneza mtumiaji wa kifaa mwenye role "Attendance Kiosk" na Staff PIN.
3. Wafanyakazi wenye akaunti ya mfumo: waunganishwe na rekodi yao ya HR na wawe na Staff PIN. Wengine wanatumia namba ya mfanyakazi (si siri, ni dhaifu zaidi).

## Kikomo cha kujua
- Kidole kinathibitishwa na kifaa, si na mfumo: PIN/namba ndiyo inayomtambulisha mtu, kidole kinathibitisha kuwa kuna mtu halisi mbele ya kifaa. Kufunga kidole kwa mtu mmoja kunahitaji vifaa maalum vya mahudhurio.
- **Haijajaribiwa kwenye kifaa halisi cha alama ya kidole**; majaribio yote yametumia saini za majaribio (WebAuthn).

## Mafaili
Yaliyobadilika: `convex/{access,attendance,attendanceMath,biometric,permissions}.ts`, `convex/_generated/api.d.ts` (kiosk imesajiliwa kwa mkono), `src/app.tsx`, `src/lib/{i18n.ts,selling-point-access.ts}`, `src/pages/layout/Applayout.tsx`, `src/pages/payroll/Attendance.tsx`.
Mapya: `convex/kiosk.ts`, `convex/kiosk.test.ts`, `src/pages/kiosk/page.tsx`, `src/lib/i18n-dict-kiosk.ts`.

## Imekaguliwa
`npx tsc -b` safi, `npx eslint . --max-warnings=0` safi, `npx vitest run`: mafaili 91, tests 637 zimepita (kabla: 90 / 621), `npx vite build` imefanikiwa.
Ukitumia `npx convex dev`, faili la `_generated` litatengenezwa upya lenyewe.
