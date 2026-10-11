import type { Database, Queryable } from './types';

// Keep dates and timestamps as ISO strings and numerics as strings (exact decimals).
const identity = (v: string) => v;
const DATE_OIDS = [1082, 1114, 1184];

export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  const parsers: Record<number, (v: string) => unknown> = { 1700: identity };
  for (const oid of DATE_OIDS) parsers[oid] = identity;
  const pg = new PGlite({ dataDir, parsers });
  await pg.waitReady;
  const wrap = (q: { query: (t: string, p?: any[]) => Promise<{ rows: any[] }> }): Queryable => ({
    async query(text, params) {
      const r = await q.query(text, params as any[]);
      return r.rows;
    },
  });
  return {
    kind: 'pglite',
    query: (text, params) => wrap(pg).query(text, params),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    exec: async (sql) => {
      await pg.exec(sql);
    },
    close: () => pg.close(),
  };
}

export async function createPostgresDatabase(url: string): Promise<Database> {
  const postgres = (await import('postgres')).default;
  const sql = postgres(url, {
    prepare: false, // required for Supabase transaction pooler
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    types: {
      dates: { to: 1184, from: DATE_OIDS, serialize: (x: unknown) => x, parse: identity },
    } as any,
  });
  const wrap = (s: any): Queryable => ({
    async query(text, params) {
      const rows = await s.unsafe(text, (params ?? []) as any[]);
      return Array.from(rows);
    },
  });
  return {
    kind: 'postgres',
    query: (text, params) => wrap(sql).query(text, params),
    transaction: (fn) => sql.begin((tx: any) => fn(wrap(tx))) as any,
    exec: async (text) => {
      await sql.unsafe(text);
    },
    close: () => sql.end(),
  };
}
