'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { Field } from '@/components/app/form';
import { createBusinessAction } from '@/app/actions/auth';

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [currency, setCurrency] = React.useState('EUR');
  const [demo, setDemo] = React.useState(false);
  const [pending, start] = React.useTransition();
  return (
    <Card className="p-6">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createBusinessAction({ name, base_currency: currency, with_demo: demo });
            if (!r.ok) toast.error(r.error);
            else {
              toast.success('Business created');
              router.push('/');
              router.refresh();
            }
          });
        }}
      >
        <Field label="Business name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maison Argane" required autoFocus />
        </Field>
        <Field label="Reporting currency" hint="All profit and cash figures are reported in this currency.">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — Pound sterling</option>
            <option value="USD">USD — US dollar</option>
            <option value="MAD">MAD — Moroccan dirham</option>
            <option value="CHF">CHF — Swiss franc</option>
          </Select>
        </Field>
        <Checkbox
          checked={demo}
          onChange={(e) => setDemo(e.target.checked)}
          label="Also create a separate demo business"
          hint="Explore the app with realistic sample data. Demo data lives in its own business and is never mixed with your real figures."
        />
        <Button type="submit" size="lg" className="w-full" disabled={pending || !name.trim()}>
          {pending ? 'Creating…' : 'Create business'}
        </Button>
      </form>
    </Card>
  );
}
