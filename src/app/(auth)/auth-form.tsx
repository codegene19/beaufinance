'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Callout } from '@/components/ui/misc';

type State = { error?: string; info?: string } | undefined;

export function AuthForm({ mode, action, provider }: { mode: 'login' | 'signup'; action: (s: State, fd: FormData) => Promise<State>; provider: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <Callout tone="danger">{state.error}</Callout>}
      {state?.info && <Callout tone="success">{state.info}</Callout>}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required />
        {mode === 'signup' && <p className="text-xs text-muted">At least 8 characters.</p>}
      </div>
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === 'login' ? (
          <>
            New here? <Link className="font-medium text-sage-700 hover:underline" href="/signup">Create an account</Link>
          </>
        ) : (
          <>
            Already registered? <Link className="font-medium text-sage-700 hover:underline" href="/login">Sign in</Link>
          </>
        )}
      </p>
      <p className="text-center text-[11px] text-muted">Authentication: {provider === 'supabase' ? 'Supabase Auth' : 'local development accounts'}</p>
    </form>
  );
}
