# MABADILIKO 61 - Minus ya bidhaa za menu ifutike, na batch isiunde mara mbili

Tatizo: bidhaa ya menu (yenye recipe) iliuzwa ikiwa haina stock -> ikaingia minus; na batch ya baadaye iliunda tena bidhaa zilezile
(malighafi zilitumika mara mbili kwa vitu vilivyokwisha uzwa).

Suluhisho (recipe zenye tiki ya "auto on sale"):
1. autoProduce.ts: mauzo yakikuta stock iko chini ya 0, yanatengeneza pia kiasi kinachokosekana (minus) kutoka kwenye malighafi;
   bidhaa inaishia 0, haibaki minus. (assertAutoProducible inakagua malighafi kwa kiasi hicho hicho.)
2. production.ts / produceBatch: kabla ya kutengeneza, batch mpya inakamilisha kwanza kiasi kilichoshatengenezwa wakati wa mauzo
   (settledQty). Kiasi hicho HAKITUMII malighafi mara ya pili wala hakiongezi stock; kilichobaki tu ndicho kinatengenezwa.
   Kama kiasi chote kilishatengenezwa wakati wa mauzo, hakuna batch mpya (inarudi settledQty tu).
3. production.ts / clearNegativeStock + kitufe "Futa minus" (Stock > Production): inatengeneza kutoka kwenye recipe bidhaa zote
   zilizo minus sasa; zenye malighafi pungufu zinarukwa na kuorodheshwa.
4. schema.ts: productionBatches.autoOnSale na settledQty (optional).

Mipaka:
- Inahusu recipe zenye "auto on sale" tu. Zisizo na tiki hiyo zinabaki kama zamani.
- Kuhariri/kufuta batch iliyokuwa na settled hakurudishi settledQty ya batch za mauzo.
- Minus zilizopo sasa zinafutika kwa kitufe, au kwa mauzo yanayofuata ya bidhaa hiyo.
- Mauzo kupitia kuhariri bili/invoice bado hayatengenezi upungufu wa recipe.
HAIJAJARIBIWA: npx vitest run convex/autoProduce.test.ts ; npx tsc -b ; npx eslint . ; npx convex deploy ; npm run build

## Nyongeza (61b)
5. Bidhaa iliyokuwa minus kabla ya kuwa na recipe: ukihifadhi recipe yake (Production > Hifadhi Recipe) ikiwa na tiki ya "auto on sale",
   minus yote inafutwa papo hapo kwa kuchukua malighafi (batch inarekodiwa, bidhaa inarudi 0). Malighafi zikipungua, recipe inabaki
   imehifadhiwa na ujumbe unasema minus haikufutika (tumia kitufe "Futa minus" baada ya kuongeza malighafi).
   Kuanzia hapo kila mauzo yanachukua kutoka stock ya bidhaa, na upungufu unatengenezwa kutoka malighafi.
6. Uzio wa jina: haiwezekani kutengeneza (au kubadilisha jina kuwa) bidhaa yenye jina lile lile la bidhaa nyingine hai kwenye biashara
   (herufi kubwa/ndogo na nafasi za ziada hazihesabiwi) - mfano "Mbuzi Makange" mara mbili. Bidhaa ya "idara zote" inagongana na jina
   lile lile kwenye idara yoyote. Bidhaa za zamani zenye majina yanayojirudia hazizuiwi kuhaririwa kwa mambo mengine; zima/futa moja yao.
   (Import ya Excel ilikuwa tayari inakataa majina yanayojirudia.)
   Faili: convex/products.ts (upsert), convex/production.ts (saveRecipe), src/pages/stock/ProductionPage.tsx.
