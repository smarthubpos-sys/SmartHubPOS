# Mabadiliko mapya (awamu ya pili)

## 1. Stock: ingiza bidhaa kwa Excel
- Stock > **Import from Excel** (`/stock/import`). Pakua template ya mfumo (ina maelekezo, mfano na orodha za Kundi/Kipimo vilivyopo).
- Jaza: jina la bidhaa*, bei ya kuuzia*, bei ya manunuzi, idadi (pia msimbo, barcode, kundi, kipimo, reorder level).
- Mfumo unahakiki (hakiki kabla ya kuingiza), kisha: unatengeneza msimbo (ITM-0001...), unatengeneza kundi/kipimo kisichokuwepo, unaweka stoo ya kuanzia na journal (Inventory/Opening balance equity). Bidhaa iliyopo: bei na taarifa zinaboreshwa, idadi haiguswi.
- Makosa kwa kila safu yanaonyeshwa; safu nzuri tu zinaingizwa. Kikomo: bidhaa 400 kwa kila ombi (faili kubwa hugawanywa kiotomatiki).
- Msimbo: `src/lib/excel.ts`, `src/pages/stock/StockImport.tsx`, `convex/products.ts` (`importBatch`).

## 2. Accounts: Mapokezi ya Mtaji
- Accounts > **Mapokezi ya Mtaji** (`/accounts/capital`). Chanzo: mmiliki, mkurugenzi, mwenyehisa, ruzuku (Equity); mkopo wa benki, mkopo wa mkurugenzi, mkopo mwingine (Deni/Liability, pamoja na riba na muda).
- Jina la aliyetoa ni lazima; fedha huingia Cash/Bank/Mobile money na journal inatengenezwa kiotomatiki.
- Msimbo: `convex/capital.ts`, `src/pages/accounts/CapitalPage.tsx`.

## 3 & 4. Dashboard na muonekano
- Dashboard: kadi 8 ndogo (hazikuondolewa), grafu: mauzo/manunuzi/fedha (siku 7/30/90), hali ya stoo, bidhaa zinazouzwa zaidi, madeni na bili; orodha za hivi karibuni.
- Mandhari mpya (indigo + cyan), sidebar ya gradient yenye makundi, TopBar ya glasi, kadi zenye kona laini na vivuli, menyu za moduli zilizoboreshwa. Rangi zimo `src/index.css`.

## 5. Sidebar: Bills, HR, Notifications, Help & Support
- **Bills** (`/bills`): bili za pango/umeme/maji/kodi; malipo kwa awamu; journal (Expense / Accounts payable / Cash-Bank-Mobile); kubatilisha.
- **HR** (`/hr`): muhtasari na grafu, wafanyakazi (ongeza/badilisha), likizo (omba/kubali/kataa), mahudhurio.
- **Notifications** (`/notifications` + kengele ya TopBar): stoo kuisha/kuisha, bili zilizochelewa/zinazokaribia, likizo zinazosubiri, mishahara ya kuidhinisha, maombi ya msaada; hali ya kusomwa kwa kila mtumiaji.
- **Help & Support** (`/help`): FAQ yenye utafutaji, na maombi ya msaada (mtumiaji anatuma; meneja anajibu/kufunga).

## Payroll hai + alama ya kidole / Face ID
- Payroll sasa ina kurasa halisi: Staff Sign In/Out, Process Payroll, Add/Modify Employee, Placement, Payslip (chapisha), Reports (Summary, Payments, Employee Statement).
- **Mshahara unahesabiwa kutoka mahudhurio**: saa (hourly), siku (daily), na mwezi (monthly) hupunguzwa kwa likizo bila malipo. Kulipa kunachagua Cash/Bank/Mobile.
- **Alama ya kidole / Face ID / Windows Hello** kupitia WebAuthn: sajili kwenye HR > Employees (ikoni ya kidole), kisha Staff Sign In/Out. Kifaa hufanya uthibitisho wa alama; seva inakagua saini, challenge ya mara moja, user-verification na counter (inazuia kurudiwa).
- Mahitaji: HTTPS (au localhost) na kifaa chenye kisoma kidole/Face ID/Windows Hello; kisoma kidole cha nje cha USB kinafanya kazi tu kama kinaunga mkono FIDO. Hiari: weka `APP_ORIGIN` kwenye Convex (mf. https://pos.yako.com) kuzuia vyanzo vingine.
- Msimbo: `convex/biometric.ts`, `convex/attendance.ts`, `src/lib/webauthn.ts`.

## Lugha
- Maandishi mapya yote yametafsiriwa (Kiswahili/English) na yanafuata lugha moja ya mfumo; majaribio yanahakiki kamusi.

## Majaribio
- `npx vitest run`: majaribio 46 (backend: mtaji, bili, uingizaji wa Excel, mahudhurio/likizo/mishahara, WebAuthn, taarifa; frontend: Excel, lugha, kurasa zote mpya zinaonyeshwa).
- Kutokana na mazingira, sikujaribu kwa kifaa halisi cha alama ya kidole wala dhidi ya Convex ya live; jaribu hayo kwanza kwenye deployment ya majaribio.
