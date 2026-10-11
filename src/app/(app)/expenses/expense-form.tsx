'use client';
import * as React from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { expenseSchema } from '@/lib/validation/schemas';
import { saveExpenseAction } from '@/app/actions/operations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field, FormSection, useActionSubmit, err } from '@/components/app/form';
import { Callout } from '@/components/ui/misc';
import { EXPENSE_CATEGORIES, EXPENSE_TREATMENTS, ALLOCATION_METHODS } from '@/lib/constants';

type Opt = { id: string; label: string };

export function ExpenseForm({ initial, id, refs, baseCurrency, rates, importVatRecoverable }: { initial: any; id?: string; refs: { pos: Opt[]; shipments: Opt[]; campaigns: Opt[]; variants: Opt[]; suppliers: Opt[]; currencies: string[] }; baseCurrency: string; rates: Record<string, string>; importVatRecoverable: boolean }) {
  const form = useForm<any>({ resolver: zodResolver(expenseSchema) as any, defaultValues: initial });
  const shares = useFieldArray({ control: form.control, name: 'manual_shares' });
  const { submit, pending } = useActionSubmit(form, (v) => saveExpenseAction(v, id), { success: 'Expense saved', redirect: (d: any) => `/expenses/${d.id}` });
  const r = form.register;
  const [category, treatment, linkType, currency, commitment, method] = form.watch(['category', 'treatment', 'link_type', 'currency', 'commitment', 'allocation_method']);
  const groups = Array.from(new Set(EXPENSE_CATEGORIES.map((c) => c.group)));
  const tHelp = EXPENSE_TREATMENTS.find((t) => t.value === treatment)?.help;

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <Card className="px-5">
        <FormSection title="Expense">
          <Field label="Name" required error={err(form, 'name')} className="sm:col-span-2"><Input {...r('name')} placeholder="Air freight invoice #4411" /></Field>
          <Field label="Category" required error={err(form, 'category')}>
            <Select
              {...r('category', {
                onChange: (e) => {
                  const c = EXPENSE_CATEGORIES.find((x) => x.value === e.target.value);
                  if (!c || id) return;
                  let t: string = c.treatment;
                  if (c.value === 'import_vat' && !importVatRecoverable) t = 'product_acquisition';
                  form.setValue('treatment', t);
                  if (t === 'product_acquisition' && form.getValues('link_type') === 'general') form.setValue('link_type', 'shipment');
                  if (t === 'marketing' && ['shipment', 'purchase_order'].includes(form.getValues('link_type'))) form.setValue('link_type', 'campaign');
                },
              })}
            >
              <option value="">Choose…</option>
              {groups.map((g) => <optgroup key={g} label={g}>{EXPENSE_CATEGORIES.filter((c) => c.group === g).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</optgroup>)}
            </Select>
          </Field>
          <Field label="Accounting treatment" required error={err(form, 'treatment')} hint={tHelp}>
            <Select {...r('treatment')}>{EXPENSE_TREATMENTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
          </Field>
          <Field label="Description" className="sm:col-span-2"><Textarea {...r('description')} /></Field>
        </FormSection>
        <FormSection title="Amount" description="Recorded in the invoice currency with the rate used for accounting. Later changes to default rates never change this record.">
          <Field label="Amount" required error={err(form, 'amount')}><Input inputMode="decimal" {...r('amount')} /></Field>
          <Field label="Currency" error={err(form, 'currency')}>
            <Select {...r('currency', { onChange: (e) => form.setValue('fx_rate', e.target.value === baseCurrency ? '1' : rates[e.target.value] ?? '') })}>{refs.currencies.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          {currency !== baseCurrency && (
            <Field label={`Exchange rate (1 ${currency} = ? ${baseCurrency})`} error={err(form, 'fx_rate')} hint={rates[currency] ? `Default ${rates[currency]}` : 'No default rate — required unless planned'}><Input inputMode="decimal" {...r('fx_rate')} /></Field>
          )}
          <Field label="Status" hint="Planned = forecast only. Committed = ordered or invoiced (paid or not).">
            <Select {...r('commitment')}><option value="committed">Committed (ordered / invoiced)</option><option value="planned">Planned (forecast)</option><option value="cancelled">Cancelled</option></Select>
          </Field>
          <Field label="Date incurred" required error={err(form, 'date_incurred')}><Input type="date" {...r('date_incurred')} /></Field>
          <Field label="Due date"><Input type="date" {...r('due_date')} /></Field>
          <Field label="Payee"><Input {...r('payee')} placeholder="DHL, broker, agency…" /></Field>
          <Field label="Supplier (optional)"><Select {...r('supplier_id')}><option value="">—</option>{refs.suppliers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
          <Field label="Recurring"><Select {...r('recurring_interval')}><option value="">One-off</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></Select></Field>
        </FormSection>
        <FormSection title="Link & allocation" description="Each cost belongs to exactly one pool (shipment, purchase order, campaign or general), so it can never be allocated twice.">
          <Field label="Related to" error={err(form, 'link_type')} className="sm:col-span-2">
            <Select {...r('link_type')}>
              <option value="general">General business (not product-specific)</option>
              <option value="shipment">A shipment</option>
              <option value="purchase_order">A purchase order</option>
              <option value="campaign">A marketing campaign</option>
            </Select>
          </Field>
          {linkType === 'shipment' && <Field label="Shipment" error={err(form, 'shipment_id')}><Select {...r('shipment_id')}><option value="">Choose…</option>{refs.shipments.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>}
          {linkType === 'purchase_order' && <Field label="Purchase order" error={err(form, 'purchase_order_id')}><Select {...r('purchase_order_id')}><option value="">Choose…</option>{refs.pos.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>}
          {linkType === 'campaign' && <Field label="Campaign" error={err(form, 'campaign_id')}><Select {...r('campaign_id')}><option value="">Choose…</option>{refs.campaigns.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>}
          {(linkType === 'shipment' || linkType === 'purchase_order') && treatment === 'product_acquisition' && (
            <>
              <Field label="Only for one product (optional)" hint="Restricts allocation to that product's lines"><Select {...r('variant_id')}><option value="">All products in the pool</option>{refs.variants.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
              <Field label="Allocation method" hint="Blank = shipment default (PO costs default to value)"><Select {...r('allocation_method')}><option value="">Default</option>{ALLOCATION_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
            </>
          )}
          {linkType === 'general' && treatment !== 'product_acquisition' && <Field label="Related product (optional, for reporting)"><Select {...r('variant_id')}><option value="">—</option>{refs.variants.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>}
          {treatment === 'product_acquisition' && linkType !== 'shipment' && linkType !== 'purchase_order' && <Callout tone="warning" className="sm:col-span-2">Acquisition costs must be linked to a shipment or purchase order so they can be allocated to the right products.</Callout>}
          {treatment === 'startup' && <Callout tone="info" className="sm:col-span-2">Startup costs stay visible in total business profitability but are not added to unit costs.</Callout>}
          {method === 'manual' && (
            <div className="sm:col-span-2">
              <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">Manual shares (must total 100%)</span><Button type="button" size="sm" variant="secondary" onClick={() => shares.append({ variant_id: '', share_pct: '' })}><Plus /> Add</Button></div>
              {shares.fields.map((f, i) => (
                <div key={f.id} className="mb-2 flex gap-2">
                  <Select {...r(`manual_shares.${i}.variant_id`)}><option value="">Product…</option>{refs.variants.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
                  <Input inputMode="decimal" placeholder="%" {...r(`manual_shares.${i}.share_pct`)} className="w-24" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => shares.remove(i)} aria-label="Remove share"><Trash2 /></Button>
                </div>
              ))}
              {err(form, 'manual_shares') && <p className="text-xs text-rose-600">{err(form, 'manual_shares')}</p>}
            </div>
          )}
        </FormSection>
        <FormSection title="Evidence">
          <Field label="Receipt / invoice URL" error={err(form, 'attachment_url')} hint="Link to the file in your drive (upload storage not connected)."><Input {...r('attachment_url')} placeholder="https://…" /></Field>
          <Field label="Notes"><Textarea {...r('notes')} /></Field>
        </FormSection>
      </Card>
      {commitment === 'planned' && <Callout tone="info" className="mt-4">Planned costs appear in forecasts only. They are excluded from actual profit, landed costs and cash until committed or paid.</Callout>}
      <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-2 border-t border-line bg-ivory/95 py-4 backdrop-blur">
        <Button type="button" variant="secondary" onClick={() => history.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : id ? 'Save changes' : 'Record expense'}</Button>
      </div>
    </form>
  );
}
