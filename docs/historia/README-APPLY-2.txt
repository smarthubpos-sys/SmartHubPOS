SMART HUB POS — PATCH YA MAREKEBISHO 2 TU

Patch hii inashughulikia mambo mawili yaliyobaki:
1) Purchases: Last Cost iko kabla ya Total; Total ndiyo column ya mwisho. Mtumiaji anaweza kuingiza Last Cost au Total, na thamani nyingine inahesabiwa yenyewe.
2) Invoice iliyolipishwa: kwenye Invoice Finder kuna hatua ya Unpay kabla ya Edit au Cancel. Unpay hurudisha malipo kwenye njia zilezile za awali, hufungua deni tena, huhifadhi mauzo na stock, huandika journal/audit log, na hurekebisha takwimu za malipo. Invoice yenye customer bill au returns haitaruhusiwa kufanyiwa Unpay mpaka mambo hayo yashughulikiwe.

JINSI YA KUTUMIA
- Extract ZIP kwenye folder ya project SmartHubPOS na ukubali Replace kwa mafaili yaliyo ndani yake tu.
- Hakuna mafaili mengine ya project yanayopaswa kubadilishwa.
- Kisha endesha:
  npx vitest run convex/invoiceFinder.test.ts
  npx vitest run convex/userAccessGrant.test.ts
  npm run build
  npm run test
  npm run lint
- Usifanye Convex deploy au Git push mpaka tests zote zipite na git diff ikaguliwe.

KUMBUKA
Unpay ni refund halisi ya kiasi kilicholipwa: itapunguza cash/bank/mobile-money account kulingana na njia za awali na kuongeza deni la invoice. Hakikisha fedha zimerejeshwa kwa mteja kabla ya kuthibitisha Unpay.
