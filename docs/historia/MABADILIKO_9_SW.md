# Mabadiliko 9 — Reports, Bills/Invoices na Data za Branch

## Yaliyofanyiwa marekebisho
- Jedwali za ripoti sasa zinapanga namba upande wa kulia, maandishi upande wa kushoto, na kuruhusu maandishi marefu kuvunjika ili yasipishane. Jedwali linaweza kusogezwa mlalo kwenye skrini ndogo.
- Bill inaweza kuchapishwa kwa mpangilio wa 80mm, 58mm au A4. Chaguo la karatasi linahifadhiwa kwenye kifaa na hutumika wakati wa kuchapisha.
- Bill ina kitufe cha kufungua WhatsApp na kuandaa ujumbe wenye jina la mteja, invoice, bidhaa, jumla, kiasi kilicholipwa na deni. Mtumiaji anakagua na kutuma mwenyewe.
- Namba ya code ya mteja inaweza kutumika tena kwenye biashara/branch nyingine; ukaguzi wa code unafanywa ndani ya tenant na branch husika badala ya kuzuia code hiyo kimataifa.

## Kumbuka kuhusu kutuma ripoti kwa email
Kutuma ripoti kiotomatiki kwa ratiba na orodha ya wapokeaji kunahitaji huduma ya kutuma email upande wa server (mfano SMTP au email API), credentials salama na mipangilio ya ratiba. ZIP hii haina email provider/credentials zilizowekwa, kwa hiyo feature hiyo haijawezeshwa kwa kujifanya kuwa inatuma email. Inahitaji kuunganishwa na provider na kuweka secrets kwenye mazingira ya deployment.

## Ukaguzi
Build haikuweza kuthibitishwa katika mazingira haya kwa sababu `npm ci` ilikatika kwa timeout na ikaacha baadhi ya type definitions hazipo (`@types/node`, `@types/react` na nyingine). Hii ni hali ya dependencies za mazingira, si uthibitisho kuwa build imefaulu.
