'use client';
import * as React from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { productSchema } from '@/lib/validation/schemas';
import { saveProductAction } from '@/app/actions/catalog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/input';
import { Field, FormSection, useActionSubmit, err } from '@/components/app/form';

type Supplier = { id: string; name: string; currency: string; lead_time_days: number | null; min_order_qty: number | null };

const emptyVariant = (currency = 'MAD') => ({
  id: null, sku: '', barcode: '', variant_name: 'Standard', supplier_unit_price: '', purchase_currency: currency, default_selling_price: '', selling_price_includes_tax: true,
  target_margin_pct: '', target_markup_pct: '', length_cm: '', width_cm: '', height_cm: '', weight_kg: '', min_order_qty: '', order_multiple: '', supplier_lead_days: '', shipping_lead_days: '',
  safety_stock_qty: 0, packaging_cost: '',
});

export function ProductForm({ suppliers, currencies, categories, initial, id, defaultTaxInclusive }: { suppliers: Supplier[]; currencies: string[]; categories: string[]; initial?: any; id?: string; defaultTaxInclusive: boolean }) {
  const form = useForm<any>({
    resolver: zodResolver(productSchema) as any,
    defaultValues: initial ?? { name: '', description: '', brand: '', category: '', supplier_id: '', country_of_origin: 'MA', image_url: '', status: 'draft', has_expiry: false, shelf_life_days: '', notes: '', variants: [{ ...emptyVariant(), selling_price_includes_tax: defaultTaxInclusive }] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'variants' });
  const { submit, pending } = useActionSubmit(form, (v) => saveProductAction(v, id), { success: id ? 'Product updated' : 'Product created', redirect: (pid) => `/products/${pid}` });
  const r = form.register;
  const supplierId = form.watch('supplier_id');
  const supplier = suppliers.find((s) => s.id === supplierId);

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <Card className="px-5">
        <FormSection title="Product" description="What you sell. Variants (size, scent, packaging) are added below.">
          <Field label="Product name" required error={err(form, 'name')} className="sm:col-span-2"><Input {...r('name')} placeholder="Organic Argan Oil" /></Field>
          <Field label="Brand" error={err(form, 'brand')}><Input {...r('brand')} /></Field>
          <Field label="Category" error={err(form, 'category')}>
            <Input {...r('category')} list="categories" placeholder="Face oils, Masks…" />
            <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Description" className="sm:col-span-2"><Textarea {...r('description')} /></Field>
          <Field label="Status" hint="Only active products appear in reorder planning.">
            <Select {...r('status')}><option value="draft">Draft</option><option value="active">Active</option><option value="discontinued">Discontinued</option></Select>
          </Field>
          <Field label="Image URL" error={err(form, 'image_url')} hint="Link to a hosted image (file storage integration not connected)."><Input {...r('image_url')} placeholder="https://…" /></Field>
        </FormSection>
        <FormSection title="Sourcing" description="Supplier and origin. Lead times feed the reorder planner.">
          <Field label="Supplier" error={err(form, 'supplier_id')}>
            <Select {...r('supplier_id')}>
              <option value="">— None yet —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Country of origin" error={err(form, 'country_of_origin')}><Input {...r('country_of_origin')} maxLength={2} placeholder="MA" /></Field>
          <Checkbox {...r('has_expiry')} label="Has an expiry date / shelf life" hint="Enables expiry tracking and FEFO dispatch." />
          <Field label="Shelf life (days)" error={err(form, 'shelf_life_days')}><Input type="number" {...r('shelf_life_days')} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea {...r('notes')} /></Field>
        </FormSection>
      </Card>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">Variants & SKUs</h2>
        <Button type="button" variant="secondary" size="sm" onClick={() => append({ ...emptyVariant(supplier?.currency ?? 'MAD'), selling_price_includes_tax: defaultTaxInclusive })}><Plus /> Add variant</Button>
      </div>
      {typeof (form.formState.errors as any).variants?.message === 'string' && <p className="mb-2 text-sm text-rose-600">{(form.formState.errors as any).variants.message}</p>}
      <div className="space-y-4">
        {fields.map((f, i) => (
          <Card key={f.id} className="px-5">
            <div className="flex items-center justify-between border-b border-line py-3">
              <div className="text-sm font-semibold">Variant {i + 1}</div>
              {fields.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}><Trash2 /> Remove</Button>}
            </div>
            <FormSection title="Identity">
              <Field label="Variant name" required error={err(form, `variants.${i}.variant_name`)} hint="e.g. 50 ml, Rose, Gift box"><Input {...r(`variants.${i}.variant_name`)} /></Field>
              <Field label="SKU" required error={err(form, `variants.${i}.sku`)}><Input {...r(`variants.${i}.sku`)} placeholder="ARG-50" /></Field>
              <Field label="Barcode (EAN/UPC)"><Input {...r(`variants.${i}.barcode`)} /></Field>
            </FormSection>
            <FormSection title="Cost & price" description="The selling price alone never proves profitability — margins are calculated from landed costs.">
              <Field label="Supplier unit price" required error={err(form, `variants.${i}.supplier_unit_price`)}><Input inputMode="decimal" {...r(`variants.${i}.supplier_unit_price`)} /></Field>
              <Field label="Purchase currency" error={err(form, `variants.${i}.purchase_currency`)}>
                <Select {...r(`variants.${i}.purchase_currency`)}>{currencies.map((c) => <option key={c}>{c}</option>)}</Select>
              </Field>
              <Field label="Default selling price" error={err(form, `variants.${i}.default_selling_price`)}><Input inputMode="decimal" {...r(`variants.${i}.default_selling_price`)} /></Field>
              <Checkbox {...r(`variants.${i}.selling_price_includes_tax`)} label="Selling price includes VAT" hint="Untick if the price is tax-exclusive (e.g. wholesale)." className="self-end pb-2" />
              <Field label="Target contribution margin %" hint="Blank = business default" error={err(form, `variants.${i}.target_margin_pct`)}><Input inputMode="decimal" {...r(`variants.${i}.target_margin_pct`)} /></Field>
              <Field label="Target markup %" hint="Optional, profit ÷ landed cost" error={err(form, `variants.${i}.target_markup_pct`)}><Input inputMode="decimal" {...r(`variants.${i}.target_markup_pct`)} /></Field>
              <Field label="Packaging cost / unit" hint="Blank = business default" error={err(form, `variants.${i}.packaging_cost`)}><Input inputMode="decimal" {...r(`variants.${i}.packaging_cost`)} /></Field>
            </FormSection>
            <FormSection title="Dimensions" description="Used to allocate freight by weight or volume. Missing data blocks those methods rather than guessing.">
              <Field label="Shipping weight (kg)" error={err(form, `variants.${i}.weight_kg`)}><Input inputMode="decimal" {...r(`variants.${i}.weight_kg`)} /></Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="L (cm)"><Input inputMode="decimal" {...r(`variants.${i}.length_cm`)} /></Field>
                <Field label="W (cm)"><Input inputMode="decimal" {...r(`variants.${i}.width_cm`)} /></Field>
                <Field label="H (cm)"><Input inputMode="decimal" {...r(`variants.${i}.height_cm`)} /></Field>
              </div>
            </FormSection>
            <FormSection title="Replenishment" description="Blank lead times fall back to supplier / business defaults.">
              <Field label="Minimum order qty" hint={supplier?.min_order_qty ? `Supplier MOQ: ${supplier.min_order_qty}` : undefined}><Input type="number" {...r(`variants.${i}.min_order_qty`)} /></Field>
              <Field label="Order in multiples of"><Input type="number" {...r(`variants.${i}.order_multiple`)} /></Field>
              <Field label="Supplier lead time (days)" hint={supplier?.lead_time_days ? `Supplier default: ${supplier.lead_time_days}` : undefined}><Input type="number" {...r(`variants.${i}.supplier_lead_days`)} /></Field>
              <Field label="Shipping & customs lead time (days)"><Input type="number" {...r(`variants.${i}.shipping_lead_days`)} /></Field>
              <Field label="Safety stock (units)" error={err(form, `variants.${i}.safety_stock_qty`)}><Input type="number" {...r(`variants.${i}.safety_stock_qty`)} /></Field>
            </FormSection>
          </Card>
        ))}
      </div>
      <div className="sticky bottom-0 z-10 mt-6 flex justify-end gap-2 border-t border-line bg-ivory/95 py-4 backdrop-blur">
        <Button type="button" variant="secondary" onClick={() => history.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : id ? 'Save changes' : 'Create product'}</Button>
      </div>
    </form>
  );
}
