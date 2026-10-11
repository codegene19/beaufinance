import path from 'node:path';
import fs from 'node:fs';
import type { Database } from './types';
import { createPgliteDatabase, createPostgresDatabase } from './drivers';
import { runMigrations } from './migrate';

export type { Database, Queryable, Row } from './types';

const g = globalThis as unknown as { __bfDb?: Promise<Database> };

export function isLocalDatabase() {
  return !process.env.DATABASE_URL;
}

async function init(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    return createPostgresDatabase(process.env.DATABASE_URL);
  }
  const dir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.PGLITE_DATA_DIR ?? './.data/pglite');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const db = await createPgliteDatabase(dir);
  // Embedded database: keep schema current automatically.
  await runMigrations(db, { includeLocalShim: true, log: (m) => console.log(`[db] ${m}`) });
  return db;
}

/** Process-wide database handle (survives Next.js hot reloads). */
export function getDb(): Promise<Database> {
  if (!g.__bfDb) {
    g.__bfDb = init().catch((e) => {
      g.__bfDb = undefined;
      throw e;
    });
  }
  return g.__bfDb;
}
