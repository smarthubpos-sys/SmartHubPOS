# SmartHubPOS — Marekebisho ya Stock na Sales (2026-10-11)

## Kilichobadilika

### Sales (Invoicing) — sasa inafanya kazi kama Purchase Entry
- Invoice moja ina bidhaa nyingi: kitufe cha **＋ Add Line**, **Ondoa** kwa kila mstari, jumla ya kila mstari na jumla ya invoice.
- Ukichagua bidhaa, **bei ya kuuzia inajazwa yenyewe** kutoka Add / Modify Stock (unaweza kuibadilisha kwenye mstari).
- Scan barcode au andika item code kisha Enter — bidhaa inaongezwa (ikirudiwa, quantity inaongezeka).
- Stock inakaguliwa kwa jumla ya bidhaa ile ile hata ikiwa kwenye mistari miwili (kosa la zamani liliruhusu stock kwenda hasi).
- Namba ya invoice ni mfuatano (INV-00001, INV-00002…) kwa kutumia prefix ya Maintenance; haijirudii.
- Mipangilio ya "allow negative stock" kwenye Company settings inaheshimiwa.
- Skrini zote za Sales zina kazi yake (awali zote zilionyesha fomu ile ile moja):
  Payment Received, Add / Modify Client (na "Cash Customer" kwa mbofyo mmoja), List of Clients,
  Invoice Report, Summary, Client Statement, Analysis, Tax, Payments, Sales by Client / Product / Supplier / Staff / Source,
  Client Sales Product, Product Sales by Client, Sold Item Report.

### Stock
- **Add / Modify Stock** ni sehemu ya kusajili bidhaa mpya, kubadilisha jina/group/unit/barcode na **kubadilisha bei ya kuuzia**.
  - Opening quantity na opening cost zinawekwa **bidhaa mpya tu**; zinarekodiwa kama movement na journal (Inventory / Opening balance equity).
  - Kuhariri bidhaa **haibadilishi tena idadi ya stock** (zamani opening qty ilihifadhiwa bila kubadilisha stock halisi). Idadi hubadilika kwa Purchase, Sales na Quantity Adjustment tu.
  - Item code na barcode zinakaguliwa kwa ofisi/branch yako tu; mabadiliko ya bei yanaandikwa kwenye Audit Trail.
- **Quantity Adjustment**: onyesho la stock ya mfumo, tofauti na thamani kabla ya kuhifadhi; sababu inahitajika.
- **Group Maintenance**: Product Groups na Units of Measure.
- **Ripoti zote za stock** zinatoka kwenye query moja (`inventory.stockRegisters`):
  Item Quantity, Quantity Report, Selling Price (na faida/kipande), Stock Earning (faida kwa bidhaa kutoka invoices zilizopostiwa),
  Stock Taking (count dhidi ya mfumo), Reorder, Out of Stock, Transaction Quantity, Item History (na salio la kuanzia na running balance iliyohesabiwa upya),
  Print Stock Barcodes. Kila ripoti ina Export CSV na Print.
- Ripoti inaonya kama historia ya movements ya bidhaa haiendani na stock iliyopo (data za zamani); kitufe cha **Sawazisha historia** kinarekebisha.

## Mipaka (inasemwa wazi)
- **Expired Date** na **Serial Number**: mfumo hauna jedwali la batch/expiry/serial, kwa hiyo ripoti zinaorodhesha bidhaa zilizowekwa "Track expiry/serial" pamoja na stock. Ripoti kamili inahitaji kurekodi expiry/serial kwenye Purchase/GRN.
- **Print Stock Barcodes** inachapa jina, bei na namba ya barcode; mistari ya barcode (bars) inahitaji barcode font/maktaba.
- Invoice haina Print/Receipt bado, na hakuna Sales Return.
- Skrini za zamani za Sales/Stock ndani ya `ModuleWorkspace.tsx` hazitumiki tena (zimeachwa bila kuguswa).

## Hatua za kutumia
1. Hifadhi nakala ya mradi/database ya sasa.
2. Extract ZIP, nakili `.env.local` yako.
3. `npm install`
4. `npx convex dev` — inaongeza jedwali jipya `salesSequences` na kusasisha `_generated`.
5. `npm run dev`
6. Stock ya zamani: fungua **Stock → Item Quantity**; ukiona onyo la historia, bonyeza **Sawazisha historia** mara moja.

## Uhakiki uliofanyika
- `tsc -b` na `npm run build` zinapita.
- Majaribio mapya ya backend (`convex/stock.test.ts`, 4) na yaliyokuwepo (11) yote yanapita:
  usajili wa bidhaa + opening stock, kuhariri bila kubadilisha idadi, invoice ya mistari mingi, kukataa stock kupita kwenye mistari miwili,
  faida kwa bidhaa, running balance, salio la mteja, adjustment na reconcile.
- Skrini hazijajaribiwa kwenye browser na database yako halisi (hapa hakuna Convex deployment); jaribu mtiririko mmoja kamili: bidhaa → purchase → sale → ripoti.

## Marekebisho ya baadaye: Branch si lazima (2026-10-11)
- Kosa "Super Admin lazima achague akaunti ya ofisi/branch" wakati wa kuongeza item limeondolewa.
- Shughuli zote za biashara (bidhaa, stock, mauzo, wateja, manunuzi, payroll, accounts, settings) sasa zinatumia `resolveWriteScope`:
  Super Admin anafanya kazi hata bila ofisi/branch; kama ofisi ipo hutumika ya kwanza iliyo active.
- Mtumiaji wa kawaida anahitaji ofisi (tenant) tu; **branch ni hiari** na inaweza kuongezwa baadaye bila kuathiri kazi.
- Jaribio jipya linathibitisha: Super Admin bila ofisi/branch anaweza kuongeza mteja, bidhaa, kuuza na kuona ripoti.
