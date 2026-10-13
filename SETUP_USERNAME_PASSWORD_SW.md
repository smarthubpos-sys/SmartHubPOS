# SmartHubPOS — Usanidi wa username na password

> Tumia deployment ya majaribio kwanza. Usitumie taarifa halisi za kifedha hadi build, tests, schema na ruhusa vikaguliwe.

## 1. Sasisha mafaili
- Hifadhi nakala ya mradi wa sasa.
- Extract ZIP hii na tumia faili mpya za mradi.
- Fungua `.env.local` na ondoa mistari ya `VITE_OIDC_*` ikiwa ipo.
- Hakikisha `VITE_CONVEX_URL` itakuwa URL halisi ya deployment, si `YOUR-DEPLOYMENT`.

## 2. Sakinisha dependencies
PowerShell ndani ya folder lenye `package.json`:
```powershell
npm install
```

## 3. Unganisha Convex
```powershell
npx convex dev
```
Fuata maelekezo ya kuchagua deployment. Sasa usanidi hauhitaji `OIDC_AUTHORITY` au `OIDC_CLIENT_ID`.
Acha mchakato uendelee na uangalie kama Convex inasawazisha schema/functions na inaonyesha URL halisi ya deployment. Hakikisha `VITE_CONVEX_URL` kwenye `.env.local` inalingana na URL hiyo.

## 4. Sanidi username ya akaunti ya kwanza ya Super Admin
Fungua PowerShell ya pili kwenye folder hilo hilo, kisha endesha amri hii ukibadilisha `admin` kuwa username unayotaka:
```powershell
npx convex env set SUPER_ADMIN_USERNAME admin
```
Usitumie nafasi kwenye username; inaruhusiwa herufi ndogo, namba, nukta, underscore na hyphen (herufi 3–32).

## 5. Fungua mfumo
Kwenye PowerShell nyingine:
```powershell
npm run dev
```
Fungua anwani ya localhost itakayoonyeshwa. Kwenye login page chagua **“Sanidi akaunti ya kwanza ya msimamizi”**, tumia username ile ile uliyoweka kwenye `SUPER_ADMIN_USERNAME`, na nenosiri lenye angalau herufi 10.

## Muhimu
- Usajili wa kwanza umefungwa kwa username iliyowekwa kwenye `SUPER_ADMIN_USERNAME`.
- Usanidi wa awali huu bado haujumuishi mtiririko wa kuunda akaunti za wafanyakazi wengine kupitia UI; hilo linahitaji sehemu salama ya user management.
- Hifadhi `.env.local` na credentials za deployment kwa siri.
- Baada ya usanidi, endesha `npm run build`, `npm run lint`, na `npm test`, kisha tuma matokeo kama kuna makosa.
