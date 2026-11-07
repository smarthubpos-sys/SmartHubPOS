# SmartHubPOS — Marekebisho ya permission separation

Patch hii inarekebisha hitilafu iliyoonekana kwenye `convex/rolePermissions.test.ts` baada ya kutumia Combined Selling Point Patch.

## Mafaili
- `convex/permissions.ts`: Cashier anapata ruhusa za Sales ya kawaida pekee; Waiter/Waitress wanapata `waiterOrders.*` pekee; Manager bado anaweza kutumia mifumo yote miwili.
- `convex/rolePermissions.test.ts`: tests zimebadilishwa kuthibitisha kutenganishwa huku na kuzuia waiter kuingia kwenye normal Sales bila `sales.view`.

## Kutumia
1. Tengeneza backup ya mafaili haya mawili.
2. Nakili mafaili kutoka ZIP kwenda kwenye paths zilezile kwenye project.
3. Endesha `npx tsc -b`, `npm run lint`, na `npm run test`.
4. Usipeleke production mpaka tests zote zipite.

Patch hii ni marekebisho ya permissions na tests pekee. Haibadilishi data ya production wala haifanyi deployment.
