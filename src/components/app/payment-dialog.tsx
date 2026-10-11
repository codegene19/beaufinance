'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { formatISO } from 'date-fns';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Checkbox } from '@/components/ui/input';
import { Field, useActionSubmit, newKey } from '@/components/app/form';
import type { ActionResult } from '@/lib/errors';

/** Records a (partial) payment. A fresh idempotency key per dialog prevents double submissions. */
export function PaymentDialog({
  title, currency, baseCurrency, outstanding, defaultRate, action, showDeposit, label = 'Record payment', variant = 'primary',
}: {
  title: string; currency: string; baseCurrency: string; outstanding: string; defaultRate: string | null; action: (v: any) => Promise<ActionResult<unknown>>; showDeposit?: boolean; label?: string; variant?: 'primary' | 'secondary';
}) {
  const [open, setOpen] = React.useState(false);
  const defaults = () => ({ payment_date: formatISO(new Date(), { representation: 'date' }), amount: outstanding, fx_rate: currency === baseCurrency ? '1' : (defaultRate ?? ''), is_deposit: false, method: 'bank_transfer', reference: '', idempotency_key: newKey() });
  const form = useForm<any>({ defaultValues: defaults() });
  const { submit, pending } = useActionSubmit(form, action, { success: 'Payment recorded', onSuccess: () => { setOpen(false); form.reset(defaults()); } });
  const r = form.register;
  const e = (n: string) => (form.formState.errors as any)[n]?.message;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) form.reset(defaults()); }} title={title} description={`Outstanding: ${outstanding} ${currency}. Partial payments are allowed.`} trigger={<Button size="sm" variant={variant}><Plus /> {label}</Button>}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
        <Field label="Payment date" error={e('payment_date')}><Input type="date" {...r('payment_date')} /></Field>
        <Field label={`Amount (${currency})`} error={e('amount')}><Input inputMode="decimal" {...r('amount')} /></Field>
        {currency !== baseCurrency && (
          <Field label={`Actual rate (1 ${currency} = ? ${baseCurrency})`} error={e('fx_rate')} hint="The rate your bank actually applied" className="sm:col-span-2"><Input inputMode="decimal" {...r('fx_rate')} /></Field>
        )}
        <Field label="Method"><Input {...r('method')} /></Field>
        <Field label="Reference"><Input {...r('reference')} placeholder="Bank ref, invoice no." /></Field>
        {showDeposit && <Checkbox {...r('is_deposit')} label="This is the supplier deposit" className="sm:col-span-2" />}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Record payment'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
