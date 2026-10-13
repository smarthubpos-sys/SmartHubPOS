# SmartHubPOS Multi-Office Implementation

## Included in this package
- SmartHub POS logo and a React login page using the visual design supplied in `DISPENSARY_HOSPITAL.zip`.
- Login now uses Convex Auth with username/password; third-party OIDC configuration is not required.
- Convex data model for `tenants`, `branches`, `tenantSettings`; office creation automatically creates four branches.
- Super Admin-only tenant and branch management mutations. The first authenticated user bootstraps as `super_admin`; later users default to `viewer`. Review this bootstrap policy before production and manually promote/disable accounts as required.
- Per-office settings for TRA integration and stock control. TRA integration is a configuration switch only; no TRA API submission/receipt integration is implemented in this package.

## Required setup
1. Copy `.env.example` to `.env.local` and set the real Convex deployment URL. OIDC settings are not used by the username/password login.
2. Configure `VITE_CONVEX_URL` in `.env.local` with the real Convex deployment URL. Set `SUPER_ADMIN_USERNAME` on the Convex deployment before creating the initial administrator.
3. Run `pnpm install`, `npx convex dev` in one terminal, and `pnpm dev` in another.
4. Deploy and run schema migration/backups before using an existing production database.

## Important production hardening
This package introduces tenant and branch tables and management APIs, but legacy sales, stock, purchasing, payroll and accounting functions were originally written before tenant isolation. Before production use, every legacy read/write must be scoped by the authenticated user's `tenantId` and allowed `branchId`; do not treat the new tables alone as complete isolation. A Super Admin bootstrap account should be reviewed immediately after first sign-in. Do not store TRA secrets in client-visible settings; use server-side encrypted secrets.

## Super Admin page
After login, open `/super-admin` to create offices and review branch counts. Creating an office automatically creates Branch 1–4. Only a backend user with role `super_admin` can call these APIs.


## Validation status
A dependency installation/build was not completed in the packaging environment, so run `pnpm install` and `pnpm build` locally before deployment. Tenant/branch management APIs are included, but legacy operational queries and mutations still require tenant/branch scoping and migration before production. The current ZIP is a development integration package, not a production-certified isolated multi-tenant deployment.
