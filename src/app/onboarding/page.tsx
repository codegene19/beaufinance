import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { OnboardingForm } from './onboarding-form';

export const metadata = { title: 'Set up your business' };

export default async function Onboarding() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-champagne-700">Step 1 of 1</div>
        <h1 className="font-display text-4xl font-semibold">Set up your business</h1>
        <p className="mb-6 mt-2 text-sm text-muted">We pre-configure France as your market, EUR reporting, MAD supplier costs and placeholder VAT and exchange rates. Review them in Settings — nothing is assumed to be tax-compliant.</p>
        <OnboardingForm />
      </div>
    </div>
  );
}
