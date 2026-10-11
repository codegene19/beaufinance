import { redirect } from 'next/navigation';
import { AuthForm } from '../auth-form';
import { signInAction } from '@/app/actions/auth';
import { getSessionUser } from '@/lib/auth/session';
import { authProvider } from '@/lib/auth/config';

export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getSessionUser()) redirect('/');
  return (
    <>
      <h2 className="font-display text-3xl font-semibold">Welcome back</h2>
      <p className="mb-6 mt-1 text-sm text-muted">Sign in to your control centre.</p>
      <AuthForm mode="login" action={signInAction} provider={authProvider()} />
    </>
  );
}
