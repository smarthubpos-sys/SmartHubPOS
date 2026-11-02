# Mabadiliko 43 - Ruhusa za users, idara, invoice (HAIJAKAMILIKA, HAIJAJARIBIWA)

Msingi: commit HEAD 0942fc0 (si working tree ya zip ya zamani). Hakuna test iliyoendeshwa (hakuna node_modules).

## Imefanyika (backend + UI sehemu)
1. Ruhusa: maintenance.users/sales.edit/sales.print zinaweza kutolewa kwa mtumiaji mmoja; query mpya listAssignableRoles;
   UsersPage inaitumia; kinga dhidi ya kutoa ruhusa kubwa kuliko zako / kusimamia mtumiaji mwenye nguvu kuliko wewe; tiles za Maintenance zinafuata ruhusa.
2. Idara: clearData/authorizeClear/clearStepBatch/finishClear sasa zinafuta idara moja tu; ClearDataPage ina chaguo la idara/biashara nzima.
3. Invoice: kaunta moja ya namba kwa biashara; prefix tupu inaruhusiwa; searchInvoices, invoiceFull, editInvoice (sales.ts); schema: revision/lastEditedAt/lastEditedBy.

## Haijafanyika
- UI ya invoice (kutafuta kwenye Reports > Product Sales, dirisha la Print/Edit/Cancel, chaguo la "futa kabisa" au "rekebisha bidhaa/idadi").
- Tests za mambo matatu; npm test, npm run lint, tsc -b hazijaendeshwa.
- Credit limit haikaguliwi wakati wa edit; roles per business hazikuguswa zaidi ya HEAD.
- Tafsiri za English za maandishi mapya.
Usifanye deploy kabla ya kuendesha: npm install; npx convex dev (schema mpya); npm test; npm run lint; tsc -b.
