'use client';
import * as React from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { salesOrderSchema } from '@/lib/validation/schemas';
import { createOrderAction } from '@/app/actions/operations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/input';
import { Field, FormSection, useActionSubmit, err } from '@/components/app/form';
import { PAYMENT_METHODS } from '@/lib/constants';
import { D, formatMoney } from '@/lib/calc/money';

type V = { id: string; label: string; price: string | null; incl: boolean; available: number };
type Ch = { id: string; name: string; commission_pct: string; commission_fixed: string };

const num = (v: any) => (/^-?\d*\.?\d+$/.test(String(v ?? '').trim()) ? D(String(v).trim()) : D(0));

export function OrderForm({ initial, variants, channels, campaigns, defaults, allowNegative, baseCurrency }: { initial: any; variants: V[]; channels: Ch[]; campaigns: { id: string; name: string }[]; defaults: { paymentFeePct: string; paymentFeeFixed: string }; allowNegative: boolean; baseCurrency: string }) {
  const form = useForm<any>({ resolver: zodResolver(salesOrderSchema) as any, defaultValues: initial });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const { submit, pending } = useActionSubmit(form, createOrderAction, { success: 'Order recorded', redirect: (d: any) => `/sales/${d.id}` });
  const r = form.register;
  const w = form.watch();
  const incl = !!w.prices_include_tax;
  const t = num(w.tax_rate_pct).div(100).plus(1);
  const merch = (w.items as any[]).reduce((a, i) => a.plus(num(i.unit_price).times(num(i.quantity))).minus(num(i.line_discount)), D(0));
  const net = merch.minus(num(w.order_discount)).plus(num(w.shipping_charged));
  const total = incl ? net : net.times(t);
  const exVat = incl ? net.div(t) : net;
  const channel = channels.find((c) => c.id === w.channel_id);
  const autoFees = React.useCallback(() => {
    const fee = w.payment_method === 'cod' ? D(0) : total.times(num(defaults.paymentFeePct)).div(100).plus(num(defaults.paymentFeeFixed));
    form.setValue('payment_fee', fee.toFixed(2));
    if (channel) form.setValue('platform_fee', total.times(num(channel.commission_pct)).div(100).plus(num(channel.commission_fixed)).toFixed(2));
  }, [total.toString(), w.payment_method, channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { autoFees(); }, [autoFees]);
  const shortages = (w.items as any[]).map((i) => { const v = variants.find((x) => x.id === i.variant_id); return v && num(i.quantity).greaterThan(v.available) ? `${v.label}: only ${v.available} available` : null; }).filter(Boolean);

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <Card className="px-5">
        <FormSection title="Order">
          <Field label="Order number" required error={err(form, 'order_number')}><Input {...r('order_number')} /></Field>
          <Field label="Order date" required error={err(form, 'order_date')}><Input type="date" {...r('order_date')} /></Field>
          <Field label="Sales channel"><Select {...r('channel_id')}><option value="">—</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}{Number(c.commission_pct) ? ` (${Number(c.commission_pct)}% commission)` : ''}</option>)}</Select></Field>
          <Field label="Attributed campaign" hint="For CPA and ROAS"><Select {...r('campaign_id')}><option value="">None / organic</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Initial status"><Select {...r('initial_status')}><option value="confirmed">Confirmed — reserve stock now</option><option value="pending">Pending — no stock reserved yet</option></Select></Field>
        </FormSection>
        <FormSection title="Customer" description="Only what you need for delivery and follow-up.">
          <Field label="Name"><Input {...r('customer_name')} /></Field>
          <Field label="Email" error={err(form, 'customer_email')}><Input type="email" {...r('customer_email')} /></Field>
          <Field label="Phone"><Input {...r('customer_phone')} /></Field>
          <Field label="City"><Input {...r('customer_city')} /></Field>
        </FormSection>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">Products</h2>
          <div className="flex items-center gap-3">
            <Checkbox {...r('prices_include_tax')} label="Prices include VAT" />
            <Button type="button" variant="secondary" size="sm" onClick={() => append({ variant_id: '', quantity: 1, unit_price: '', line_discount: '0' })}><Plus /> Add product</Button>
          </div>
        </div>
        <div className="divide-y divide-line">
          {fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-2 gap-3 px-5 py-3 sm:grid-cols-[2fr_90px_1fr_1fr_auto] sm:items-end">
              <Field label="Product" error={err(form, `items.${i}.variant_id`)} className="col-span-2 sm:col-span-1">
                <Select {...r(`items.${i}.variant_id`, { onChange: (e) => { const v = variants.find((x) => x.id === e.target.value); if (v?.price) form.setValue(`items.${i}.unit_price`, v.price); } })}>
                  <option value="">Choose…</option>
                  {variants.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.available} avail.</option>)}
                </Select>
              </Field>
              <Field label="Qty" error={err(form, `items.${i}.quantity`)}><Input type="number" min={1} {...r(`items.${i}.quantity`)} /></Field>
              <Field label={`Unit price ${incl ? '(incl. VAT)' : '(excl. VAT)'}`} error={err(form, `items.${i}.unit_price`)}><Input inputMode="decimal" {...r(`items.${i}.unit_price`)} /></Field>
              <Field label="Line discount" error={err(form, `items.${i}.line_discount`)}><Input inputMode="decimal" {...r(`items.${i}.line_discount`)} /></Field>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => remove(i)} disabled={fields.length === 1}><Trash2 /></Button>
            </div>
          ))}
        </div>
        {shortages.length > 0 && <div className="mx-5 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{shortages.join(' · ')}. {allowNegative ? 'Tick “allow negative stock” below to override (logged).' : 'Negative stock is blocked by your settings.'}</div>}
        <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-4">
          <Field label="Market (country)"><Input {...r('market_code')} maxLength={2} /></Field>
          <Field label="VAT rate %" error={err(form, 'tax_rate_pct')}><Input inputMode="decimal" {...r('tax_rate_pct')} /></Field>
          <Field label="Order discount" error={err(form, 'order_discount')}><Input inputMode="decimal" {...r('order_discount')} /></Field>
          <Field label="Shipping charged to customer" error={err(form, 'shipping_charged')}><Input inputMode="decimal" {...r('shipping_charged')} /></Field>
        </div>
        <div className="flex flex-wrap justify-end gap-x-8 gap-y-1 border-t border-line bg-ivory/50 px-5 py-3 text-sm">
          <span className="text-muted">Net excl. VAT <span className="num ml-1 font-medium text-ink">{formatMoney(exVat, w.currency || baseCurrency)}</span></span>
          <span className="text-muted">VAT <span className="num ml-1">{formatMoney(total.minus(exVat), w.currency || baseCurrency)}</span></span>
          <span>Customer pays <span className="num ml-1 font-semibold">{formatMoney(total, w.currency || baseCurrency)}</span></span>
        </div>
      </Card>

      <Card className="mt-4 px-5">
        <FormSection title="Payment & delivery" description={`Costs paid by your business (${baseCurrency}). Fees are pre-filled from Settings and the channel's commission — adjust to the actual amount.`}>
          <Field label="Payment method"><Select {...r('payment_method')}>{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
          <Field label="Delivery provider"><Input {...r('delivery_provider')} placeholder="Colissimo, Mondial Relay…" /></Field>
          <Field label="Tracking reference"><Input {...r('tracking_ref')} /></Field>
          <Field label="Shipping cost (paid by you)" error={err(form, 'shipping_cost')}><Input inputMode="decimal" {...r('shipping_cost')} /></Field>
          <Field label="Fulfilment / handling" error={err(form, 'fulfillment_cost')}><Input inputMode="decimal" {...r('fulfillment_cost')} /></Field>
          <Field label="Packaging" error={err(form, 'packaging_cost')}><Input inputMode="decimal" {...r('packaging_cost')} /></Field>
          <Field label="Payment processing fee" error={err(form, 'payment_fee')}><Input inputMode="decimal" {...r('payment_fee')} /></Field>
          <Field label="Platform / marketplace fee" error={err(form, 'platform_fee')}><Input inputMode="decimal" {...r('platform_fee')} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea {...r('notes')} /></Field>
          {allowNegative && <Checkbox {...r('allow_negative_stock')} label="Allow negative stock for this order" hint="Exceptional cases only — flagged in inventory." className="sm:col-span-2" />}
        </FormSection>
      </Card>
      <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-2 border-t border-line bg-ivory/95 py-4 backdrop-blur">
        <Button type="button" variant="secondary" onClick={() => history.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Record order'}</Button>
      </div>
    </form>
  );
}
