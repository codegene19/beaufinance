/**
 * Backups.
 *   npm run db:backup             # create a backup in ./backups
 *   npm run db:backup -- --restore backups/<file>.tar.gz   # embedded DB only (stop the dev server first)
 *
 * Embedded PGlite: a compressed copy of the whole data directory (restorable) + a JSON export of all tables.
 * PostgreSQL / Supabase: runs `pg_dump` (must be installed) to a custom-format dump; restore with pg_restore.
 */
import './env';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync('backups', { recursive: true });
const url = process.env.DATABASE_URL;

if (url) {
  const out = path.join('backups', `beaufinance-${stamp}.dump`);
  const r = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--schema=public', '--file', out, url], { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.error('pg_dump failed or is not installed. Install PostgreSQL client tools, or use Supabase dashboard backups.');
    process.exit(1);
  }
  console.log(`Backup written to ${out}\nRestore: pg_restore --clean --no-owner --dbname "$DATABASE_URL" ${out}`);
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = process.env.PGLITE_DATA_DIR ?? './.data/pglite';
  const restoreIdx = process.argv.indexOf('--restore');
  if (restoreIdx > 0) {
    const file = process.argv[restoreIdx + 1];
    if (!file || !fs.existsSync(file)) throw new Error('Provide the backup .tar.gz to restore');
    if (fs.existsSync(dataDir)) fs.renameSync(dataDir, `${dataDir}.before-restore-${stamp}`);
    const blob = new Blob([fs.readFileSync(file)]);
    const pg = new PGlite(dataDir, { loadDataDir: blob });
    await pg.waitReady;
    const [{ n }] = (await pg.query<{ n: number }>('select count(*)::int as n from businesses')).rows;
    await pg.close();
    console.log(`Restored ${file} into ${dataDir} (${n} businesses). Previous data kept in ${dataDir}.before-restore-${stamp}`);
  } else {
    const pg = new PGlite(dataDir);
    await pg.waitReady;
    const dump = await pg.dumpDataDir('gzip');
    const tar = path.join('backups', `beaufinance-pglite-${stamp}.tar.gz`);
    fs.writeFileSync(tar, Buffer.from(await dump.arrayBuffer()));
    const tables = (await pg.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.tablename);
    const json: Record<string, unknown[]> = {};
    for (const t of tables) json[t] = (await pg.query(`select * from "${t}"`)).rows;
    const jf = path.join('backups', `beaufinance-export-${stamp}.json`);
    fs.writeFileSync(jf, JSON.stringify(json, null, 1));
    await pg.close();
    console.log(`Backup written:\n  ${tar} (restorable: npm run db:backup -- --restore ${tar})\n  ${jf} (portable JSON export of ${tables.length} tables)`);
  }
}
