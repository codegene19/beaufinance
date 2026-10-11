import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/auth/session';
import { authProvider } from '@/lib/auth/config';

/** Supabase email confirmation / magic-link landing (PKCE `code` or `token_hash`). */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  if (authProvider() !== 'supabase') return NextResponse.redirect(new URL('/login', url));
  const sb = await supabaseServer();
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  let ok = false;
  if (code) ok = !(await sb.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await sb.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  return NextResponse.redirect(new URL(ok ? '/onboarding' : '/login?error=confirmation', url));
}
