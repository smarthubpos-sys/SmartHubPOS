# MABADILIKO 44 — WAITER BILLS NA PERMISSIONS

1. Bills za wahudumu: sehemu ya Bills inaendelea kuonekana ikiwa waiter orders au waiter/waitress feature husika imewashwa. Selling Point sasa ina link ya moja kwa moja kwenda Bills ili mhudumu afungue, achague oda zake, atengeneze bili, achapishe au atume kwa cashier.
2. User Settings: imeondolewa sehemu ya kugawa ruhusa za kazi moja moja kwa mtumiaji. Ruhusa za View/Add/Edit/Delete/Manage zinadhibitiwa kupitia Role Management. User Settings imebaki na uchaguzi wa sidebar/menu, idara na mipangilio ya akaunti.
3. Sidebar: uchaguzi wa menuAccess sasa unaheshimiwa kwa kila menu item. Sidebar pia inahitaji permission husika kwa Dashboard, Sales, Selling Point, Cashier, Stock, Purchasing, Accounts, Bills, Payroll na HR. `dashboard.view` imeongezwa kwenye Role Management; Manager na Accountant wa mfumo wanapewa default yake.

Tahadhari: ruhusa za moja kwa moja zilizokuwepo kwenye `extraPermissions` za watumiaji wa zamani hazijafutwa ili kuepuka kuwanyang'anya access kimyakimya. Kuanzia sasa ruhusa mpya za kazi zigawiwe kupitia Role Management. Sidebar pekee inadhibitiwa kupitia User Settings.

Uthibitisho: npm ci ilishindwa kukamilika ndani ya muda uliopatikana; `tsc -b` haikuweza kufanya type-check kwa sababu dependencies/types hazikukamilika kusakinishwa. Kwa hiyo build na tests hazijathibitishwa hapa. Hakuna deployment iliyofanyika.
