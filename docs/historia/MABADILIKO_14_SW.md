# MABADILIKO 14 — Dashboard ya Super Admin na simu/tablet

## 1. Dashboard ya kuchagua biashara (Super Admin)
- Takwimu (biashara zote, demo, zilizolipia, zinazoisha karibuni, mapato yote, mapato mwezi huu) sasa ni vichipu vidogo.
- Orodha ya biashara ni safu ndogo (jina, code, hali). Ukibonyeza safu inafunguka na kuonyesha: usajili, jumla iliyolipwa na biashara hiyo, na vitufe (Ingia, Simamisha/Washa, Usajili, Hariri). Kuna sehemu ya kutafuta biashara.
- Sehemu mpya **Tahadhari** (inafunguka ukibonyeza, ina idadi): usajili ulioisha, unaoisha karibuni (siku 7), biashara zilizosimamishwa, na biashara ambazo watumiaji wake wamekutana na vitendo vilivyoshindwa ndani ya saa 24 (kutoka audit log). Ukiingia, ukiwepo tahadhari nyekundu, unapata ujumbe (toast) mara moja kwa kila kikao.
- Backend: `subscriptions.dashboardSummary` sasa inarudisha pia `alerts` na `paidByTenant`.

## 2. Simu na tablet
- Menyu ya pembeni kwenye simu ni drawer inayofunguka juu ya ukurasa (inaanza imefungwa, inajifunga ukichagua ukurasa au ukibonyeza nje). Tablet/desktop: inabaki kama awali (inapunguzwa kuwa alama).
- TopBar imepunguzwa: jina la ukurasa linakatwa vizuri, vitufe vya idara na "Badilisha biashara" vinaonyesha alama tu kwenye simu, orodha ya notifications inatoshea skrini.
- Majedwali yanasogezwa pembeni ndani ya ukurasa badala ya kuvunja muundo; fomu zina herufi 16px (iOS isizoome); `h-dvh` na `viewport-fit=cover` kwa vivinjari vya simu.

## Uthibitishaji
`tsc -b` safi, `vite build` imefanikiwa, majaribio yote (69) yanapita. Sikujaribu kwenye simu halisi.

## Baada ya kufungua ZIP
`npm install`, kisha `npx convex dev` (backend ina mabadiliko), kisha hard refresh.
