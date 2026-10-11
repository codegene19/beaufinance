import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { AppError } from './errors';
import { getSessionUser } from './auth/session';
import { withTenant, withUser, type Tx } from './db/tenant';
import { listMemberships, getSettings, type BusinessSettings } from './services/business';

export const BUSINESS_COOKIE = 'bf_business';

export const getAppContext = cache(async () => {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const memberships = await withUser(user.id, (q) => listMemberships(q, user.id));
  if (memberships.length === 0) redirect('/onboarding');
  const chosen = (await cookies()).get(BUSINESS_COOKIE)?.value;
  const business = memberships.find((m) => m.id === chosen) ?? memberships.find((m) => !m.is_demo) ?? memberships[0];
  const settings = await withTenant({ userId: user.id, businessId: business.id }, (tx) => getSettings(tx));
  return { user, memberships, business, role: business.role as 'owner' | 'manager' | 'viewer', settings: settings as BusinessSettings };
});

/** Run a read in the current user's business (RLS-enforced). */
export async function tenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ctx = await getAppContext();
  try {
    return await withTenant({ userId: ctx.user.id, businessId: ctx.business.id }, fn);
  } catch (e: any) {
    // Missing records and malformed ids in URLs render the 404 page instead of a server error
    if ((e instanceof AppError && e.code === 'not_found') || e?.code === '22P02') notFound();
    throw e;
  }
}
