# Mabadiliko 28 — Ukaguzi wa "jicho la tatu": Purchasing, Suppliers, Wateja, Stock na bei

**Haijathibitishwa kwa kuendesha:** marekebisho haya yalifanywa bila `node_modules` na bila intaneti. Syntax ya faili zote
zilizobadilishwa imekaguliwa, lakini `tsc -b`, `npm run lint`, `npm test` na `npm run build` HAVIJAENDESHWA.
Endesha hatua za chini kisha tuma log ya makosa (kama yapo).

## 1. Swichi za Purchasing (Edit / Futa) — hali ya sasa
Swichi mbili tayari zipo (Mabadiliko 27, sehemu ya 2): `purchasing.edit` na `purchasing.delete`, zinafanya kazi kama `sales.void`
(kwa role nzima kupitia Role Management, au kwa mtu mmoja kupitia User Settings → "Ruhusa maalum kwa mtumiaji huyu").
Vitufe vya Edit/Futa vinaonekana kwenye: Purchase Entry, Purchase Invoice List, Purchase Orders, GRN na Purchase Returns.

**Tatizo lililopatikana:** role ya Manager/Admin iliyohifadhiwa KABLA ya swichi hizi kuwepo haikuwa nazo kabisa, hivyo vitufe
vilibaki vimefichwa hata kwa meneja (ilibidi kutiki mwenyewe). Sasa funguo mpya (`sales.void`, `purchasing.edit`,
`purchasing.delete`) zinapewa role za mfumo kwa chaguo-msingi zake hadi role ihifadhiwe tena; baada ya kuhifadhi, chaguo la role
ndilo linalotumika. (`schema.ts`: `roles.knownKeys`; `permissions.ts`: `permissionsWithNewDefaults`.)

## 2. Makosa yaliyorekebishwa
| # | Tatizo | Marekebisho | Faili |
|---|---|---|---|
| 1 | **Mtumiaji wa idara hakuona suppliers** kwenye Purchasing registers (majina yalikuwa "Supplier"); suppliers ni wa biashara nzima lakini orodha ilichujwa kwa idara | Inachujwa kwa biashara (`filterBusiness`) | `purchasing.ts` |
| 2 | Ruhusa `purchasing.manage` na `stock.manage` zilikuwepo kwenye Role Management lakini seva ilikubali **meneja tu** (role maalum kama "Store keeper" ilikataliwa) | `requireManagerOrPermission`: meneja au mwenye ruhusa hiyo | `access.ts`, `purchasing.ts`, `products.ts`, `inventory.ts` |
| 3 | Invoice moja ya supplier iliweza kuingizwa mara mbili (double entry) | Namba ya invoice ya supplier haiwezi kujirudia kwa supplier yule yule (kwenye kuingiza na kuhariri) | `purchasing.ts`, `purchasingEdit.ts` |
| 4 | Bei ya wastani ya gharama ilikuwa mbaya wakati stock ilikuwa hasi (biashara zinazoruhusu stock hasi) | Wastani unahesabiwa kwa stock chanya tu (purchase na GRN) | `purchasing.ts` |
| 5 | Ripoti ya "Earnings" ya Stock ilihesabu pia bidhaa zilizorudishwa (partial return) — haikulingana na ripoti ya Sales | Inahesabu kilichobaki kuuzwa tu | `inventory.ts` |
| 6 | Mhudumu (staff mode) mwenye ruhusa ya kufuta oda angeweza kufuta invoice za wengine kwa kuita seva moja kwa moja | Staff anafuta invoice zake mwenyewe tu | `sales.ts` |
| 7 | Code ya mteja ilikaguliwa wakati wa kuunda tu; kuhariri kuliruhusu code mbili sawa. Pia hakukuwa na audit trail | Ukaguzi pia wakati wa kuhariri (ndani ya biashara/idara ile ile); jina/code zinapunguzwa nafasi; audit trail (`create_client`, `update_client`) | `clients.ts` |

## 3. Yaliyokaguliwa na hayakuhitaji kubadilishwa
- Suppliers ni wa biashara nzima, code ni ya kipekee ndani ya biashara moja; wateja ni wa idara moja moja (kwa makusudi) na bili za idara zote zinatambua mteja yule yule kwa jina/code.
- Purchase → stock, gharama ya wastani, deni la supplier, ledger na dashboard vinaenda sawa; edit/futa vinarekebisha kwa tofauti tu na kuacha audit trail.
- Sales → stock, gharama wakati wa mauzo (`costAtSale`), ledger, marejesho na kufuta vinaendana.

