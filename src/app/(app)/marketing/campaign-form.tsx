'use client';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { campaignSchema } from '@/lib/validation/schemas';
import { saveCampaignAction } from '@/app/actions/operations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/input';
import { Field, FormSection, useActionSubmit, err } from '@/components/app/form';
import { CAMPAIGN_CHANNELS, CAMPAIGN_ALLOCATIONS } from '@/lib/constants';

export function CampaignForm({ initial, id, variants }: { initial: any; id?: string; variants: { id: string; label: string }[] }) {
  const form = useForm<any>({ resolver: zodResolver(campaignSchema) as any, defaultValues: initial });
  const products = useFieldArray({ control: form.control, name: 'products' });
  const { submit, pending } = useActionSubmit(form, (v) => saveCampaignAction(v, id), { success: 'Campaign saved', redirect: (cid) => `/marketing/${cid}` });
  const r = form.register;
  const method = form.watch('allocation_method');
  const pre = form.watch('is_prelaunch');
  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <Card className="px-5">
        <FormSection title="Campaign">
          <Field label="Name" required error={err(form, 'name')} className="sm:col-span-2"><Input {...r('name')} /></Field>
          <Field label="Channel"><Select {...r('channel')}>{CAMPAIGN_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></Field>
          <Field label="Planned budget" error={err(form, 'planned_budget')}><Input inputMode="decimal" {...r('planned_budget')} /></Field>
          <Field label="Start date"><Input type="date" {...r('start_date')} /></Field>
          <Field label="End date" error={err(form, 'end_date')}><Input type="date" {...r('end_date')} /></Field>
          <Field label="Sessions / clicks (optional)" hint="Enables conversion rate"><Input type="number" {...r('sessions')} /></Field>
          <Checkbox {...r('is_prelaunch')} label="Pre-launch campaign" hint="Spend is shown separately as launch marketing and never added to unit costs." className="self-end pb-2" />
          <Field label="Notes" className="sm:col-span-2"><Textarea {...r('notes')} /></Field>
        </FormSection>
        <FormSection title="Spend allocation to products" description="How this campaign's spend is split across products for profitability. Each euro is allocated exactly once.">
          <Field label="Method" className="sm:col-span-2"><Select {...r('allocation_method')} disabled={pre}>{CAMPAIGN_ALLOCATIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></Field>
          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">Products promoted {method === 'manual' && '(shares must total 100%)'}</span><Button type="button" size="sm" variant="secondary" onClick={() => products.append({ variant_id: '', manual_share_pct: '' })}><Plus /> Add</Button></div>
            {products.fields.map((f, i) => (
              <div key={f.id} className="mb-2 flex gap-2">
                <Select {...r(`products.${i}.variant_id`)}><option value="">Product…</option>{variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select>
                {method === 'manual' && <Input inputMode="decimal" placeholder="%" {...r(`products.${i}.manual_share_pct`)} className="w-24" />}
                <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => products.remove(i)}><Trash2 /></Button>
              </div>
            ))}
            {err(form, 'products') && <p className="text-xs text-rose-600">{err(form, 'products')}</p>}
          </div>
        </FormSection>
      </Card>
      <div className="mt-4 flex justify-end"><Button type="submit" disabled={pending}>{pending ? 'Saving…' : id ? 'Save campaign' : 'Create campaign'}</Button></div>
    </form>
  );
}
