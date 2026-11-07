SmartHubPOS targeted fix: Manager assigning Waiter/Waitress

Replace only:
  convex/maintenance.ts

This fixes the regression where a Manager with maintenance.users could not convert an existing Cashier account to Waiter/Waitress because the target's old Cashier role already carried waiterOrders.view/manage permissions.

No other project files are included. Do not deploy yet. After replacing the file, run:
  npx vitest run convex/userAccessGrant.test.ts
  npm run build
