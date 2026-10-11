'use server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { signIn, signOut, signUp, getSessionUser } from '@/lib/auth/session';
import { withUser } from '@/lib/db/tenant';
import { createBusiness, listMemberships } from '@/lib/services/business';
import { seedDemoBusiness } from '@/lib/services/demo';
import { BUSINESS_COOKIE } from '@/lib/app-context';
import { toUserMessage } from '@/lib/errors';

const creds = z.object({ email: z.email('Enter a valid email'), password: z.string().min(8, 'Use at least 8 characters') });

export async function signInAction(_: unknown, fd: FormData) {
  const p = creds.safeParse({ email: fd.get('email'), password: fd.get('password') });
  if (!p.success) return { error: p.error.issues[0].message };
  const r = await signIn(p.data.email, p.data.password);
  if (r.error) return { error: r.error };
  redirect('/');
}

export async function signUpAction(_: unknown, fd: FormData) {
  const p = creds.safeParse({ email: fd.get('email'), password: fd.get('password') });
  if (!p.success) return { error: p.error.issues[0].message };
  const r = await signUp(p.data.email, p.data.password);
  if (r.error) return { error: r.error };
  if (r.needsConfirmation) return { info: 'Check your inbox to confirm your email, then sign in.' };
  redirect('/onboarding');
}

export async function signOutAction() {
  await signOut();
  redirect('/login');
}

const bizSchema = z.object({ name: z.string().trim().min(1, 'Enter your business name').max(200), base_currency: z.string().regex(/^[A-Z]{3}$/), with_demo: z.boolean() });

export async function createBusinessAction(input: unknown) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const p = bizSchema.safeParse(input);
  if (!p.success) return { ok: false as const, error: p.error.issues[0].message };
  try {
    const id = await withUser(user.id, (q) => createBusiness(q, user.id, { name: p.data.name, baseCurrency: p.data.base_currency }));
    if (p.data.with_demo) await seedDemoBusiness(user.id);
    (await cookies()).set(BUSINESS_COOKIE, id, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
    return { ok: true as const, data: id };
  } catch (e) {
    return { ok: false as const, error: toUserMessage(e).message };
  }
}

export async function createDemoAction() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  try {
    const id = await seedDemoBusiness(user.id);
    (await cookies()).set(BUSINESS_COOKIE, id, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
    return { ok: true as const, data: id };
  } catch (e) {
    return { ok: false as const, error: toUserMessage(e).message };
  }
}

export async function switchBusinessAction(id: string) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const ms = await withUser(user.id, (q) => listMemberships(q, user.id));
  if (!ms.some((m) => m.id === id)) return { ok: false as const, error: 'Business not found' };
  (await cookies()).set(BUSINESS_COOKIE, id, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  return { ok: true as const, data: id };
}
