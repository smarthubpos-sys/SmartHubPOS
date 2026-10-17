# Backup and recovery (Convex)

**Status: documented, NOT yet tested against your production deployment.** Nothing below has been run on a live deployment from this repository. Do the verification drill at the end on a separate dev deployment before relying on it.

## What Convex provides
- `npx convex export --path <file>.zip` - exports all tables (and file storage with `--include-file-storage`) from the deployment selected by your env/CLI login.
- `npx convex import --replace <file>.zip` - restores a snapshot (destructive for the tables in the snapshot). `--append` adds without replacing.
- Dashboard: Settings -> Backups (automatic/periodic cloud backups and restore). Availability and retention depend on your Convex plan - confirm on the dashboard; this repo cannot confirm it.

## Routine
1. **Before every deploy that changes `convex/schema.ts` or runs a migration:** take a manual export and store it outside the repo (encrypted storage). Never commit exports - they contain customer, sales and payroll data and password hashes.
2. **Schedule:** daily export at close of business, plus the Convex automatic backups if your plan has them.
3. **Retention (suggested, adjust to your policy):** 7 daily, 4 weekly, 12 monthly. Keep at least one copy offsite.
4. Keep `JWT_PRIVATE_KEY` / `JWKS` in your secret manager: a restore without them signs everyone out (they can sign in again with their password).

## Restore
1. Stop writers (tell staff to stop selling) or work on a fresh deployment.
2. Restore into a **new/dev deployment first** and run the checks below.
3. For production: `npx convex import --replace <file>.zip` (or restore from the dashboard), then re-run the checks.
4. Environment variables are not part of the export; re-set `SUPER_ADMIN_USERNAME`, `JWT_PRIVATE_KEY`, `JWKS`, etc.

## Verify a backup (do this monthly)
- The zip opens and lists the expected tables.
- Restore to a dev deployment, sign in, open Store/Ghala: `warehouses.reconcile` must return an empty list (every balance equals its ledger).
- Compare invoice count and total sales for a known date with production.

## Rules for destructive changes
No `clearData`, schema narrowing or migration on production without a fresh export taken and restored successfully elsewhere.
