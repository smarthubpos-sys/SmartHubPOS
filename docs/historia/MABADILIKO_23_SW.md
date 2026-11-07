# MABADILIKO 23 — Ukaguzi wa mapungufu na marekebisho

## Mapungufu yaliyopatikana na kutatuliwa

1. **Kikomo cha mkopo wa mteja hakikutumika.** Sehemu ya Credit Limit / Credit Policy ilihifadhiwa lakini mauzo hayakuikagua kamwe.
   Sasa `createInvoice` inakagua (deni la mwanzo + madeni ya wazi + deni la invoice mpya):
   - `block` → inakataa. Bila kikomo, `block` inamaanisha hakuna mkopo kabisa (mauzo yaliyolipwa kamili yanaruhusiwa).
   - `require_approval` → cashier anakataliwa, meneja anaruhusiwa.
   - `warn` → inaruhusu na kuonyesha onyo kwenye skrini.
   - `allow` → hakuna ukaguzi.
2. **Hakukuwa na njia ya kubatilisha invoice iliyokosewa** (Purchasing na Bills zilikuwa nayo; Sales haikuwa nayo).
   Sasa kuna kitufe **Batilisha invoice iliyochaguliwa** (meneja pekee) kwenye Invoicing: stoo inarudi (movement ya `sale_return`), mauzo/kodi/cost vinarudishwa kwenye ledger, deni linafutwa,
   na malipo yaliyopokelewa yanarudishwa kutoka kwenye akaunti ileile ya njia ya malipo. Invoice inabaki kwenye rekodi kama `cancelled` na inatoka kwenye ripoti zote, salio na jumla.
3. **Vipindi vilivyofungwa (closed/locked) havikuzuia chochote.** Sasa kila muamala unaopita kwenye ledger (mauzo, malipo, manunuzi, bili, mishahara)
   unakataliwa ukiwa na tarehe ndani ya kipindi kilichofungwa. Kipindi bila branch kinahusu biashara nzima.
4. **Skrini ya Invoicing ilizuia mauzo ya stock hasi hata ukiruhusu "negative stock" kwenye Maintenance.** Sasa inafuata mpangilio uleule wa seva.

## Tangu MABADILIKO 22 (bado yanahusika)
- Sold Item Report: chagua item moja na uichapishe (nakala 1–10, 80mm/58mm/A4).
- Notifications zinaonekana zimesomwa papo hapo.

## Uthibitishaji
`tsc -b` safi, `vite build` imefanikiwa, majaribio 109 yanapita (6 mapya: kikomo cha mkopo, kubatilisha invoice na ledger kubaki sawa, vipindi vilivyofungwa).
Bado haijajaribiwa kwenye Convex halisi/printer halisi.

## Yaliyoonekana lakini hayajaguswa (yanahitaji uamuzi wako)
- Marejesho ya sehemu ya bidhaa (sales return ya kiasi fulani tu): jedwali `salesReturns` lipo lakini halina skrini wala mutation.
- Ukaguzi wa kikomo cha mkopo unasoma invoices zote za mteja mmoja; mteja mwenye maelfu ya invoices atahitaji jumla iliyohifadhiwa.
- Lint ina makosa mengi ya `any` (hayaathiri utendaji) na onyo la `setState` ndani ya effect kwenye `EditBusinessPanel.tsx`.
