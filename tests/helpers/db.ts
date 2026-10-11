import { randomUUID } from 'node:crypto';
import { createPgliteDatabase } from '@/lib/db/drivers';
import { runMigrations } from '@/lib/db/migrate';
import { withTenant, withUser, Tx } from '@/lib/db/tenant';
import { createBusiness } from '@/lib/services/business';

/** Fresh in-memory Postgres with all migrations, installed as the app's database. */
export async function setupTestDb() {
  const db = await createPgliteDatabase();
  await runMigrations(db, { includeLocalShim: true });
  (globalThis as any).__bfDb = Promise.resolve(db);
  return db;
}

export async function createUser(email = `${randomUUID()}@test.local`) {
  const db = await (globalThis as any).__bfDb;
  const [u] = await db.query(`insert into auth.users (email, encrypted_password) values ($1, 'x') returning id`, [email]);
  return u.id as string;
}

export async function createTestBusiness(userId: string, name = 'Test Botanics') {
  return withUser(userId, (q) => createBusiness(q, userId, { name }));
}

export const key = () => randomUUID();
export const as = <T>(userId: string, businessId: string, fn: (tx: Tx) => Promise<T>) => withTenant({ userId, businessId }, fn);
