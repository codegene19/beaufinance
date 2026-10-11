'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { shipmentSchema } from '@/lib/validation/schemas';
import { saveShipmentAction } from '@/app/actions/purchasing';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field, FormSection, useActionSubmit, err } from '@/components/app/form';
import { ALLOCATION_METHODS, SHIPMENT_STATUSES, humanize } from '@/lib/constants';

export function ShipmentForm({ initial, id, nextUrl }: { initial: any; id?: string; nextUrl?: string }) {
  const form = useForm<any>({ resolver: zodResolver(shipmentSchema) as any, defaultValues: initial });
  const { submit, pending } = useActionSubmit(form, (v) => saveShipmentAction(v, id), { success: 'Shipment saved', redirect: (sid) => (id ? null : `/shipments/${sid}${nextUrl ?? ''}`) });
  const r = form.register;
  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <Card className="px-5">
        <FormSection title="Shipment" description="Create it before goods arrive and add costs as invoices come in.">
          <Field label="Reference" required error={err(form, 'reference')}><Input {...r('reference')} placeholder="SHP-AGA-CDG-02" /></Field>
          <Field label="Status"><Select {...r('status')}>{SHIPMENT_STATUSES.filter((s) => s !== 'received' || initial.status === 'received').map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
          <Field label="Carrier / forwarder"><Input {...r('carrier')} /></Field>
          <Field label="Mode"><Select {...r('mode')}><option value="">—</option><option value="air">Air</option><option value="sea">Sea</option><option value="road">Road</option><option value="courier">Courier</option><option value="other">Other</option></Select></Field>
          <Field label="Tracking reference"><Input {...r('tracking_ref')} /></Field>
          <Field label="Default cost allocation" hint="Each cost can override this. Never splits equally unless you choose quantity." error={err(form, 'default_allocation_method')}>
            <Select {...r('default_allocation_method')}>{ALLOCATION_METHODS.filter((m) => m.value !== 'manual').map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select>
          </Field>
        </FormSection>
        <FormSection title="Dates">
          <Field label="Dispatch date"><Input type="date" {...r('dispatch_date')} /></Field>
          <Field label="Expected arrival"><Input type="date" {...r('expected_arrival_date')} /></Field>
          <Field label="Actual arrival"><Input type="date" {...r('actual_arrival_date')} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea {...r('notes')} /></Field>
        </FormSection>
      </Card>
      <div className="mt-4 flex justify-end"><Button type="submit" disabled={pending}>{pending ? 'Saving…' : id ? 'Save shipment' : 'Create shipment'}</Button></div>
    </form>
  );
}
