# SmartHubPOS — Permission Audit Pack (25 Oct 2026)

## Purpose
This is an inspection pack extracted from `SmartHubPOS(20261025-155854).zip`. It is NOT a production deployment package and does not change the live system.

## Important source/log mismatch
The uploaded project ZIP does not match the later test log pasted in chat:
- In this ZIP, `SYSTEM_ROLES` defines Waiter and Waitress with `sales.view`, `sales.manage`, `sales.print` only.
- In this ZIP, `convex/waiterOrders.ts` checks `sales.view` / `sales.manage` for Selling Point endpoints, rather than separate `waiterOrders.view` / `waiterOrders.manage` permissions.
- The pasted later log reports failures requiring `waiterOrders.view` and `waiterOrders.manage`, and describes Waiter/Waitress as Selling Point-only. That is a different code state.

## Why no automatic patch was applied
Applying a patch to this ZIP would not reliably fix the exact code that generated the latest test log. It could also accidentally alter which modules each business/staff role can access. The independent permissions requirement means `sales.*` and `waiterOrders.*` must be separate keys, and defaults must not silently grant one module because the other was granted.

## Safe next step
Use the exact current working-tree versions of:
- `convex/permissions.ts`
- `convex/access.ts`
- `convex/rolePermissions.test.ts`
- `convex/sellingPoint.test.ts`
- `convex/waiterSwitches.test.ts`
- `convex/waiterOrders.ts`
- `convex/waiterSettings.ts`

Then re-run the failing tests on that same working tree. Do not push or deploy until tests and build pass.

## Verification status
- Archive source files copied for inspection: yes
- Fix implemented: no
- Tests run against this pack: no
- Production/Convex deployment performed: no
