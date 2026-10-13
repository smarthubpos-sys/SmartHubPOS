# SmartHubPOS — Login ya Admin (username/password)

## Credentials za kuanzia
- Username: `smarthubadmin`
- Password: `SmartHub@2026!`

Hizi ni credentials za kuanzisha akaunti mpya tu. Hazimaanishi kuwa akaunti tayari imeundwa kwenye database ya Convex. Convex ni backend ya mtandaoni; ZIP haiwezi kuunda akaunti ndani ya deployment yako bila kusawazisha functions na kukamilisha usajili wa kwanza.

## Hatua za kutumia kwenye Windows
1. Extract ZIP hii kwenye folder jipya.
2. Fungua PowerShell ndani ya `SmartHubPOS_Full`.
3. Hakikisha faili lako la `.env.local` lina `VITE_CONVEX_URL` ya deployment unayotaka kutumia. Kama unatumia project ya zamani, nakili `.env.local` yako kutoka backup/project ya sasa; usiiweke hadharani.
4. Endesha `npm install`.
5. Endesha `Set-ExecutionPolicy -Scope Process Bypass` kisha `.\ANZA_ADMIN.ps1` na thibitisha kwa kuandika `NDIYO`.
6. Endesha `npm run dev`.
7. Kwenye ukurasa wa login, bonyeza `Sanidi akaunti ya kwanza ya msimamizi` mara moja. Fields zimejazwa kwa credentials hapo juu; submit.
8. Baada ya kufungua akaunti, ingia kwa credentials hizo. Badilisha password iwe ya kipekee baada ya kuthibitisha mfumo.

## Muhimu
- Script inabadilisha `SUPER_ADMIN_USERNAME` kwenye Convex deployment iliyochaguliwa na kusawazisha functions. Hakikisha umechagua deployment sahihi.
- Ikiwa deployment tayari ina SmartHubPOS application user profiles, bootstrap salama ya kwanza inaweza kukataa kumpa akaunti mpya role ya Super Admin. Usifute database; utahitaji kurejesha akaunti ya admin kwenye deployment iliyopo.
- ZIP haiwezi kurekebisha password ya akaunti ya `admin` iliyopo kwa sababu password hash iko kwenye database ya Convex, si ndani ya mafaili ya frontend.
- Usitumie credentials hizi za mfano kwenye production bila kubadilisha password.

## Mahitaji
Node.js na npm; akaunti ya Convex iliyoingia kupitia CLI; `.env.local` yenye `VITE_CONVEX_URL` sahihi.
