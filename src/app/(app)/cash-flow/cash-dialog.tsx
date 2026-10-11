'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { formatISO } from 'date-fns';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field, useActionSubmit } from '@/components/app/form';
import { addCashAction } from '@/app/actions/operations';
import { CASH_CATEGORIES } from '@/lib/constants';

const MANUAL = ['opening_balance', 'owner_contribution', 'owner_withdrawal', 'loan_in', 'loan_repayment', 'tax_payment', 'tax_refund', 'other_in', 'other_out'];

export function CashDialog({ currency, currencies, rates, defaultCategory = 'owner_contribution', label = 'Record cash movement' }: { currency: string; currencies: string[]; rates: Record<string, string>; defaultCategory?: string; label?: string }) {
  const [open, setOpen] = React.useState(false);
  const defaults = () => ({ txn_date: formatISO(new Date(), { representation: 'date' }), category: defaultCategory, amount: '', currency, fx_rate: '1', account: 'bank', description: '' });
  const form = useForm<any>({ defaultValues: defaults() });
  const { submit, pending } = useActionSubmit(form, addCashAction, { success: 'Cash movement recorded', onSuccess: () => setOpen(false) });
  const r = form.register;
  const cur = form.watch('currency');
  const e = (n: string) => (form.formState.errors as any)[n]?.message;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) form.reset(defaults()); }} title={label} description="Owner contributions and withdrawals are kept separate from sales and expenses. Customer, supplier and expense payments are recorded on their own records." trigger={<Button size="sm"><Plus /> {label}</Button>}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" className="sm:col-span-2"><Select {...r('category')}>{CASH_CATEGORIES.filter((c) => MANUAL.includes(c.value)).map((c) => <option key={c.value} value={c.value}>{c.label} ({c.direction === 'in' ? 'in' : 'out'})</option>)}</Select></Field>
        <Field label="Date"><Input type="date" {...r('txn_date')} /></Field>
        <Field label="Amount" error={e('amount')}><Input inputMode="decimal" {...r('amount')} /></Field>
        <Field label="Currency"><Select {...r('currency', { onChange: (ev) => form.setValue('fx_rate', ev.target.value === currency ? '1' : rates[ev.target.value] ?? '') })}>{currencies.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        {cur !== currency && <Field label={`Rate → ${currency}`} error={e('fx_rate')}><Input inputMode="decimal" {...r('fx_rate')} /></Field>}
        <Field label="Account"><Input {...r('account')} placeholder="bank, cash, PayPal…" /></Field>
        <Field label="Description" className="sm:col-span-2"><Input {...r('description')} /></Field>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button></div>
      </form>
    </Dialog>
  );
}
