'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatISO } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { addExchangeRateAction, deleteExchangeRateAction, addCurrencyAction, saveTaxRateAction, deleteTaxRateAction, saveChannelAction, saveMarketAction, addMemberAction, removeMemberAction } from '@/app/actions/settings';
import { createDemoAction } from '@/app/actions/auth';
import type { ActionResult } from '@/lib/errors';

function useRun() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run = (fn: () => Promise<ActionResult<unknown> | { ok: boolean; error?: string }>, msg = 'Saved', after?: () => void) =>
    start(async () => { const r: any = await fn(); if (r.ok) { toast.success(msg); after?.(); router.refresh(); } else toast.error(r.error); });
  return { pending, run };
}

export function RateForm({ currencies, base }: { currencies: string[]; base: string }) {
  const { pending, run } = useRun();
  const [v, setV] = React.useState({ currency: currencies.find((c) => c !== base) ?? 'MAD', rate_to_base: '', effective_date: formatISO(new Date(), { representation: 'date' }), source: '' });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addExchangeRateAction(v), 'Rate saved', () => setV({ ...v, rate_to_base: '' })); }}>
      <Select value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} className="h-9 w-24" aria-label="Currency">{currencies.filter((c) => c !== base).map((c) => <option key={c}>{c}</option>)}</Select>
      <Input value={v.rate_to_base} onChange={(e) => setV({ ...v, rate_to_base: e.target.value })} placeholder={`1 unit = ? ${base}`} className="h-9 w-36" aria-label="Rate" />
      <Input type="date" value={v.effective_date} onChange={(e) => setV({ ...v, effective_date: e.target.value })} className="h-9 w-40" aria-label="Effective date" />
      <Input value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} placeholder="Source (bank, ECB…)" className="h-9 w-44" />
      <Button size="sm" disabled={pending}>Add rate</Button>
    </form>
  );
}
export function DeleteRate({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <Button variant="ghost" size="icon" aria-label="Delete rate" disabled={pending} onClick={() => confirm('Delete this default rate? Past transactions keep their own recorded rates.') && run(() => deleteExchangeRateAction(id), 'Deleted')}><Trash2 /></Button>;
}
export function CurrencyForm() {
  const { pending, run } = useRun();
  const [v, setV] = React.useState({ code: '', name: '' });
  return (
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addCurrencyAction(v), 'Currency added', () => setV({ code: '', name: '' })); }}>
      <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="GBP" maxLength={3} className="h-9 w-20" aria-label="Code" />
      <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Pound sterling" className="h-9 w-48" aria-label="Name" />
      <Button size="sm" variant="secondary" disabled={pending}>Add currency</Button>
    </form>
  );
}
export function TaxForm({ markets }: { markets: string[] }) {
  const { pending, run } = useRun();
  const [v, setV] = React.useState({ market_code: markets[0] ?? 'FR', transaction_type: 'sale', name: '', rate_pct: '', is_default: true, is_recoverable: false, notes: '' });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveTaxRateAction(v), 'Tax rate saved'); }}>
      <Select value={v.market_code} onChange={(e) => setV({ ...v, market_code: e.target.value })} className="h-9 w-20" aria-label="Market">{markets.map((m) => <option key={m}>{m}</option>)}</Select>
      <Select value={v.transaction_type} onChange={(e) => setV({ ...v, transaction_type: e.target.value })} className="h-9 w-32" aria-label="Type"><option value="sale">Sale</option><option value="import">Import</option><option value="purchase">Purchase</option><option value="shipping">Shipping</option></Select>
      <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Name (e.g. Reduced rate)" className="h-9 w-48" />
      <Input value={v.rate_pct} onChange={(e) => setV({ ...v, rate_pct: e.target.value })} placeholder="%" className="h-9 w-20" aria-label="Rate %" />
      <Checkbox checked={v.is_default} onChange={(e) => setV({ ...v, is_default: e.target.checked })} label="Default" />
      <Checkbox checked={v.is_recoverable} onChange={(e) => setV({ ...v, is_recoverable: e.target.checked })} label="Recoverable" />
      <Button size="sm" disabled={pending}>Add</Button>
    </form>
  );
}
export function DeleteTax({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <Button variant="ghost" size="icon" aria-label="Delete tax rate" disabled={pending} onClick={() => confirm('Delete this tax rate?') && run(() => deleteTaxRateAction(id), 'Deleted')}><Trash2 /></Button>;
}
export function MarketForm() {
  const { pending, run } = useRun();
  const [v, setV] = React.useState({ code: '', name: '', currency: 'EUR', is_active: true });
  return (
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveMarketAction(v), 'Market saved'); }}>
      <Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="BE" maxLength={2} className="h-9 w-16" aria-label="Country code" />
      <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Belgium" className="h-9 w-40" aria-label="Name" />
      <Input value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} maxLength={3} className="h-9 w-20" aria-label="Currency" />
      <Button size="sm" variant="secondary" disabled={pending}>Add market</Button>
    </form>
  );
}
export function ChannelRow({ c }: { c?: any }) {
  const { pending, run } = useRun();
  const [v, setV] = React.useState({ name: c?.name ?? '', kind: c?.kind ?? 'website', commission_pct: c ? String(Number(c.commission_pct)) : '0', commission_fixed: c ? String(Number(c.commission_fixed)) : '0', is_active: c?.is_active ?? true });
  return (
    <form className="flex flex-wrap items-center gap-2 py-1.5" onSubmit={(e) => { e.preventDefault(); run(() => saveChannelAction(v, c?.id), 'Channel saved', () => !c && setV({ ...v, name: '' })); }}>
      <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Channel name" className="h-9 w-44" aria-label="Channel name" />
      <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} className="h-9 w-36" aria-label="Kind">{['website', 'instagram', 'tiktok', 'marketplace', 'retail', 'wholesale', 'other'].map((k) => <option key={k}>{k}</option>)}</Select>
      <Input value={v.commission_pct} onChange={(e) => setV({ ...v, commission_pct: e.target.value })} className="h-9 w-20" aria-label="Commission %" />%
      <Input value={v.commission_fixed} onChange={(e) => setV({ ...v, commission_fixed: e.target.value })} className="h-9 w-20" aria-label="Fixed fee" /> fixed
      <Checkbox checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} label="Active" />
      <Button size="sm" variant={c ? 'ghost' : 'secondary'} disabled={pending}>{c ? 'Save' : 'Add channel'}</Button>
    </form>
  );
}
export function MemberForm() {
  const { pending, run } = useRun();
  const [v, setV] = React.useState({ email: '', role: 'manager' });
  return (
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addMemberAction(v), 'Member added', () => setV({ ...v, email: '' })); }}>
      <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="colleague@example.com" className="h-9 w-64" aria-label="Email" />
      <Select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} className="h-9 w-36" aria-label="Role"><option value="manager">Manager (edit)</option><option value="viewer">Viewer (read-only)</option><option value="owner">Owner</option></Select>
      <Button size="sm" disabled={pending}>Add member</Button>
    </form>
  );
}
export function RemoveMember({ userId }: { userId: string }) {
  const { pending, run } = useRun();
  return <Button variant="ghost" size="sm" disabled={pending} onClick={() => confirm('Remove this member’s access?') && run(() => removeMemberAction(userId), 'Member removed')}>Remove</Button>;
}
export function CreateDemo() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return <Button variant="gold" size="sm" disabled={pending} onClick={() => start(async () => { const r = await createDemoAction(); if (r.ok) { toast.success('Demo business created and opened'); router.push('/'); router.refresh(); } else toast.error(r.error); })}>{pending ? 'Creating demo… (≈10s)' : 'Create a separate demo business'}</Button>;
}
