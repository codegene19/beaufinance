# Backup & recovery

## Production (Supabase)
- **Automatic:** Supabase keeps daily backups (7 days on Pro); enable **Point-in-Time Recovery** for minute-level restore. Restore from the dashboard (Database → Backups).
- **Your own copy:** with PostgreSQL client tools installed:
  ```bash
  DATABASE_URL="postgresql://…:5432/postgres" npm run db:backup
  ```
  (use the *session* or direct connection string for pg_dump). Produces `backups/beaufinance-<timestamp>.dump`.
- **Restore** into a fresh project: apply `supabase/migrations/*`, then `pg_restore --data-only --no-owner --dbname "$DATABASE_URL" backups/<file>.dump` (or `--clean` to replace the public schema).
- Store copies off-site (encrypted drive / bucket). Test a restore at least quarterly.

## Local (embedded database)
- Stop `npm run dev` (the embedded database is single-process), then `npm run db:backup`. It writes a restorable data-directory archive (`.tar.gz`) and a portable JSON export of every table.
- Restore: `npm run db:backup -- --restore backups/beaufinance-pglite-<timestamp>.tar.gz` (the current data directory is kept as `*.before-restore-*`).

## Exports
Every report can be downloaded as CSV or Excel (Reports, or Settings › Data & backup) — useful for your accountant and as human-readable archives.

## Integrity
- All financial writes are transactional; payments/receipts/returns are idempotent.
- `audit_logs` records every insert/update/delete with user and before/after values (Settings › Audit log).
