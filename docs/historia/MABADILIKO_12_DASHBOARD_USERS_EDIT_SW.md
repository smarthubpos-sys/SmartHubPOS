# MABADILIKO 12 — Dashboard, biashara, na watumiaji

## Mabadiliko yaliyofanywa kwenye code
- Business Picker sasa ina muhtasari wa idadi ya biashara, demo, usajili wa kulipia, usajili unaokaribia kuisha, mapato yote yaliyorekodiwa na mapato ya mwezi huu.
- Muhtasari unatokana na Convex database na umewekewa ukaguzi wa Super Admin kwenye backend. Mapato yanajumlisha `subscriptionPayments` pekee, si mauzo ya wateja wa biashara.
- Orodha ya usajili unaoisha ndani ya siku 7 inaonyesha biashara, code, tarehe ya mwisho na siku zilizobaki.
- Kadi za biashara zimepunguzwa ukubwa; vitendo vya usajili na kuhariri vimewekwa kama vitufe vidogo vya alama.
- Kitufe cha kuhariri kwenye orodha ya ofisi kimepangwa upya na paneli ya kuhariri imepewa rangi ya kawaida ya mfumo ili maandishi yasipotee.
- Validator ya `createUser` na `finishUserSetup` kwenye code hii inakubali `ownDataOnly`.

## Muhimu baada ya kufungua ZIP
Kosa `Object contains extra field ownDataOnly that is not in the validator` linaonyesha deployment ya Convex inayotumika inaweza kuwa na validator ya zamani kuliko faili hizi. Baada ya kutumia ZIP hii, peleka mabadiliko ya backend kwenye deployment sahihi ya Convex (kwa kawaida `npx convex dev` kwa development). Usiondoe `ownDataOnly` kwenye UI kama njia ya kuficha kosa; hilo lingeondoa chaguo la mipaka ya data kwa mtumiaji.

## Uthibitishaji
Build ya TypeScript/Vite haikukamilika kwenye mazingira haya kwa sababu `npm ci` ilikatizwa na utegemezi haukusakinishwa kikamilifu. Kwa hiyo, ZIP hii haipaswi kuchukuliwa kuwa build iliyothibitishwa; endesha `npm ci`, kisha `npm run build` na `npm test` kabla ya deployment ya production.
