# Mabadiliko (awamu ya sita)

## 1. Edit Business (Super Admin)
- Kwenye **Chagua biashara** kuna kitufe cha penseli kila kadi ya biashara (na kitufe cha **Hariri** kwenye `/super-admin`).
- Unaweza kubadilisha jina, code, sarafu, na **huduma za sidebar alizolipia** (Basic / Standard / Full au tiki mojamoja).
- Msimbo: `convex/tenants.ts` (`getEditable`, `update`), `src/pages/super-admin/EditBusinessPanel.tsx`.

## 2. Huduma kwa kila biashara + menyu kwa kila mtumiaji
- Biashara: `tenants.modules` (haipo = zote). Mtumiaji: `users.menuAccess` (haipo = zote za biashara) na `users.ownDataOnly`.
- Maintenance > User Settings > Add/Modify User: chagua sidebar anazoona, na tiki **"Aone mauzo na bili zake tu"**.
- Mhudumu mwenye `ownDataOnly` anaona **dashboard yake binafsi** (`StaffDashboard.tsx`) na mauzo/bili zake tu (imewekwa kwenye backend: `sales.ts`, `customerBills.ts`, `dashboard.getMyDashboard`).
- Kuficha menyu kunazuiwa pia kwenye seva: `requireActiveUser(ctx, "payroll")` n.k. (`access.ts`). Funguo za huduma ziko `convex/permissions.ts` (`MODULES`).

## 3. Dashboard nyepesi
- Dashboard haisomi tena invoice/purchase/bidhaa zote. Inasoma namba chache zilizokokotolewa tayari: `statsTotals` na `statsDaily` (`convex/stats.ts`).
- Madeni (receivable/payable) na mauzo ya kila siku yanasasishwa papo hapo na `sales.ts` / `purchasing.ts` (`bumpStats`).
- Hali ya stoo na bidhaa zinazouzwa zaidi zinasasishwa nyuma ya pazia (kila dakika ~2 inapofunguliwa).
- Biashara ambayo haina takwimu bado: hesabu ya kwanza inafanyika kiotomatiki (sekunde chache). Kila usiku saa 7:00 EAT (`convex/crons.ts`) hesabu kamili inarudiwa kwa biashara zilizotumika siku 3 zilizopita kurekebisha tofauti yoyote.
- Kitufe cha **Hesabu upya dashboard** kwenye paneli ya Hariri biashara kinaweza kutumika ukiona namba isiyo sahihi.

## Kabla ya kutumia
1. `npm install`, kisha `npx convex dev` (au `npx convex deploy`) ili schema mpya, `crons.ts` na `_generated` zisasishwe.
2. `npm run build`, `npm run lint`, `npm test` (kuna majaribio mapya: `convex/access-modules.test.ts`).
3. Jaribu kwenye deployment ya majaribio kwanza.
