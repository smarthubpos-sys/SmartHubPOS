SmartHubPOS — Sales & Stock Reports + Batch/Serial Integrated Workflows

Kazi hii inaunganisha ripoti na workflow mbili zilizokuwa zimebaki:
1. Purchase Entry na PO/GRN kupokea bidhaa pamoja na batch/expiry/serial.
2. Selling Point/Waiter Send/Print kutumia stock batches na serial numbers, na kurejesha traceability wakati wa edit/cancel.

Mabadiliko muhimu:
- Purchase Entry ina sehemu za Lot/Batch, Expiry date na serial numbers kwa bidhaa zilizo-enable tracking.
- GRN ina sehemu hizo hizo kwa kila bidhaa inayopokelewa.
- Confirm GRN na direct Purchase huunda stockLots/stockSerials pamoja na stock movement; serial huunganishwa na lot husika.
- Kuhariri draft GRN huhifadhi batch/expiry/serial metadata; quantity ya bidhaa yenye serial haiwezi kubadilishwa bila kusajili serial zinazolingana.
- Kufuta GRN iliyothibitishwa hutoa batch/serial husika kwenye tracking records; hairuhusu kufuta ikiwa batch au serial imeshatumika.
- Purchase Return hutumia FEFO batches na serials zinazolingana na batch; kufuta Purchase Return hurudisha batch na serial zilizorudishwa.
- Kufuta direct Purchase huzuia kufuta bidhaa ambazo batch/serial zake zimeshauzwa au kutumika.
- Kuhariri mistari ya Purchase yenye tracking records kumezuiwa ili kuzuia quantity, cost, lot na serial records kutofautiana. Tarehe ya purchase ikibadilishwa, tarehe za lot/serial/movement/price history husasishwa.
- Selling Point/Waiter Send au Print hupunguza stock mara moja, hutoa batch kwa FEFO na ku-assign serials kutoka batch zilezile. Cashier receive/print haipunguzi stock tena.
- Waiter bill edit/cancel hurudisha lot allocations na serial status kabla ya kuhesabu upya au kufuta oda.
- Sales invoice hutumia FEFO batches na serials za batch zilizotumika; invoice return/void hurejesha lot na serial provenance.
- Stock Tracking screen inaweza kuunganisha serial za opening stock na batch iliyopo. Hii ni muhimu kwa bidhaa zilizokuwa na stock kabla ya tracking kuanzishwa.
- Maintenance backup/clear na tenant/department guards zinajumuisha tracking tables.
- Sales Reports na Stock Reports zilizokuwa kwenye patch iliyotangulia zimehifadhiwa.

MUHIMU kuhusu stock iliyokuwepo kabla ya tracking:
Mfumo hautabuni expiry dates, lot numbers au serial numbers kwa stock ya zamani. Kwa bidhaa zilizowashwa tracking, sajili opening batch kwanza; ikiwa bidhaa inafuatilia serial pamoja na batch, chagua batch hiyo unapoweka serial numbers. Baada ya backfill, mauzo yatafuata FEFO na serial allocation kwa usahihi.

Ukaguzi:
- TypeScript transpile/syntax check: imepita kwa mafaili yote 17 yaliyokaguliwa.
- Full `tsc -b`, ESLint na Vitest: havijathibitishwa kwa sababu ZIP ya project haina node_modules. Tests mpya zimeongezwa lakini hazijatekelezwa kwenye environment hii.
- Hakuna `convex deploy`, Git push, Vercel deploy au mabadiliko ya production yaliyofanywa.

Tumia patch hii kwenye nakala ya project ya msingi iliyotumika kuandaa kazi hii. Kagua `git diff` kisha endesha `npm ci`, `npm run build`, `npm run lint`, na `npm run test` kabla ya ku-deploy.
