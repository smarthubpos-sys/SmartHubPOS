# Mabadiliko matatu (SmartHubPOS)

## 1. Biashara nyingi (Multiple users / businesses)
- Super Admin akiingia (login) anaona **ukurasa wa kuchagua biashara** (`src/pages/super-admin/BusinessPicker.tsx`) wenye biashara zote.
- Kila kadi ina: **Ingia kwenye biashara**, **Simamisha (stop)** / **Washa tena (resume)**. Kitufe cha **Sajili biashara mpya (register)** kipo juu.
- Biashara ikisimamishwa: watumiaji wake hawawezi kutumia mfumo (wanaona ujumbe wa "Biashara yako imesimamishwa"), data haifutwi.
- Ndani ya biashara, TopBar inaonyesha jina la biashara na kitufe **Badilisha biashara** kurudi kwenye orodha.
- Ukichagua biashara, data zote (wateja, bidhaa, mauzo, n.k.) zinachujwa kwa biashara hiyo tu (`convex/access.ts`).
- Backend: `convex/tenants.ts` → `current`, `listForPicker`, `selectBusiness`, `exitBusiness`, `setActive`.

## 2. Lugha moja
- Lugha inayowekwa kwenye **Maintenance > Language Settings** (Kiswahili au English) ndiyo inatumika kila mahali: menyu, fomu, ripoti, vichwa vya jedwali, hali (status), na ujumbe wa makosa.
- Mfumo: `src/lib/i18n.ts` (`tr()`), kamusi: `src/lib/i18n-dict.ts` (UI) na `src/lib/i18n-server-dict.ts` (ujumbe wa backend).
- Ukibadilisha lugha, ukurasa unajipakia upya mara moja ili skrini zote zibadilike pamoja.
- Ukurasa wa login na wa kuchagua biashara hutumia lugha ya mwisho iliyotumika kwenye kivinjari hicho (chaguo-msingi: Kiswahili).
- Jina la tafsiri likikosekana kwa maandishi mapya, ongeza kwenye kamusi (jaribio `src/lib/i18n.test.ts` linahakiki kila ingizo lina sw na en).

## 3. Hardware Setup
- Aina ya muunganisho: **Waya (USB/Serial)** au **Wireless (Bluetooth/Wi-Fi)**.
- Printer inapatikanaje:
  - **Zilizosakinishwa kwenye mfumo**: kitufe "Tafuta printer zilizosakinishwa" kinaorodhesha printer za kompyuta kupitia **QZ Tray** (programu ndogo ya bure, lazima iwe imewashwa). Bila QZ Tray, printer chaguo-msingi hutumika na dirisha la kuchapa la kivinjari.
  - **Unganisha moja kwa moja**: USB (WebUSB), Serial/Bluetooth ya kawaida (Web Serial), au Bluetooth BLE (Web Bluetooth) - Chrome/Edge tu.
- "Jaribu kuchapa" hutuma ESC/POS kwenye printer iliyochaguliwa.
- Msimbo: `src/lib/printers.ts`, fomu kwenye `SettingsPages.tsx`.

## Kumbuka
- `qz-tray` ina leseni LGPL-2.1; kagua kama inafaa kwa usambazaji wako.
- Kivinjari hakiwezi kuorodhesha printer za OS bila QZ Tray; jaribio na printer halisi halikufanyika hapa.
- Endesha: `npm install`, `npx convex dev`, `npm run dev`.
