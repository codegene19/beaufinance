'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { settingsSchema } from '@/lib/validation/schemas';
import { saveSettingsAction } from '@/app/actions/settings';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { Field, FormSection, useActionSubmit, err } from '@/components/app/form';

export function SettingsForm({ initial, section, readOnly }: { initial: any; section: 'business' | 'rules'; readOnly: boolean }) {
  const form = useForm<any>({ resolver: zodResolver(settingsSchema) as any, defaultValues: initial });
  const { submit, pending } = useActionSubmit(form, saveSettingsAction, { success: 'Settings saved' });
  const r = form.register;
  const num = (k: string, label: string, hint?: string) => <Field label={label} hint={hint} error={err(form, k)}><Input inputMode="decimal" {...r(k)} disabled={readOnly} /></Field>;
  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <fieldset disabled={readOnly}>
        <Card className="px-5">
          {section === 'business' ? (
            <>
              <FormSection title="Business">
                <Field label="Business name" error={err(form, 'business_name')}><Input {...r('business_name')} /></Field>
                <Field label="Logo URL" error={err(form, 'logo_url')}><Input {...r('logo_url')} placeholder="https://…" /></Field>
                <Field label="Reporting (base) currency" hint="Locked once transactions exist." error={err(form, 'base_currency')}><Input {...r('base_currency')} maxLength={3} /></Field>
                <Field label="Default sales market" hint="ISO code, e.g. FR" error={err(form, 'default_market')}><Input {...r('default_market')} maxLength={2} /></Field>
              </FormSection>
              <FormSection title="Pricing & tax display" description="Tax rates themselves are configured per market in the Tax tab.">
                <Field label="Selling prices are entered"><Select {...r('price_tax_mode')}><option value="tax_inclusive">Including VAT (B2C)</option><option value="tax_exclusive">Excluding VAT (B2B)</option></Select></Field>
                <Field label="Percentage fees are charged on"><Select {...r('fee_basis')}><option value="gross_incl_tax">VAT-inclusive amount paid</option><option value="net_excl_tax">Amount excluding VAT</option></Select></Field>
                {num('default_payment_fee_pct', 'Payment processing fee %')}
                {num('default_payment_fee_fixed', 'Payment fixed fee per order')}
                {num('default_packaging_cost', 'Default packaging / unit')}
                {num('default_fulfillment_cost', 'Default fulfilment / order')}
                {num('default_shipping_cost', 'Default shipping you pay / order')}
              </FormSection>
              <FormSection title="Margins">
                {num('default_target_margin_pct', 'Default target contribution margin %')}
                {num('min_acceptable_margin_pct', 'Minimum acceptable margin %', 'Products below are highlighted')}
                {num('premium_margin_uplift_pct', 'Premium scenario uplift (pts)')}
              </FormSection>
            </>
          ) : (
            <>
              <FormSection title="Inventory" description="FIFO uses oldest receipts first. FEFO dispatches lots with the earliest expiry first and skips expired lots.">
                <Field label="Costing / dispatch method"><Select {...r('costing_method')}><option value="fifo">FIFO — first in, first out</option><option value="fefo">FEFO — first expiry, first out</option></Select></Field>
                <Field label="Negative stock policy"><Select {...r('negative_stock_policy')}><option value="block">Block sales without stock</option><option value="allow_with_warning">Allow per order with explicit override (logged)</option></Select></Field>
              </FormSection>
              <FormSection title="Sales recognition" description="When an order counts as revenue and profit.">
                <Field label="Recognise revenue"><Select {...r('revenue_recognition')}><option value="on_delivery">On delivery (recommended, esp. COD)</option><option value="on_shipment">On shipment</option><option value="on_payment">On payment received</option></Select></Field>
                <Checkbox {...r('cod_undelivered_restock')} label="Undelivered / refused parcels return to stock by default" className="self-end pb-2" />
              </FormSection>
              <FormSection title="Expense allocation">
                <Checkbox {...r('import_vat_recoverable')} label="Import VAT is recoverable" hint="If ticked, import VAT is a receivable, not a product cost. Untick if you are not VAT-registered." className="sm:col-span-2" />
                <Field label="Spread startup costs over (units)" hint="Optional, informational fully-loaded view only" error={err(form, 'startup_cost_spread_units')}><Input type="number" {...r('startup_cost_spread_units')} /></Field>
                <Field label="Spread pre-launch marketing over (units)" hint="Optional, informational only" error={err(form, 'prelaunch_marketing_spread_units')}><Input type="number" {...r('prelaunch_marketing_spread_units')} /></Field>
              </FormSection>
              <FormSection title="Reorder planning">
                <Field label="Sales history window (days)" error={err(form, 'sales_history_days')}><Input type="number" {...r('sales_history_days')} /></Field>
                <Field label="Minimum days of history for a forecast" error={err(form, 'min_sales_days_for_forecast')}><Input type="number" {...r('min_sales_days_for_forecast')} /></Field>
                <Field label="Target stock coverage after arrival (days)" error={err(form, 'target_coverage_days')}><Input type="number" {...r('target_coverage_days')} /></Field>
                <Field label="Safety buffer (days of sales)" error={err(form, 'safety_buffer_days')}><Input type="number" {...r('safety_buffer_days')} /></Field>
                <Field label="Default supplier lead time (days)" error={err(form, 'default_supplier_lead_days')}><Input type="number" {...r('default_supplier_lead_days')} /></Field>
                <Field label="Default shipping & customs lead time (days)" error={err(form, 'default_shipping_lead_days')}><Input type="number" {...r('default_shipping_lead_days')} /></Field>
                {num('min_cash_reserve', 'Minimum cash reserve', 'Never planned to be spent on stock')}
              </FormSection>
            </>
          )}
        </Card>
      </fieldset>
      {!readOnly && <div className="mt-4 flex justify-end"><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save settings'}</Button></div>}
    </form>
  );
}
