# MABADILIKO 26 — Usalama wa idara, notifications za Super Admin, na bango (ads)

**Haijathibitishwa kwa kuendesha:** marekebisho haya yalifanywa bila `node_modules` na bila intaneti. Syntax ya faili zote
zilizobadilishwa imekaguliwa, lakini `tsc -b`, `npm run lint`, `npm test` na `npm run build` HAVIJAENDESHWA. Endesha hatua za
chini kisha tuma log ya makosa (kama yapo).

## 1. Idara hazichanganyiki tena (hatari kubwa)
| # | Tatizo | Marekebisho | Faili |
|---|---|---|---|
| 1 | Cashier/viewer mpya aliachwa kwenye "Zote" (chaguo-msingi) na aliona data ya idara ZOTE | Biashara yenye idara: cashier, accountant na viewer **lazima** wafungwe kwenye idara moja (server + fomu). Meneja/admin wanaweza kubaki "Zote". | `maintenance.ts`, `UsersPage.tsx` |
| 2 | Admin aliyefungwa idara moja angeweza kujifungua kwa kuhariri akaunti yake (Branch = Zote) | Haruhusiwi kubadilisha idara ya akaunti yake mwenyewe (kama role). Kitufe cha Branch kimefungwa kwenye akaunti yake. | `maintenance.ts`, `UsersPage.tsx` |
| 3 | Admin wa idara A angeweza kusimamia/kuhamisha watumiaji wa idara B na kuwaona wote | Aliyefungwa idara anasimamia, anaona na anaweka watumiaji wa idara yake tu (kuunda, kuhariri, kuzima, reset password, `listUsers`). | `maintenance.ts` |
| 4 | `postJournal` (reference), `createAccount` (code), `createEmployee` (employeeCode) zilikagua "tayari ipo" kwenye biashara ZOTE | Zinakagua ndani ya biashara/idara husika tu. Biashara moja haizuii nyingine tena wala haifichui kuwa code ipo. | `accounting.ts`, `payroll.ts` |
| 5 | Ripoti ya Sales ilisoma invoice 1500 za biashara nzima kisha kuchuja idara; idara ndogo ilikosa invoice za zamani | Mtumiaji wa idara husoma idara yake tu kupitia index mpya (`by_scope_date`, `by_scope_outstanding`). | `sales.ts`, `schema.ts` |
| 6 | Ripoti ya Siku/Mwezi/Mwaka ilisema "kubwa mno" kwa idara ndogo kwa sababu ya idara kubwa | Idara moja ikichaguliwa, inasoma entries za idara hiyo tu (`journalEntries.by_scope_date`). | `periodReport.ts`, `schema.ts` |
| 7 | "Bidhaa zinazouzwa zaidi" za kila idara zilihesabiwa kutoka invoice 300 za biashara nzima | Sampuli inachukuliwa kwa kila idara. | `stats.ts` |
| 8 | Ripoti iliyohifadhiwa ilikubali `scope` na idara yoyote kutoka kivinjari | Server inakagua kuwa idara ya ripoti inaruhusiwa kwa mtumiaji huyo. | `periodReport.ts` |
| 9 | Mtumiaji asiye na idara akihifadhi Company Info angeweza kubadilisha mipangilio ya idara yoyote kwa bahati | Inahariri mstari wa scope yake tu (biashara nzima au idara aliyochagua). | `maintenance.ts` |
| 10 | `removeDepartment` ilikagua meza 10 tu | Sasa inakagua pia malipo, capital, payroll, stock adjustments, groups, returns, orders, attendance na likizo. | `tenants.ts` |

**Watumiaji wa zamani walioachwa "Zote":** orodha ya Users inawaonyesha na alama nyekundu "Zote ⚠ (chagua idara)". Mhariri kila mmoja
na umchagulie idara; hadi hapo wanaendelea kuona idara zote.

## 2. Notifications
- **Dashboard ya Super Admin:** kila mstari wa "Tahadhari" sasa unabonyezeka. Unafungua kadi ya biashara husika (na paneli ya
  usajili kwa "usajili umeisha/unaisha"), na kuiweka mbele ya macho. Paneli ya tahadhari inafunguka yenyewe kukiwa na tahadhari nyekundu.
- **Ujumbe/matangazo kutoka SmartHub** (hayana ukurasa mwingine wa kufungukia) sasa yanafunguka kwenye ukurasa wa Notifications
  kuonyesha ujumbe mzima; kengele inaelekeza moja kwa moja kwenye ujumbe huo.
- **Alerts zisizoweza kufunguka hazionyeshwi tena:** alert inayoelekea moduli ambayo biashara haijalipia (au menyu ya mtumiaji
  imeificha) haionekani, kwa hiyo counter nyekundu haikwami tena.

## 3. Bango la matangazo (ads / billboards)
- Picha sasa inajaza upande wa kulia (kwenye simu ni usuli nyuma ya maandishi); maandishi makubwa na yanasomeka.
- Bango zima linafungua kiungo (si kitufe kidogo tu). Mibofyo inahesabiwa.
- Mishale ya kushoto/kulia, kuswipe kwenye simu, vitone vikubwa vya kubonyeza, mstari wa muda; linasimama ukilielea/ukiligusa
  au tab ikiwa imefichwa; linaheshimu "reduce motion".
