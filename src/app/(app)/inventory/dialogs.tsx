'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { formatISO } from 'date-fns';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field, useActionSubmit, newKey } from '@/components/app/form';
import { adjustStockAction, openingStockAction } from '@/app/actions/operations';

export function AdjustDialog({ lots }: { lots: { lot_id: string; label: string; on_hand: number }[] }) {
  const [open, setOpen] = React.useState(false);
  const defaults = () => ({ lot_id: lots[0]?.lot_id ?? '', quantity: '', movement_type: 'write_off', reason: '', idempotency_key: newKey() });
  const form = useForm<any>({ defaultValues: defaults() });
  const { submit, pending } = useActionSubmit(form, adjustStockAction, { success: 'Stock adjusted', onSuccess: () => setOpen(false) });
  const r = form.register;
  const e = (n: string) => (form.formState.errors as any)[n]?.message;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) form.reset(defaults()); }} title="Adjust stock" description="Every adjustment is logged with reason, time and user." trigger={<Button variant="secondary" size="sm" disabled={!lots.length}>Adjust stock</Button>}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4">
        <Field label="Lot"><Select {...r('lot_id')}>{lots.map((l) => <option key={l.lot_id} value={l.lot_id}>{l.label} — {l.on_hand} on hand</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select {...r('movement_type')}><option value="write_off">Write-off (damaged / expired / lost)</option><option value="adjustment">Count correction (+/−)</option></Select></Field>
          <Field label="Quantity" error={e('quantity')} hint="Write-offs reduce stock. Corrections: use − to reduce."><Input type="number" {...r('quantity')} /></Field>
        </div>
        <Field label="Reason" error={e('reason')}><Input {...r('reason')} placeholder="Broken bottles found during stock count" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>{pending ? 'Saving…' : 'Record adjustment'}</Button></div>
      </form>
    </Dialog>
  );
}

export function OpeningStockDialog({ variants, currency }: { variants: { id: string; label: string }[]; currency: string }) {
  const [open, setOpen] = React.useState(false);
  const defaults = () => ({ variant_id: variants[0]?.id ?? '', quantity: '', unit_cost: '', received_date: formatISO(new Date(), { representation: 'date' }), expiry_date: '', lot_code: '', idempotency_key: newKey() });
  const form = useForm<any>({ defaultValues: defaults() });
  const { submit, pending } = useActionSubmit(form, openingStockAction, { success: 'Opening stock recorded', onSuccess: () => setOpen(false) });
  const r = form.register;
  const e = (n: string) => (form.formState.errors as any)[n]?.message;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) form.reset(defaults()); }} title="Record opening stock" description="For stock you already held before using BeauFinance. Enter its true landed cost per unit." trigger={<Button variant="secondary" size="sm" disabled={!variants.length}>Opening stock</Button>}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
        <Field label="Product" className="sm:col-span-2"><Select {...r('variant_id')}>{variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select></Field>
        <Field label="Quantity" error={e('quantity')}><Input type="number" {...r('quantity')} /></Field>
        <Field label={`Landed cost / unit (${currency})`} error={e('unit_cost')}><Input inputMode="decimal" {...r('unit_cost')} /></Field>
        <Field label="Date"><Input type="date" {...r('received_date')} /></Field>
        <Field label="Expiry date"><Input type="date" {...r('expiry_date')} /></Field>
        <Field label="Lot code" className="sm:col-span-2"><Input {...r('lot_code')} placeholder="auto" /></Field>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>{pending ? 'Saving…' : 'Add to stock'}</Button></div>
      </form>
    </Dialog>
  );
}
