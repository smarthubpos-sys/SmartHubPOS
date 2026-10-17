# SmartHubPOS — Operesheni, Backup, Migration, Printing na Hali ya Uthibitisho

> Hati hii inaeleza kile kilichofanyika kwenye toleo hili na — muhimu zaidi — kile **ambacho hakijathibitishwa**.
> Kazi ilifanyika kwenye mazingira bila mtandao: `npm run lint`, `npm test`, `npm run build` na Convex codegen **hazikuendeshwa**. Ziendeshe kabla ya deployment (hatua ya 1 hapa chini).

## 1. Uthibitisho unaotakiwa kabla ya kutumia (wewe unaendesha)

```powershell
npm ci
npx convex dev --once        # husawazisha schema + functions kwenye deployment ya MAJARIBIO (si production) na kuzalisha convex/_generated
npx tsc -b
npm run lint
npm test
npm run build
```

Tuma matokeo (hasa failures) ili yarekebishwe. Usiweke production hadi vyote vipite.

## 2. Mabadiliko ya schema (hayaharibu data ya zamani)

Sehemu zote mpya ni `optional`, kwa hiyo data iliyopo inabaki halali; hakuna migration ya data inayohitajika:

- `warehouseStock`: index mpya `by_warehouse_product`.
- `warehouseMovements`: `reason`, `requestKey`; indexes `by_tenant_key`, `by_reference`.
- `stockTransfers`: `requestKey`, `closedBy`, `closedAt`, `closeReason`; indexes `by_tenant_key`, `by_tenant_status`; hali mpya `cancelled` na `rejected`.
- `stockTransferLines`: `damagedQuantity`, `shortageQuantity`.
- `invoices`: `requestKey`; index `by_tenant_key`.

Kumbuka: uhamisho (transfers) wa zamani uliopokelewa kabla ya toleo hili hauna `damagedQuantity`/`shortageQuantity`; ripoti zinawachukulia kama 0.

## 3. Store / Ghala — sheria zinazotekelezwa kwenye seva (`convex/warehouses.ts`)

- Kila badiliko la `warehouseStock.quantity` linaandika safu moja ya ledger (`warehouseMovements`) ndani ya mutation ileile.
- Valuation: **wastani wa gharama (weighted average)**, kwa risiti, uhamisho na ripoti zote.
- Hakuna negative stock (create transfer, dispatch, adjust, write-off zote zinakataa).
- Uhamisho: `pending → in_transit → received`; `pending → cancelled`; `in_transit → rejected` (mzigo unarudi kwa chanzo na ledger `transfer_return`).
- Kupokea: `kilichotumwa = kilichopokelewa + kilichoharibika + upungufu`; sababu inahitajika kukiwa na tofauti; kilichopokelewa+kilichoharibika hakizidi kilichotumwa.
- Idempotency: `receive`, `createTransfer`, `adjust`, `writeOff` na `sales.createInvoice` zinakubali `requestKey`. Skrini zinatuma ufunguo mmoja kwa kila jaribio, hivyo kubonyeza mara mbili au retry haipost mara mbili. `dispatch`/`receiveTransfer`/`closeTransfer` zinalindwa na ukaguzi wa status.
- Ruhusa: `stock.store.*` kwa shughuli za ghala; `stock.adjust` (Super Admin pekee ndiye anayeitoa) kwa adjustment na wastage/loss/damaged; `stock.reports.view` kwa ripoti.
- Ripoti: `movementReport`, `summary` (valuation + thamani ya hasara), `reconcile` (balance dhidi ya jumla ya ledger).

## 4. Kubadilisha username (`maintenance.changeUsername`)

