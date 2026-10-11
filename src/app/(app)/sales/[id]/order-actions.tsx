'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { formatISO } from 'date-fns';
import { Truck, CheckCircle2, XCircle, Undo2, CircleDollarSign, Ban } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { Field, useActionSubmit, newKey } from '@/components/app/form';
import { transitionOrderAction, orderPaymentAction, createReturnAction } from '@/app/actions/operations';

const today = () => formatISO(new Date(), { representation: 'date' });

function TransitionDialog({ orderId, to, title, description, icon, variant = 'primary', extra, allowNegative }: { orderId: string; to: string; title: string; description: string; icon: React.ReactNode; variant?: 'primary' | 'secondary' | 'danger'; extra?: 'ship' | 'deliver' | 'cancel_shipped'; allowNegative?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const form = useForm<any>({ defaultValues: { to, date: today(), tracking_ref: '', restock: true, collect_payment: true, allow_negative_stock: false } });
  const { submit, pending } = useActionSubmit(form, (v) => transitionOrderAction(orderId, v), { success: 'Order updated', onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen} title={title} description={description} trigger={<Button size="sm" variant={variant}>{icon} {title}</Button>}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <Field label="Date"><Input type="date" {...form.register('date')} /></Field>
        {extra === 'ship' && <Field label="Tracking reference"><Input {...form.register('tracking_ref')} /></Field>}
        {extra === 'deliver' && <Checkbox {...form.register('collect_payment')} label="Record the outstanding balance as collected" hint="Use for cash-on-delivery or pay-on-receipt orders." />}
        {extra === 'cancel_shipped' && <Checkbox {...form.register('restock')} label="Parcel came back — return units to stock" hint="Untick if the goods were lost; their cost stays as a loss." />}
        {allowNegative && to === 'confirmed' && <Checkbox {...form.register('allow_negative_stock')} label="Allow negative stock (exception)" />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Back</Button><Button variant={variant === 'danger' ? 'danger' : 'primary'} disabled={pending}>{pending ? 'Saving…' : 'Confirm'}</Button></div>
      </form>
    </Dialog>
  );
}

export function OrderActions({ order, items, allowNegative }: { order: any; items: any[]; allowNegative: boolean }) {
  const s = order.status;
  const due = (Number(order.total_incl_tax) - Number(order.paid)).toFixed(2);
  const refundable = (Number(order.paid) - Number(order.refunded)).toFixed(2);
  return (
    <div className="flex flex-wrap gap-2">
      {s === 'pending' && <TransitionDialog orderId={order.id} to="confirmed" title="Confirm" description="Reserves stock lot by lot (FIFO/FEFO)." icon={<CheckCircle2 />} allowNegative={allowNegative} />}
      {(s === 'confirmed' || s === 'processing') && <TransitionDialog orderId={order.id} to="shipped" title="Mark shipped" description="Reserved units leave stock now." icon={<Truck />} extra="ship" />}
      {s === 'shipped' && <TransitionDialog orderId={order.id} to="delivered" title="Mark delivered" description="Revenue is recognised on delivery (default rule)." icon={<CheckCircle2 />} extra="deliver" />}
      {['pending', 'confirmed', 'processing'].includes(s) && <TransitionDialog orderId={order.id} to="cancelled" title="Cancel order" description="Releases reserved stock. No revenue is recorded." icon={<XCircle />} variant="danger" />}
      {s === 'shipped' && <TransitionDialog orderId={order.id} to="cancelled" title="Undelivered / refused" description="For parcels refused or never delivered (e.g. COD). No revenue is recognised; shipping costs remain a loss." icon={<Ban />} variant="danger" extra="cancel_shipped" />}
      {Number(due) > 0 && s !== 'cancelled' && <PaymentDialog orderId={order.id} kind="payment" max={due} currency={order.currency} method={order.payment_method} />}
      {Number(refundable) > 0 && <PaymentDialog orderId={order.id} kind="refund" max={refundable} currency={order.currency} method={order.payment_method} />}
      {['shipped', 'delivered', 'returned'].includes(s) && items.some((i) => i.shipped_qty > i.returned_qty) && <ReturnDialog orderId={order.id} items={items} currency={order.currency} refundable={refundable} />}
    </div>
  );
}

function PaymentDialog({ orderId, kind, max, currency, method }: { orderId: string; kind: 'payment' | 'refund'; max: string; currency: string; method: string }) {
  const [open, setOpen] = React.useState(false);
  const defaults = () => ({ kind, payment_date: today(), amount: max, method, reference: '', idempotency_key: newKey() });
  const form = useForm<any>({ defaultValues: defaults() });
  const { submit, pending } = useActionSubmit(form, (v) => orderPaymentAction(orderId, v), { success: kind === 'payment' ? 'Payment recorded' : 'Refund recorded', onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) form.reset(defaults()); }} title={kind === 'payment' ? 'Record customer payment' : 'Record refund'} description={kind === 'refund' ? 'Refunds reduce net sales (excl. VAT). For returned goods use “Record return” so stock is handled too.' : `Up to ${max} ${currency}.`} trigger={<Button size="sm" variant="secondary">{kind === 'payment' ? <CircleDollarSign /> : <Undo2 />} {kind === 'payment' ? 'Record payment' : 'Refund'}</Button>}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
        <Field label="Date"><Input type="date" {...form.register('payment_date')} /></Field>
        <Field label={`Amount (${currency}, incl. VAT)`} error={(form.formState.errors as any).amount?.message}><Input inputMode="decimal" {...form.register('amount')} /></Field>
        <Field label="Method"><Input {...form.register('method')} /></Field>
        <Field label="Reference"><Input {...form.register('reference')} /></Field>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button></div>
      </form>
    </Dialog>
  );
}

