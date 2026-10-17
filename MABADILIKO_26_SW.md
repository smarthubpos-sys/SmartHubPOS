# SmartHubPOS — Marekebisho ya awamu hii

## Yaliyotekelezwa kwenye source

1. **Waiter na Waitress** zimeongezwa kama system roles kwenye Role Management. Zinaanza bila permissions ili msimamizi awape majukumu yanayohitajika badala ya kupewa ruhusa pana kwa chaguo-msingi.
2. **Mipangilio ya karatasi/uchapishaji wa risiti** kwenye Sales > Invoice Entry sasa inasomwa kutoka Maintenance > Hardware Setup. Chaguo la kubadilisha aina ya karatasi limeondolewa kwenye sehemu ya Invoice.
3. **Automatic receipt printing**: baada ya invoice kuhifadhiwa kwa mafanikio, mfumo hutuma print request tu ikiwa `autoPrintReceipt` imewashwa kwenye Hardware Setup. Invoice haitengenezwi tena kwa sababu ya jaribio la kuchapisha. Mtumiaji anaweza bado kutumia kitufe cha Chapisha mwenyewe.
4. `TransactionReceipt` inatumia ukubwa wa karatasi uliowekwa kwenye Hardware Setup badala ya kuonyesha selector ya printer kwenye risiti.

## Mipaka muhimu

- Offline mode haijajumuishwa kwa makusudi, kama ilivyoelekezwa.
- Hii **si release inayothibitisha kuwa maombi yote ya awali yamekamilika**. Mfumo wa ruhusa za kina kwa kila kitendo/report na enforcement yake kwa kila endpoint, Store/Ghala yenye transfers/ledger/reports, na ukaguzi kamili wa username/credential update bado vinahitaji utekelezaji na majaribio tofauti.
- Username haijafunguliwa kuhaririwa kwenye fomu kwa sababu login hutumia identifier ya Convex Auth pia; kubadilisha field pekee kunaweza kumzuia mtumiaji kuingia. Inahitaji utaratibu salama unaosasisha credential identifier kwa pamoja.
- Build na tests hazikuweza kuthibitishwa katika mazingira haya: `npm ci` ilikwama kwa timeout. Endesha `npm ci`, `npm run build`, `npm test`, na `npm run lint` kwenye mazingira ya mradi kabla ya production deployment.
- Uchapishaji wa moja kwa moja hutegemea uwezo wa browser/printer na mipangilio ya kifaa. Kwa printer ya OS kupitia jina lake, QZ Tray inaweza kuhitajika.

## Usalama wa ZIP

ZIP hii imeandaliwa bila `.env.local`, `.git`, `node_modules`, `.vercel`, `dist`, `fix-backup`, au mafaili ya private key.
