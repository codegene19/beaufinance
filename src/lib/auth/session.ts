import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { createServerClient } from '@supabase/ssr';
import { authProvider, localSecret, supabaseConfig } from './config';
import { hashPassword, verifyPassword } from './password';
import { getDb } from '../db';

export interface SessionUser {
  id: string;
  email: string;
}

const LOCAL_COOKIE = 'bf_session';

export async function supabaseServer() {
  const store = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component: the proxy refreshes the session instead
        }
      },
    },
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (authProvider() === 'supabase') {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? '' } : null;
  }
  const token = (await cookies()).get(LOCAL_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, localSecret());
    if (!payload.sub) return null;
    // make sure the user still exists
    const db = await getDb();
    const [u] = await db.query<{ id: string; email: string }>('select id, email from auth.users where id = $1', [payload.sub]);
    return u ?? null;
  } catch {
    return null;
  }
}

async function setLocalSession(user: SessionUser) {
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(localSecret());
  (await cookies()).set(LOCAL_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 });
}

export async function signUp(email: string, password: string): Promise<{ error?: string; needsConfirmation?: boolean }> {
  email = email.trim().toLowerCase();
  if (authProvider() === 'supabase') {
    const sb = await supabaseServer();
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
    const { data, error } = await sb.auth.signUp({ email, password, options: site ? { emailRedirectTo: `${site}/auth/callback` } : undefined });
    if (error) return { error: error.message };
    return { needsConfirmation: !data.session };
  }
  const db = await getDb();
  const exists = await db.query('select 1 from auth.users where email = $1', [email]);
  if (exists.length) return { error: 'An account with this email already exists. Sign in instead.' };
  const [u] = await db.query<{ id: string }>('insert into auth.users (email, encrypted_password) values ($1, $2) returning id', [email, await hashPassword(password)]);
  await setLocalSession({ id: u.id, email });
  return {};
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  email = email.trim().toLowerCase();
  if (authProvider() === 'supabase') {
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? { error: 'Incorrect email or password.' } : {};
  }
  const db = await getDb();
  const [u] = await db.query<{ id: string; encrypted_password: string }>('select id, encrypted_password from auth.users where email = $1', [email]);
  if (!u || !(await verifyPassword(password, u.encrypted_password))) return { error: 'Incorrect email or password.' };
  await setLocalSession({ id: u.id, email });
  return {};
}

export async function signOut() {
  if (authProvider() === 'supabase') {
    const sb = await supabaseServer();
    await sb.auth.signOut();
  }
  const store = await cookies();
  store.delete(LOCAL_COOKIE);
  store.delete('bf_business');
}
