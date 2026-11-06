# MABADILIKO 50 - Today Sales inahesabu mauzo yanapoingizwa na muhudumu

Kabla: kadi ya Today Sales ilihesabu bili ya muhudumu tu baada ya cashier kupokea pesa.
Sasa: bili ikitumwa/ikichapishwa na muhudumu (Send / Print) inahesabiwa kuwa mauzo ya siku hiyo papo hapo, ilipwe au isilipwe.

1. Today Sales na grafu ya mauzo (dashboard) - bili zenye hali pending / accepted / printed zinahesabiwa siku ya bili (saa za Afrika Mashariki). Bili iliyofutwa (cancelled) na draft ambayo haijatumwa haihesabiwi.
2. Kadi "Oda za wahudumu zisizolipwa" haijabadilika: inabaki na deni; muhudumu akilipa, deni linapungua. Kadi ya Today Sales haibadiliki wakati wa kulipa.
3. Cash Received bado ni pesa iliyopokelewa kweli tu.
4. Bidhaa zinazoongoza (Top products) zinahesabu bili wakati zinapoingizwa.
5. Bili ikihaririwa tarehe (Edit), mauzo yanahamia tarehe mpya; ikifutwa, yanaondoka.
6. Schema: index mpya `by_tenant_created` kwenye waiterOrders (hakuna index inayofutwa).

Faili: convex/dashboard.ts, convex/stats.ts, convex/schema.ts, convex/dashboardLive.test.ts
Test: 596 zinapita, tsc inapita.
Convex deploy inahitajika (npx convex deploy), kisha push GitHub kwa Vercel.
Hazijabadilishwa: ripoti za Daily/Monthly (tayari zinaonyesha madeni ya wahudumu), na "Leo" ya Business Picker ya Super Admin (inasoma roll-up ya zamani).
