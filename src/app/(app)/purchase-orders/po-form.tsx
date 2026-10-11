'use client';
import * as React from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { purchaseOrderSchema } from '@/lib/validation/schemas';
import { savePurchaseOrderAction } from '@/app/actions/purchasing';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field, FormSection, useActionSubmit, err } from '@/components/app/form';
import { Callout } from '@/components/ui/misc';
import { D, formatMoney } from '@/lib/calc/money';

type V = { id: string; label: string; supplier_id: string | null; price: string; currency: string };

export function PurchaseOrderForm({ suppliers, variants, rates, baseCurrency, initial, id, currencies }: { suppliers: { id: string; name: string; currency: string; default_deposit_pct: string }[]; variants: V[]; rates: Record<string, string>; baseCurrency: string; initial: any; id?: string; currencies: string[] }) {
  const form = useForm<any>({ resolver: zodResolver(purchaseOrderSchema) as any, defaultValues: initial });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const { submit, pending } = useActionSubmit(form, (v) => savePurchaseOrderAction(v, id), { success: 'Purchase order saved', redirect: (pid) => `/purchase-orders/${pid}` });
  const r = form.register;
  const supplierId = form.watch('supplier_id');
  const currency = form.watch('currency');
  const items = form.watch('items') as any[];
  const fx = form.watch('fx_rate');
  const supplier = suppliers.find((s) => s.id === supplierId);
  const subtotal = items.reduce((a, i) => a.plus(D(i.quantity || 0).times(D(/^\d*\.?\d*$/.test(i.unit_price || '') ? i.unit_price || 0 : 0))), D(0));
  const sorted = [...variants].sort((a, b) => Number(b.supplier_id === supplierId) - Number(a.supplier_id === supplierId));

  React.useEffect(() => {
    if (!id && supplier) {
      form.setValue('currency', supplier.currency);
      if (rates[supplier.currency]) form.setValue('fx_rate', rates[supplier.currency]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <Card className="px-5">
        <FormSection title="Order" description="The order's full value is a commitment — it is not cash paid. Record payments separately.">
          <Field label="PO number" required error={err(form, 'po_number')}><Input {...r('po_number')} /></Field>
          <Field label="Supplier" required error={err(form, 'supplier_id')}>
            <Select {...r('supplier_id')}><option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </Field>
          <Field label="Order date" required error={err(form, 'order_date')}><Input type="date" {...r('order_date')} /></Field>
          {!id && (
            <Field label="Initial status"><Select {...r('status')}><option value="draft">Draft (not yet sent)</option><option value="ordered">Ordered / confirmed</option></Select></Field>
          )}
        </FormSection>
        <FormSection title="Currency" description={`Accounting rate converts this order to ${baseCurrency}. Payments record their own actual rate. Changing default rates later never rewrites this order.`}>
          <Field label="Purchase currency" error={err(form, 'currency')}><Select {...r('currency')}>{currencies.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label={`Exchange rate (1 ${currency} = ? ${baseCurrency})`} required error={err(form, 'fx_rate')} hint={rates[currency] ? `Default: ${rates[currency]}` : 'No default rate recorded for this currency'}><Input inputMode="decimal" {...r('fx_rate')} /></Field>
          <Field label={`Deposit due (${currency})`} error={err(form, 'deposit_due')} hint={supplier ? `Supplier usual deposit: ${supplier.default_deposit_pct}% = ${subtotal.times(D(supplier.default_deposit_pct)).div(100).toFixed(2)}` : undefined}><Input inputMode="decimal" {...r('deposit_due')} /></Field>
        </FormSection>
        <FormSection title="Timeline">
          <Field label="Expected production completion"><Input type="date" {...r('expected_production_date')} /></Field>
          <Field label="Expected shipment date"><Input type="date" {...r('expected_ship_date')} /></Field>
          <Field label="Expected arrival date" hint="Used for incoming stock in reorder planning"><Input type="date" {...r('expected_arrival_date')} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea {...r('notes')} /></Field>
        </FormSection>
      </Card>

      <Card className="mt-4">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">Products</h2>
          <Button type="button" variant="secondary" size="sm" onClick={() => append({ variant_id: '', quantity: '', unit_price: '' })}><Plus /> Add line</Button>
        </div>
        {variants.length === 0 && <div className="p-5"><Callout tone="warning">Add products first — purchase order lines reference product variants.</Callout></div>}
        <div className="divide-y divide-line">
          {fields.map((f, i) => {
            const it = items[i] ?? {};
            const line = D(it.quantity || 0).times(D(/^\d*\.?\d*$/.test(it.unit_price || '') ? it.unit_price || 0 : 0));
            return (
              <div key={f.id} className="grid grid-cols-2 gap-3 px-5 py-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
                <Field label="Product" error={err(form, `items.${i}.variant_id`)} className="col-span-2 sm:col-span-1">
                  <Select
                    {...r(`items.${i}.variant_id`, {
                      onChange: (e) => {
                        const v = variants.find((x) => x.id === e.target.value);
                        if (v && !form.getValues(`items.${i}.unit_price`)) form.setValue(`items.${i}.unit_price`, v.price);
                      },
                    })}
                  >
                    <option value="">Choose…</option>
                    {sorted.map((v) => <option key={v.id} value={v.id}>{v.label}{v.supplier_id && v.supplier_id !== supplierId ? ' (other supplier)' : ''}</option>)}
                  </Select>
                </Field>
                <Field label="Quantity" error={err(form, `items.${i}.quantity`)}><Input type="number" min={1} {...r(`items.${i}.quantity`)} /></Field>
                <Field label={`Unit price (${currency})`} error={err(form, `items.${i}.unit_price`)}><Input inputMode="decimal" {...r(`items.${i}.unit_price`)} /></Field>
                <div className="text-right text-sm">
                  <div className="text-xs text-muted">Line total</div>
                  <div className="num font-medium">{line.toFixed(2)} {currency}</div>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => remove(i)} disabled={fields.length === 1}><Trash2 /></Button>
              </div>
            );
          })}
        </div>
        {typeof (form.formState.errors as any).items?.message === 'string' && <p className="px-5 pb-3 text-sm text-rose-600">{(form.formState.errors as any).items.message}</p>}
        <div className="flex flex-wrap justify-end gap-6 border-t border-line bg-ivory/50 px-5 py-4 text-sm">
          <div>Subtotal <span className="num ml-2 font-semibold">{subtotal.toFixed(2)} {currency}</span></div>
          <div className="text-muted">≈ <span className="num">{/^\d*\.?\d+$/.test(fx || '') ? formatMoney(subtotal.times(D(fx)), baseCurrency) : '—'}</span> at accounting rate</div>
        </div>
      </Card>
      <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-2 border-t border-line bg-ivory/95 py-4 backdrop-blur">
        <Button type="button" variant="secondary" onClick={() => history.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : id ? 'Save changes' : 'Create purchase order'}</Button>
      </div>
    </form>
  );
}
