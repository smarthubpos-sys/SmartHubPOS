# SmartHubPOS — Email za ripoti, footer ya risiti na WhatsApp

## Receipt footer text
- Maandishi yaliyohifadhiwa kwenye `Maintenance > System Setup > Maandishi ya chini ya risiti` sasa yanaonyeshwa chini ya bili iliyochapishwa.
- Bili haitumii tena maandishi ya kudumu; hutumia maandishi ya biashara husika. Ikiwa sehemu imeachwa tupu, footer haitachapishwa.

## Email za reports
- Kwenye `Maintenance > System Setup`, jaza `Email za kupokea ripoti`; unaweza kuweka anwani nyingi kwa kuzitenganisha kwa koma au semicolon.
- Kwenye jedwali la ripoti, bonyeza `Tuma kwa Email` kutuma ripoti hiyo kwa wapokeaji waliowekwa.
- Kwa sababu mfumo unatumia Convex, weka environment variables hizi kwenye Convex deployment:
  - `RESEND_API_KEY` — API key ya Resend.
  - `REPORTS_FROM_EMAIL` — anwani ya mtumaji iliyothibitishwa kwenye Resend, mfano `reports@domain-yako.co.tz`.
- Baada ya variables kuwekwa, deploy Convex functions upya. Bila credentials hizi, mfumo utaonyesha kosa la usanidi badala ya kudai kuwa email imetumwa.
- Ripoti inayotumwa kwa email imewekewa kikomo cha mistari 500 kwa ombi moja.

## WhatsApp ya bili
- Ukiwa umefungua bili, switch `Washa kutuma bili WhatsApp` inaonekana juu ya vitufe vya bili.
- Switch ikiwashwa, kitufe cha `Tuma bill WhatsApp` kinaonekana ikiwa mteja ana namba ya simu; ikizimwa, kitufe kinafichwa.
- Chaguo la switch linahifadhiwa kwenye kifaa/browser husika.

## Usalama wa biashara
- Utafutaji wa wapokeaji wa email unafungwa kwenye tenant ya mtumiaji aliyeingia; mipangilio ya email ya biashara nyingine haitumiki.
- Bill query inaendelea kuangalia ruhusa ya rekodi na scope ya tenant/branch kabla ya kurudisha invoice, mteja na mistari ya bidhaa.
- Kabla ya production, fanya majaribio ya role/tenant isolation kwenye modules zote na hakikisha kila query/mutation inatumia tenantId na branchId husika. Mabadiliko haya peke yake si uthibitisho wa audit kamili wa mfumo mzima.
