import { getDb } from './index';
import type { Queryable, Row } from './types';
import { AppError } from '../errors';

/**
 * A transaction bound to one user and one business. Every statement runs as the
 * Postgres `authenticated` role with the user's JWT claims, so row-level security
 * is enforced by the database itself — not only by application code.
 */
export class Tx {
  constructor(
    private readonly q: Queryable,
    public readonly businessId: string,
    public readonly userId: string,
  ) {}

  many<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    return this.q.query<T>(text, params);
  }

  async maybe<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.q.query<T>(text, params);
    return rows[0] ?? null;
  }

  async one<T = Row>(text: string, params: unknown[] = [], notFound = 'Record not found'): Promise<T> {
    const row = await this.maybe<T>(text, params);
    if (!row) throw new AppError(notFound, 'not_found');
    return row;
  }

  async exec(text: string, params: unknown[] = []): Promise<void> {
    await this.q.query(text, params);
  }
}

export async function withUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (q) => {
    await q.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await q.query('set local role authenticated');
    return fn(q);
  });
}

export async function withTenant<T>(ctx: { userId: string; businessId: string }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUser(ctx.userId, async (q) => {
    const [m] = await q.query<{ role: string }>('select role from business_members where business_id = $1 and user_id = $2', [ctx.businessId, ctx.userId]);
    if (!m) throw new AppError('You do not have access to this business.', 'forbidden');
    return fn(new Tx(q, ctx.businessId, ctx.userId));
  });
}