## 4. Mambo ya kufahamu (hayakubadilishwa kwa makusudi)
- Bei ya kuuza kwenye invoice inatoka kwenye skrini (cashier anaweza kubadilisha); seva haikatazi kuuza chini ya gharama.
- Kubadilisha **tarehe tu** ya purchase invoice kunahamisha takwimu za dashboard, lakini tarehe ya ledger na ya stock movement inabaki ya awali.
- Role ni za mfumo mzima (hazina biashara); kuhariri role kunaathiri biashara zote — ni Super Admin pekee mwenye `maintenance.roles`.

## Majaribio mapya
`convex/auditFixes.test.ts`: suppliers kwa mtumiaji wa idara, invoice ya supplier mara mbili, role ya Manager ya zamani, role maalum
yenye `purchasing.manage` tu, wastani wa gharama stock ikiwa hasi, na code ya mteja mara mbili wakati wa kuhariri.

## Hatua za kuthibitisha
```
npm install
npx convex dev        # inasukuma schema mpya (roles.knownKeys, ni hiari)
npx tsc -b
npm run lint
npm test
npm run build
```

## Faili zilizobadilika
convex/access.ts, permissions.ts, schema.ts, maintenance.ts, purchasing.ts, purchasingEdit.ts, products.ts, inventory.ts, sales.ts,
clients.ts, auditFixes.test.ts (mpya)

---

# Sehemu ya 2 — Kubadili / kufuta stock ni ruhusa inayotolewa na Super Admin

Ruhusa mpya: **`stock.adjust`** ("Change / delete stock"). Haipo kwa mtu yeyote kwa chaguo-msingi: **si Administrator, si Manager,
si "owner"**. Inapatikana tu pale Super Admin anapoitiki, na inaweza kupewa **role yoyote (hata Cashier)** au **mtu mmoja**.

## Inalinda nini
| Kitendo | Kinahitaji |
|---|---|
| Quantity Adjustment (kubadili / kufuta idadi ya stock) | `stock.adjust` |
| Sawazisha historia (reconcile movements) | `stock.adjust` |
| Kuhariri au kuzima (deactivate) bidhaa iliyopo (Modify) | `stock.adjust` |
| Excel import yenye "kuboresha zilizopo" | `stock.adjust` |
| Kusajili bidhaa MPYA, groups, units, import ya bidhaa mpya | `stock.manage` au meneja (kama awali) |

## Namna ya kuitoa (Super Admin)
1. **Kwa role nzima:** Maintenance → Role Management → role → kundi *Stock* → tiki **"Change / delete stock"**.
2. **Kwa mtu mmoja:** Maintenance → User Settings → Modify → *"Ruhusa maalum kwa mtumiaji huyu"* → tiki
   **"Anaweza kubadili / kufuta stock"**.

Kutoa au kuondoa ruhusa hii (kwa role au kwa mtu) **kunaruhusiwa Super Admin tu**; Administrator hawezi (seva inakataa, na kisanduku
kimefungwa kwenye fomu ya Users). Role ya "owner" (wildcard `*`) pia haipati ruhusa hii yenyewe.

## Skrini
Mtu asiye na ruhusa haoni "Quantity Adjustment" kwenye menyu ya Stock, kitufe cha "Modify" kwenye orodha ya bidhaa, kitufe cha
"Sawazisha historia", wala chaguo la "kuboresha zilizopo" kwenye Import. Seva inakagua tena kila ombi.

## Muhimu
- Meneja/Admin waliozoea kurekebisha stock **hawataweza tena** hadi Super Admin awape ruhusa hii.
- Majaribio yaliyokuwa yanatumia meneja kurekebisha stock (`stock.test.ts`, `features.test.ts`) yamesasishwa kumpa ruhusa hii.
- Majaribio mapya: `convex/auditFixes.test.ts` (sehemu ya mwisho).

## Faili zilizobadilika (sehemu ya 2)
convex/permissions.ts, access.ts, maintenance.ts, inventory.ts, products.ts, tenants.ts (`canAdjustStock`), stock.test.ts, features.test.ts, auditFixes.test.ts;
src/hooks/use-stock-rights.ts (mpya), src/pages/stock/{page,StockWorkspace,StockImport}.tsx, src/pages/layout/_components/ModuleWorkspace.tsx,
src/pages/maintenance/UsersPage.tsx, src/lib/i18n-dict-access.ts
