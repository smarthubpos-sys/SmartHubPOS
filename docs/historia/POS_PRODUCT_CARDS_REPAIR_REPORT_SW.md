# SmartHubPOS — Ripoti ya marekebisho ya POS product cards

## Kilichobadilishwa
- Eneo: `src/pages/waiter-orders/SellingPoint.tsx` (product cards za Sales Point/POS ambazo cashier anabonyeza kuongeza bidhaa kwenye cart).
- Ongeza mipangilio ya ukubwa wa kadi (Compact/Standard/Large), idadi ya kadi kwa mstari, rangi ya nyuma, maandishi na border, pamoja na mzunguko wa pembe.
- Mipangilio huhifadhiwa kwenye localStorage kwa business/tenant key; kuna kitufe cha kurudisha default.
- Click-to-add, cart, submit/send/print, payment na stock deduction handlers hazikubadilishwa.
- Hakuna deployment iliyofanyika.

## Uhakiki na mipaka
- `npm run build` haikuweza kuanza kwa sababu ZIP haikuwa na `node_modules`. `npm ci --ignore-scripts --no-audit --no-fund` ilikatishwa na timeout; dependencies hazikukamilika.
- Kwa hiyo build, lint na tests bado HAZIJATHIBITISHWA.
- Schema ya sasa ya bidhaa haina field ya picha ya bidhaa. Ili kuepuka kudai picha zinafanya kazi bila kuunganisha schema, upload/storage na product editor, sehemu ya kuongeza/kubadilisha picha haijaongezwa kwenye patch hii. Picha ni hatua inayofuata inayohitaji kuunganisha product editor na storage iliyopo kwa usahihi.
- Mipangilio hii ni ya kifaa/browser kupitia localStorage, si server-persisted cross-device settings.
- ZIP hii ni ya marekebisho ya source kwa ukaguzi; usi-deploy production kabla ya kusakinisha dependencies na kupitisha build/lint/tests.
