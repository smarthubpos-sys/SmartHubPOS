# SmartHubPOS — Marekebisho ya Reports, Bills na Client Codes

## Yaliyoboreshwa
- Jedwali za reports: maandishi yanaweza kujikunja kwenye mstari mpya, namba na fedha zinakaa kulia, na sehemu ya jedwali inaweza kusogezwa kwenye skrini ndogo.
- Bills: chaguo la karatasi 80mm, 58mm au A4 linahifadhiwa kwenye kifaa kilichotumika.
- Bills: kitufe cha WhatsApp hutengeneza ujumbe wenye mteja, invoice, bidhaa, kiasi kilicholipwa na deni. Namba za Tanzania zinazoanza na 0 hubadilishwa kuwa muundo wa 255.
- Client codes: code inaweza kurudiwa kwenye biashara tofauti au branch tofauti; hairuhusiwi kurudiwa ndani ya tenant + branch ileile.

## Mambo ya kufanya kabla ya uzalishaji (production)
- Kutuma reports kwa email kunahitaji kuchagua provider ya email na kuweka siri yake (kwa mfano Resend API key) kwenye mazingira salama ya Convex. ZIP hii haipaswi kudai kutuma email moja kwa moja bila credential hiyo.
- Tenant isolation lazima ithibitishwe kwa kuendesha tests na kukagua queries/mutations zote kwenye Convex; mabadiliko ya client-code pekee si uthibitisho wa usalama wa data zote za biashara.
- Printer halisi, WhatsApp, Convex deployment na build hazijathibitishwa kwenye mazingira haya kwa sababu dependencies hazikuweza kusakinishwa kikamilifu.
