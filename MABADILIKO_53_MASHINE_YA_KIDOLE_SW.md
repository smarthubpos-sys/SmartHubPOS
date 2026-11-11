# Mabadiliko 53 — Mashine ya alama ya kidole (ZKTeco na zinazofanana): mfanyakazi anagusa tu, mfumo unamtambua

## Inavyofanya kazi
1. Mashine ya kidole (iliyowekwa ukutani) inahifadhi alama za wafanyakazi wote. Mfanyakazi anagusa, mashine inajua ni nani.
2. Programu ndogo ya kati (`tools/attendance-bridge`) inasoma kugusa kwenye mashine kila sekunde 30 kupitia mtandao wa ndani.
3. Inatuma kwenye mfumo: `POST /attendance/punches` (Convex HTTP), kwa ufunguo wa kila mashine.
4. Mfumo unarekodi kuingia au kutoka kwa **saa halisi ya kugusa** (hata kama mtandao ulikatika na rekodi zikafika baadaye), pamoja na kuchelewa na makato kama kawaida.

Mashine inatuma namba ya mfanyakazi kwenye mashine. **Namba hiyo iwe sawa na Employee Code** ya mfanyakazi kwenye HR (herufi kubwa/ndogo hazijalishi). Kama mashine ina namba tupu (mfano `12`) na Employee Code ni `E12`, tumia `CODE_PREFIX=E` kwenye programu ya kati.

## Kuweka (mara moja)
1. **Mfumo:** Payroll > Staff Sign In > "Mashine za alama ya kidole" > andika jina > "Sajili mashine". Utaona **anwani** na **ufunguo** (unaonekana mara moja tu; nakili).
   Wanaoona sehemu hii ni wenye ruhusa `payroll.manage` pekee.
2. **Kompyuta ya ofisini** (inayokaa imewashwa, iko mtandao mmoja na mashine; Node.js 18+):
   ```
   cd tools/attendance-bridge
   npm install
   ```
   Weka mipangilio kisha endesha:
   ```
   MACHINE_IP=192.168.1.201
   SMARTHUB_ENDPOINT=https://jina-lako-123.convex.site
   SMARTHUB_DEVICE_KEY=<ufunguo ulioupata>
   MACHINE_UTC_OFFSET=+03:00        # saa ambayo mashine imewekwa (Afrika Mashariki = +03:00)
   CODE_PREFIX=                     # hiari
   node bridge.mjs
   ```
   (Windows PowerShell: `$env:MACHINE_IP="192.168.1.201"` n.k., kisha `node bridge.mjs`.) Mipangilio mingine: `MACHINE_PORT` (4370), `POLL_SECONDS` (30), `BACKFILL_DAYS` (2, mara ya kwanza tu), `STATE_FILE`.
   Ili ianze yenyewe kompyuta ikiwashwa tumia Task Scheduler (Windows), `pm2` au `systemd`.
3. Sajili kila mfanyakazi **kwenye mashine** (kidole chake + namba yake).

## Kanuni za usalama (zimejaribiwa kwenye `convex/attendanceDevices.test.ts`, tests 12)
- Ufunguo ni wa mashine moja, unahifadhiwa kama SHA-256 (si wazi). Ukiupoteza au ukivuja: "Ufunguo mpya" (wa zamani unakufa mara moja) au "Zima".
- Kugusa mara mbili ndani ya dakika 2 kunapuuzwa (usimtoe mtu kwa bahati mbaya).
- Rekodi ileile ikitumwa tena (mtandao ulirudia) inahifadhiwa mara moja tu.
- Rekodi ya zamani kuliko ya mwisho iliyokubaliwa kwa mtu huyo inakataliwa (ingegeuza kuingia/kutoka).
- Rekodi ya mbele ya saa ya mfumo kwa zaidi ya dakika 10, au ya zaidi ya siku 14 zilizopita, inakataliwa; Manager aiingize kwa mkono.
- Namba isiyojulikana, au ya mfanyakazi wa biashara nyingine, haiingii. Kila kukataliwa kunaandikwa kwenye `devicePunches` pamoja na sababu.
- Zamu ya usiku (kuingia 20:00, kutoka 02:00) inafanya kazi kama kiosk.
- Kuingia au kutoka kunaamuliwa na mfumo: mwenye zamu wazi anatoka, mwingine anaingia.

## Mipaka ya kujua
- **Haijajaribiwa kwenye mashine halisi.** Sehemu ya mfumo imejaribiwa kikamilifu; programu ya kati imehakikiwa tu kwa msimbo wa maktaba ya `node-zklib` (majina ya fields) na kwa ubadilishaji wa saa. Jaribio la kwanza lifanyike na mfanyakazi mmoja kabla ya wote.
- Programu ya kati inasaidia mashine zinazotumia itifaki ya ZKTeco (port 4370). Chapa nyingine (Hikvision, Suprema, Anviz) zinaweza kutuma kwa endpoint hiyo hiyo, lakini zinahitaji programu yao ya kati (muundo wa mwili umeandikwa hapa chini).
- Mashine hizi zinahitaji kompyuta moja kuwa imewashwa. Ikizimwa, rekodi zinasubiri kwenye mashine na zinatumwa ikiwashwa tena (ndani ya siku 14).
- Saa ya mashine iwe sahihi. Kama imepotea, rekodi zitakuwa na saa isiyo sahihi.

## Muundo wa ombi (kwa chapa nyingine)
```
POST {SMARTHUB_ENDPOINT}/attendance/punches
Authorization: Bearer <deviceId>.<secret>
{"punches":[{"code":"E12","at":1766000000000,"direction":"in"}]}
```
`at` = milisekunde za epoch, au ISO yenye ukanda wa saa (`2026-10-26T08:05:00+03:00`). `direction` ni hiari. Juu ni rekodi 100 kwa ombi. Jibu: `{"ok":true,"results":[{"index":0,"code":"E12","at":...,"status":"in"}]}`. Status: `in`, `out`, `duplicate`, `already_received`, `unknown_employee`, `out_of_order`, `rejected`, `bad_time`.

## Faili
Mapya: `convex/attendanceDevices.ts`, `convex/attendanceDevices.test.ts`, `src/pages/payroll/AttendanceDevices.tsx`, `src/lib/i18n-dict-devices.ts`, `tools/attendance-bridge/{bridge.mjs,lib.mjs,package.json}`.
Yaliyobadilika: `convex/schema.ts` (meza mpya `attendanceDevices`, `devicePunches`), `convex/http.ts` (route mpya), `convex/attendance.ts` (`applyAttendance` inapokea `atMs`), `convex/_generated/api.d.ts`, `src/pages/payroll/Attendance.tsx`, `src/lib/i18n.ts`.

**Deploy:** kuna mabadiliko ya schema (meza mpya, hakuna data ya zamani inayoguswa). Deploy ya Convex inahitajika kabla ya kutumia.
