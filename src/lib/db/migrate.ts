import fs from 'node:fs';
import path from 'node:path';
import type { Database } from './types';

const root = () => process.env.APP_ROOT ?? /*turbopackIgnore: true*/ process.cwd();

/**
 * Applies SQL migrations in order, tracking them in public.schema_migrations.
 * Each file runs atomically. `includeLocalShim` installs the Supabase-compatible
 * auth shim (local / self-hosted Postgres only — never on Supabase).
 */
export async function runMigrations(db: Database, opts: { includeLocalShim: boolean; log?: (m: string) => void }) {
  const log = opts.log ?? (() => {});
  await db.exec(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await db.query<{ name: string }>('select name from public.schema_migrations')).map((r) => r.name));
  const files: { name: string; file: string }[] = [];
  if (opts.includeLocalShim) {
    const dir = path.join(root(), 'db/local');
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) files.push({ name: `local/${f}`, file: path.join(dir, f) });
  }
  const migDir = path.join(root(), 'supabase/migrations');
  for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) files.push({ name: f, file: path.join(migDir, f) });

  for (const m of files) {
    if (applied.has(m.name)) continue;
    const sql = fs.readFileSync(m.file, 'utf8');
    try {
      await db.exec(`begin;\n${sql}\n;insert into public.schema_migrations(name) values ('${m.name.replace(/'/g, "''")}');\ncommit;`);
    } catch (e: any) {
      await db.exec('rollback').catch(() => {});
      throw new Error(`Migration ${m.name} failed: ${e.message}`);
    }
    log(`applied ${m.name}`);
  }
}
