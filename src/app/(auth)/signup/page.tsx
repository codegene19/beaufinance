import { redirect } from 'next/navigation';
import { AuthForm } from '../auth-form';
import { signUpAction } from '@/app/actions/auth';
import { getSessionUser } from '@/lib/auth/session';
import { authProvider } from '@/lib/auth/config';

export const metadata = { title: 'Create account' };

export default async function SignupPage() {
  if (await getSessionUser()) redirect('/');
  return (
    <>
      <h2 className="font-display text-3xl font-semibold">Create your account</h2>
      <p className="mb-6 mt-1 text-sm text-muted">Your data is private to your business.</p>
      <AuthForm mode="signup" action={signUpAction} provider={authProvider()} />
    </>
  );
}
