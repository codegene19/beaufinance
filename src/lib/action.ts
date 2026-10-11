import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser } from './auth/session';
import { cookies } from 'next/headers';
import { withTenant, type Tx } from './db/tenant';
import { withUser } from './db/tenant';
import { listMemberships, requireWriter } from './services/business';
import { AppError, toUserMessage, type ActionResult } from './errors';
import { BUSINESS_COOKIE } from './app-context';

/**
 * Server-action wrapper: authenticates, validates input with Zod on the server, enforces the
 * user's role, runs everything in ONE database transaction (all-or-nothing), and returns a
 * serialisable result with readable errors.
 */
export async function runAction<S extends z.ZodTypeAny, R>(
  schema: S | null,
  raw: unknown,
  handler: (tx: Tx, input: z.infer<S>) => Promise<R>,
  opts: { revalidate?: string[]; write?: boolean } = {},
): Promise<ActionResult<R>> {
  try {
    const user = await getSessionUser();
    if (!user) throw new AppError('Your session has expired. Please sign in again.', 'unauthenticated');
    let input: any = raw;
    if (schema) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) {
          const k = issue.path.join('.') || '_form';
          (fieldErrors[k] ??= []).push(issue.message);
        }
        const first = parsed.error.issues[0];
        return { ok: false, error: `Please check the form: ${first.path.length ? `${first.path.join(' › ')} — ` : ''}${first.message}`, code: 'validation', fieldErrors };
      }
      input = parsed.data;
    }
    const memberships = await withUser(user.id, (q) => listMemberships(q, user.id));
    const chosen = (await cookies()).get(BUSINESS_COOKIE)?.value;
    const business = memberships.find((m) => m.id === chosen) ?? memberships.find((m) => !m.is_demo) ?? memberships[0];
    if (!business) throw new AppError('Create a business first.', 'forbidden');
    const data = await withTenant({ userId: user.id, businessId: business.id }, async (tx) => {
      if (opts.write !== false) await requireWriter(tx);
      return handler(tx, input);
    });
    for (const p of opts.revalidate ?? ['/']) revalidatePath(p, 'layout');
    const warnings = (data as any)?.warnings;
    return { ok: true, data, warnings: Array.isArray(warnings) && warnings.length ? warnings : undefined };
  } catch (e) {
    const { message, code } = toUserMessage(e);
    return { ok: false, error: message, code };
  }
}