- Super Admin: kitufe cha **Hariri** (hakuna kufuta na kuandika upya), idadi ya **mibofyo** kwa kila tangazo, na onyesho la awali
  lililo sawa na la mtumiaji. Kiungo/picha ukiyafuta wakati wa kuhariri yanaondolewa kweli.
- Faili: `ads-carousel.tsx`, `AnnouncementsAdmin.tsx`, `announcements.ts` (`update`, `trackClick`), `schema.ts` (`clicks`), `index.css`.

## Majaribio mapya
`convex/departmentIsolation.test.ts`: kujifungua mwenyewe, kusimamia idara nyingine, sheria ya "Zote", code za biashara
mbalimbali, ripoti za idara, `periodReport.save`, notifications kwa moduli, na kuhariri/kuhesabu mibofyo ya bango.

## Hatua za kuthibitisha
```
npm install
npx convex dev        # inajenga index mpya: by_scope_date (invoices, customerPayments, journalEntries), by_scope_outstanding
npx tsc -b
npm run lint
npm test
npm run build
```

## 4. "Tayari ipo mtu" wakati wa kusajili admin / mtumiaji
**Chanzo:** si kikomo cha role. Biashara moja tayari inaweza kuwa na admin na watumiaji wengi wa role moja. Tatizo ni kuwa
**username ni ya kipekee kwa biashara ZOTE** (login ina username + password tu), kwa hiyo "admin" ya biashara mpya iligongana
na "admin" ya biashara nyingine. Ujumbe wa zamani haukueleza hilo.

**Marekebisho (`maintenance.ts`, `UsersPage.tsx`):**
- Ujumbe wazi: `Username "admin" tayari inatumika ... Jaribu: admin.duka1, admin1, admin2.` (mapendekezo ni majina huru).
- Akaunti iliyoanza kuundwa lakini haikukamilika (kosa la awali) sasa inakamilishwa na password mpya badala ya kukataa milele.
- Username ya Super Admin (`SUPER_ADMIN_USERNAME`) imehifadhiwa na haiwezi kutumika kwa mtumiaji wa biashara.
- Kidokezo kwenye fomu kinaeleza kuwa username ni ya kipekee na kuwa admin wengi wanaruhusiwa.
- Hatukubadilisha mfumo wa login (kuruhusu username ile ile kwa biashara mbili kungehitaji code ya biashara kwenye skrini ya login).

## 5. Mtumiaji kupewa idara kadhaa (mfano mhudumu wa Bar na Jikoni)
Fomu ya Users (kwa watumiaji wote wanaosajiliwa) sasa ina sehemu **"Idara anazoweza kufanyia kazi"**:
- **Tiki idara moja** → amefungwa kwenye idara hiyo tu.
- **Tiki idara mbili au zaidi** (mfano Bar + Jikoni) → anabadilisha kati ya hizo tu kwa kitufe cha idara juu ya skrini. Kila wakati
  anaona na kuuza kwenye idara moja aliyoichagua, kwa hiyo data za idara hazichanganyiki. Idara asiyopewa (mfano Lounge) hazionyeshwi
  wala hawezi kuzifikia (server inakataa).
- **Tiki "Idara zote"** → ruhusa ya wazi kwa mtumiaji yeyote (hata mhudumu/cashier). Anaweza kubadilisha kwenda idara yoyote na
  kuona mwonekano wa pamoja.
- **Menyu anazoona (Sales, Bills n.k.)** zinaendelea kuchaguliwa kwa vibox vya kutiki chini yake, kwa kila mtumiaji.

**Sheria na mipaka:**
- Biashara yenye idara: cashier/accountant/viewer lazima wawe na idara moja au zaidi, AU "Idara zote" iwashwe kwa makusudi.
- Aliyefungwa kwenye idara moja au chache anaweza kuwapa wengine idara hizo hizo tu (si "Idara zote", si idara nyingine), na haoni
  watumiaji wa idara zisizo zake. Hawezi kubadilisha idara za akaunti yake mwenyewe.
- Idara lazima iwe ya biashara ile ile (id kutoka biashara nyingine inakataliwa).
- Mtumiaji mwenye idara kadhaa: ripoti ya Siku/Mwezi/Mwaka ni ya idara aliyomo sasa, na "bili za wateja za idara zote" imezimwa kwake.
- Ukiondoa idara, inatolewa kwenye orodha ya wale waliopewa kadhaa; wakibaki na moja wanafungwa kwenye hiyo.
- Watumiaji wa zamani hawabadiliki. Orodha ya Users sasa inaonyesha majina ya idara zao.

Faili: `schema.ts` (`branchIds`, `allDepartments`), `access.ts`, `maintenance.ts`, `tenants.ts`, `periodReport.ts`, `customerBills.ts`,
`UsersPage.tsx`, `TopBar.tsx`. Majaribio: sehemu mpya kwenye `departmentIsolation.test.ts`.