Login ya Convex Auth inatumia account id `username@login.smarthub.invalid`. Kubadilisha `users.username` peke yake kungevunja login, kwa hiyo mutation `applyUsernameChange` hubadilisha **kwa pamoja, kwenye transaction moja**: `authAccounts.providerAccountId`, `users.username`, `users.email`. Hash ya password haiguswi. Kisha sessions zote za mtumiaji huyo zinafungwa ili aingie upya kwa jina jipya; jina la zamani halifanyi kazi tena.
Ulinzi: inahitaji `maintenance.users` + sheria zilezile za reset password (tenant/role/idara); username lazima iwe ya kipekee kwa biashara zote; username ya Super Admin wa kwanza (`SUPER_ADMIN_USERNAME`) haibadilishwi hapa.

**Hatari ambayo haijathibitishwa:** majina ya indexes ya `authAccounts` (`providerAndAccountId`) yametumika kulingana na `authTables` ya `@convex-dev/auth`. Hakikisha kwa kuendesha test `username change` na kujaribu kwa mkono kwenye deployment ya majaribio: ingia → badili username → ingia kwa jina jipya → jina la zamani likataliwe.

## 5. Printing / risiti

- Paper (58mm / 80mm / A4) na auto-print zinaongozwa na Maintenance › Hardware Setup (`paperWidth`, `autoPrintReceipt`).
- Auto-print inachochewa na `printToken` inayoongezeka mara moja baada ya sale kuhifadhiwa; `BillSheet` inachapisha mara moja kwa kila token (si kwa re-render). Ikiwa auto-print imezimwa, sale inahifadhiwa bila kuchapisha. Kuchapisha tena hakuundi sale mpya.
- Kupokea sale mara mbili kunazuiwa na `requestKey` (sehemu 3).
- **Silent printing:** browser inaonyesha print dialog. Printing bila dialog inahitaji QZ Tray (dependency `qz-tray` ipo) iliyosakinishwa na kuaminiwa kwenye kompyuta ya kaunta. **Haijathibitishwa hapa.** Jaribu na printer halisi ya 58mm/80mm kabla ya kutegemea.

## 6. Backup na recovery

- Ndani ya mfumo: Maintenance › Backup inasafirisha data (`backupTables`) na kurekodi tukio kwenye audit. Hii ni nakala ya data, si restore ya kiotomatiki.
- Convex: tumia snapshot export ya deployment yako (`npx convex export --path backup.zip`) na dashboard ya Convex (Backups) kama mpango wako unaruhusu. Hakikisha chaguo lililopo kwenye plan yako.
- Utaratibu unaopendekezwa: (1) export kabla ya kila deployment ya schema/migration; (2) hifadhi nakala nje ya Convex na usiziweke kwenye Git/ZIP; (3) jaribu restore kwenye deployment ya majaribio (`npx convex import`) angalau mara moja kwa robo mwaka; (4) weka retention (mfano: kila siku 7, kila wiki 4, kila mwezi 12).
- **Haijajaribiwa:** restore haijafanyika hapa; usidhani backup inafanya kazi hadi uijaribu.

## 7. Mapungufu yaliyobaki (hayakukamilishwa kwenye toleo hili)

- Tests mpya zimeandikwa (`convex/warehouses.test.ts`, `convex/idempotency.test.ts`) lakini **hazijaendeshwa**.
- Haijakaguliwa kwa kina kila query/mutation ya Accounts, Payroll na Reports kwa permissions za kila kitendo (`view/create/edit/delete/export`); katalogi ina funguo nyingi (`*.view`, `*.manage`, `*.print`, `*.export`, `*.reports.view`, `*.approve`) lakini si kila kitendo (mfano `delete`, `void`, `edit` kwa kila module) kina ufunguo wake.
- Waiter/Waitress: wanaanza bila permissions (zinasanidiwa na Super Admin); sijaandika test mpya ya role hizi.
- Notifications: reads zimefungwa kwa `userId` na feed inatumia `scopedRows` (tenant); test iliyopo (`notificationsRead.test.ts`) inashughulikia read-state, si cross-user.
- Performance: sijapima kabla/baada; `warehouses.*` mpya zinatumia indexes na `take` yenye kikomo.
- Offline mode: **haijatekelezwa**, kama ulivyoagiza.
