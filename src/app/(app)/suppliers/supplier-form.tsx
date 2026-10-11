'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supplierSchema } from '@/lib/validation/schemas';
import { saveSupplierAction } from '@/app/actions/catalog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select } from '@/components/ui/input';
import { Field, FormSection, useActionSubmit, err } from '@/components/app/form';

export function SupplierForm({ initial, id, currencies }: { initial?: any; id?: string; currencies: string[] }) {
  const form = useForm<any>({
    resolver: zodResolver(supplierSchema) as any,
    defaultValues: initial ?? { name: '', country: 'MA', contact_name: '', email: '', phone: '', address: '', currency: 'MAD', payment_terms: '', default_deposit_pct: '30', lead_time_days: '', min_order_qty: '', notes: '' },
  });
  const { submit, pending } = useActionSubmit(form, (v) => saveSupplierAction(v, id), { success: 'Supplier saved', redirect: (sid) => `/suppliers/${sid}` });
  const r = form.register;
  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <Card className="px-5">
        <FormSection title="Company">
          <Field label="Company name" required error={err(form, 'name')} className="sm:col-span-2"><Input {...r('name')} /></Field>
          <Field label="Country (ISO code)" error={err(form, 'country')}><Input {...r('country')} maxLength={2} /></Field>
          <Field label="Invoice currency" error={err(form, 'currency')}><Select {...r('currency')}>{currencies.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea {...r('address')} /></Field>
        </FormSection>
        <FormSection title="Contact">
          <Field label="Contact person"><Input {...r('contact_name')} /></Field>
          <Field label="Email" error={err(form, 'email')}><Input type="email" {...r('email')} /></Field>
          <Field label="Phone / WhatsApp"><Input {...r('phone')} /></Field>
        </FormSection>
        <FormSection title="Terms" description="Used to pre-fill purchase orders and the reorder planner.">
          <Field label="Payment terms" className="sm:col-span-2"><Input {...r('payment_terms')} placeholder="30% deposit, balance before shipment" /></Field>
          <Field label="Usual deposit %" error={err(form, 'default_deposit_pct')}><Input inputMode="decimal" {...r('default_deposit_pct')} /></Field>
          <Field label="Usual lead time (days)" error={err(form, 'lead_time_days')}><Input type="number" {...r('lead_time_days')} /></Field>
          <Field label="Minimum order quantity" error={err(form, 'min_order_qty')}><Input type="number" {...r('min_order_qty')} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea {...r('notes')} /></Field>
        </FormSection>
      </Card>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save supplier'}</Button>
      </div>
    </form>
  );
}
