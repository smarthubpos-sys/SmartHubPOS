# Mabadiliko 42 — Kila biashara ijitegemee na ruhusa zake (roles) + Audit

## 1. Roles sasa ni za kila biashara
- Zamani jedwali la `roles` halikuwa na `tenantId`: kubadilisha "Manager"/"Cashier" kwenye biashara moja kulibadilisha biashara zote.
- Sasa kila role ina `tenantId`. `saveRole`/`deleteRole`/`listRoles` zinafanya kazi kwa biashara ya mtumiaji (Super Admin lazima achague biashara kwanza).
- Roles za zamani (zisizo na tenantId) zinatumika tu kama mwanzo hadi biashara ihifadhi nakala yake; nakala inatengenezwa yenyewe mtu anapohifadhi/kufuta role.
- Biashara mpya hairithi chochote: inaanza na defaults za mfumo.

## 2. Hatua ya mara moja baada ya deploy
    npx convex deploy
    npx convex run maintenance:splitRolesPerBusiness
Inagawa roles za zamani kwa kila biashara (ruhusa za sasa hazibadiliki) kisha inaondoa safu za pamoja.

## 3. Modules mpya zinawafikia watumiaji
Super Admin akiwasha module kwenye Edit Business, watumiaji wenye orodha yao ya menyu (`menuAccess`) wanaipata sasa. Zilizozimwa zinaondolewa kama kawaida.

## 4. Audit Trail
Super Admin anaona rekodi za biashara aliyochagua (au kichujio cha "Biashara"), kila rekodi ina jina la biashara. Biashara tulivu hazifichwi tena.

## Faili zilizobadilika
convex/schema.ts, convex/access.ts, convex/maintenance.ts, convex/tenants.ts, convex/auditFixes.test.ts, src/pages/maintenance/DataPages.tsx

## Bado haijaendeshwa (hakuna node_modules hapa)
npm run lint ; tsc -b ; npm test  — endesha kabla ya deploy.

## 5. Orodha ya biashara (Super Admin) inaonyesha mauzo ya leo
Kila kadi ya biashara sasa ina: "Leo: <jumla> TZS · Invoice <idadi>" na "Mauzo ya mwisho: <tarehe>".
Biashara ambayo namba za dashboard hazijahesabiwa inaonyesha onyo la njano "Namba za dashboard hazijahesabiwa":
ingia kwenye biashara hiyo, bonyeza "Hesabu upya dashboard" (Edit Business). Ikiwa "Mauzo ya mwisho" ni ya leo lakini Leo ni 0, namba zimechelewa — hesabu upya.
Faili: convex/tenants.ts, src/pages/super-admin/BusinessPicker.tsx
