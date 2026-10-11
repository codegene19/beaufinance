'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/auth/session';
import { withTenant, withUser } from '@/lib/db/tenant';
import { listMemberships, requireWriter } from '@/lib/services/business';
import { groupOrders, importOrder, type ImportRow } from '@/lib/services/import';
import { toUserMessage } from '@/lib/errors';
import { BUSINESS_COOKIE } from '@/lib/app-context';

/** Imports each order in its own transaction: one bad row never corrupts the others; re-running is safe. */
export async function importOrdersAction(rows: ImportRow[]) {
  const user = await getSessionUser();
  if (!user) return { ok: false as const, error: 'Please sign in again.' };
  if (!Array.isArray(rows) || rows.length > 5000) return { ok: false as const, error: 'Provide between 1 and 5000 rows.' };
  const ms = await withUser(user.id, (q) => listMemberships(q, user.id));
  const chosen = (await cookies()).get(BUSINESS_COOKIE)?.value;
  const b = ms.find((m) => m.id === chosen) ?? ms.find((m) => !m.is_demo) ?? ms[0];
  const result = { imported: 0, skipped: 0, errors: [] as { order: string; error: string }[] };
  for (const g of groupOrders(rows)) {
    try {
      const r = await withTenant({ userId: user.id, businessId: b.id }, async (tx) => { await requireWriter(tx); return importOrder(tx, g); });
      result[r]++;
    } catch (e) {
      result.errors.push({ order: g.order_number, error: toUserMessage(e).message });
    }
  }
  revalidatePath('/', 'layout');
  return { ok: true as const, data: result };
}