function ReturnDialog({ orderId, items, currency, refundable }: { orderId: string; items: any[]; currency: string; refundable: string }) {
  const [open, setOpen] = React.useState(false);
  const returnable = items.filter((i) => i.shipped_qty > i.returned_qty);
  const defaults = () => ({ return_date: today(), reason: '', refund_amount: '0', return_shipping_cost: '0', refund_now: true, idempotency_key: newKey(), items: returnable.map((i) => ({ order_item_id: i.id, quantity: 0, condition: 'resellable' })) });
  const form = useForm<any>({ defaultValues: defaults() });
  const { submit, pending } = useActionSubmit(form, (v) => createReturnAction(orderId, { ...v, items: v.items.map((x: any) => ({ ...x, quantity: Number(x.quantity || 0) })) }), { success: 'Return recorded', onSuccess: () => setOpen(false) });
  const r = form.register;
  return (
    <Dialog wide open={open} onOpenChange={(o) => { setOpen(o); if (o) form.reset(defaults()); }} title="Record return" description="Resellable units go back into the lots they came from. Damaged units stay out of stock." trigger={<Button size="sm" variant="secondary"><Undo2 /> Record return</Button>}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <div className="space-y-2">
          {returnable.map((i, k) => (
            <div key={i.id} className="grid grid-cols-[1fr_90px_150px] items-center gap-2 text-sm">
              <span>{i.product_name} — {i.variant_name} <span className="text-xs text-muted">(max {i.shipped_qty - i.returned_qty})</span></span>
              <Input type="number" min={0} max={i.shipped_qty - i.returned_qty} {...r(`items.${k}.quantity`)} aria-label="Quantity returned" />
              <Select {...r(`items.${k}.condition`)}><option value="resellable">Resellable</option><option value="damaged">Damaged</option></Select>
            </div>
          ))}
          {(form.formState.errors as any).items?.message && <p className="text-xs text-rose-600">{(form.formState.errors as any).items.message}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Return date"><Input type="date" {...r('return_date')} /></Field>
          <Field label={`Refund (${currency}, incl. VAT)`} hint={`Up to ${refundable}`}><Input inputMode="decimal" {...r('refund_amount')} /></Field>
          <Field label="Return shipping you paid"><Input inputMode="decimal" {...r('return_shipping_cost')} /></Field>
        </div>
        <Field label="Reason"><Input {...r('reason')} /></Field>
        <Checkbox {...r('refund_now')} label="Refund has been paid to the customer" hint="Creates the refund and its cash movement now." />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending}>{pending ? 'Saving…' : 'Record return'}</Button></div>
      </form>
    </Dialog>
  );
}
