export type AuthProvider = 'supabase' | 'local';

export function authProvider(): AuthProvider {
  const p = (process.env.AUTH_PROVIDER ?? '').toLowerCase();
  if (p === 'supabase' || p === 'local') return p;
  return process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'supabase' : 'local';
}

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return { url, key };
}

export function localSecret() {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET (32+ chars) is required when AUTH_PROVIDER=local in production');
  return new TextEncoder().encode('dev-only-insecure-secret-change-me-0123456789');
}
