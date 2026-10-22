# SmartHubPOS — PIN Login + Printer + Product/Customer Visibility Patch

Hii ni ZIP ya source files zilizobadilishwa tu. Haina `.env`, private keys, `.git`, `node_modules`, au secrets.

## Mambo yaliyoongezwa

### 1) Staff PIN Login
- PIN ya tarakimu 4 kwa kila mtumiaji, kupitia keypad ya login.
- Msimamizi anaweza kuwasha/kuzima PIN login na kuweka upya PIN kupitia User Management.
- PIN huhifadhiwa kama salted PBKDF2-SHA256 hash, si plain text.
- PIN ikikosewa mara 5, akaunti ya PIN hufungwa kwa dakika 10.
- Username/password login inabaki.

### 2) Products
- Bidhaa, product groups na units zinaonekana kwenye tawi zilipoandikishwa.
- Ukiziingiza ukiwa umechagua "idara zote" (bila branch), zinaonekana na kuuzwa kwenye matawi yote ya biashara.
- Mhudumu hawezi kuuza bidhaa ya tawi jingine (ulinzi wa stock); bidhaa za "idara zote" zinaruhusiwa.

### 3) Customers
- Super Admin anaona wateja wote wa biashara aliyochagua, kutoka matawi yote.
- Waiter/cashier anaona wateja aliowaingiza yeye; wateja wapya wanahifadhi `createdByUser`.
- Manager anaendelea kuona wateja wa tawi lake kama awali.
- Wateja wa zamani wasio na taarifa ya aliyeingiza (legacy records) wanaendelea kuonekana kwa staff wa tawi lao ili data za zamani zisipotee. Mfumo hauwezi kujua mmiliki wao wa awali kwa uhakika bila audit/migration ya ziada.

### 4) Printer
- Kuchapa moja kwa moja kunahitaji QZ Tray kusakinishwa na kuwashwa kwenye kompyuta yenye printer.
- Mfumo unapakia maktaba ya QZ wenyewe, unasoma printer ukurasa wa Hardware ukifunguka, na unachagua printer chaguo-msingi ya Windows.
- Bila QZ Tray, "Jaribu kuchapa" hufungua dirisha la kuchapa la browser.

## Jinsi ya kutumia

1. Hifadhi backup ya project yako ya sasa.
2. Funga ZIP na nakili mafaili yaliyomo (`convex/` na `src/`) juu ya project `SmartHubPOS`, ukiruhusu kubadilisha mafaili yanayofanana.
3. Fungua PowerShell kwenye root ya project na endesha:

   ```powershell
   npx convex codegen
   npm run build
   npm test
   npm run lint
   ```

4. Usifanye deployment mpaka commands zote zipite na majaribio ya manual yakamilike.

## Majaribio ya lazima

- Login ya zamani ya username/password.
- PIN imewezeshwa/kuzimwa, PIN isiyo sahihi, akaunti inactive, na lockout ya majaribio 5.
- Super Admin anaona wateja wote katika matawi ya biashara iliyochaguliwa.
- Staff anaona wateja wake wapya tu; manager anaona wateja wa tawi lake.
- Staff anaona bidhaa kutoka matawi yote; kuuza bidhaa iliyofungwa kwenye tawi jingine bado kunazuiwa.
- Printer detection ikiwa QZ Tray imewashwa na browser print dialog bila QZ Tray.

**Hali ya ukaguzi:** syntax ya TypeScript/TSX imekaguliwa. Full build, Convex codegen, Vitest na ESLint hazijaendeshwa hapa kwa sababu ZIP ya project haikuwa na `node_modules`/runtime dependencies. Hakuna deployment iliyofanyika.
