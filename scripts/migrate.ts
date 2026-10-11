/**
 * Applies database migrations.
 *   npm run db:migrate                 # embedded PGlite (local dev) or DATABASE_URL
 *   npm run db:migrate -- --local-auth # self-hosted Postgres WITHOUT Supabase: also installs the auth shim
 * On Supabase prefer `supabase db push` (or paste supabase/migrations/*.sql into the SQL editor);
 * running this script against Supabase is also safe (it never installs the shim there).
 */
import './env';
import { createPgliteDatabase, createPostgresDatabase } from '../src/lib/db/drivers';
import { runMigrations } from '../src/lib/db/migrate';

const url = process.env.DATABASE_URL;
const db = url ? await createPostgresDatabase(url) : await createPgliteDatabase(process.env.PGLITE_DATA_DIR ?? './.data/pglite');
const shim = !url || process.argv.includes('--local-auth');
await runMigrations(db, { includeLocalShim: shim, log: console.log });
console.log(`Migrations complete (${url ? 'PostgreSQL' : 'embedded PGlite'}${shim ? ', with local auth shim' : ''}).`);
await db.close();
