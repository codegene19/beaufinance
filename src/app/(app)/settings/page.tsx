import Link from 'next/link';
import { tenant, getAppContext } from '@/lib/app-context';
import { listReferenceData } from '@/lib/services/business';
import { PageHeader, Callout } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { LinkTabs } from '@/components/ui/tabs';
import { fmtDate } from '@/components/app/money';
import { SettingsForm } from './settings-form';
import { RateForm, DeleteRate, CurrencyForm, TaxForm, DeleteTax, MarketForm, ChannelRow, MemberForm, RemoveMember, CreateDemo } from './reference-forms';
import { REPORTS } from '@/lib/services/reports';
import { authProvider } from '@/lib/auth/config';
import { isLocalDatabase } from '@/lib/db';

export const metadata = { title: 'Settings' };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'business' } = await searchParams;
  const ctx = await getAppContext();
  const ref = await tenant(listReferenceData);
  const st = ctx.settings as any;
  const readOnly = ctx.role !== 'owner';
  const initial = { business_name: ctx.business.name, logo_url: s(ctx.business.logo_url), base_currency: ctx.business.base_currency, ...Object.fromEntries(Object.entries(st).map(([k, v]) => [k, typeof v === 'boolean' ? v : s(v)])) };
  const tabs = ['business', 'rules', 'tax', 'currencies', 'channels', 'members', 'data'];
  const labels: Record<string, string> = { business: 'Business & pricing', rules: 'Rules & planning', tax: 'Tax & markets', currencies: 'Currencies & rates', channels: 'Sales channels', members: 'Users & roles', data: 'Data & backup' };
  return (
    <>
      <PageHeader title="Settings" description={readOnly ? 'You have read-only access to business settings (owner role required to change them).' : 'Configure the business model: markets, taxes, currencies, fees and the rules behind every calculation.'} />
      <LinkTabs active={tab} tabs={tabs.map((t) => ({ key: t, label: labels[t], href: `/settings?tab=${t}` }))} />
      {(tab === 'business' || tab === 'rules') && <SettingsForm key={tab} initial={initial} section={tab as any} readOnly={readOnly} />}
      {tab === 'tax' && (
        <div className="space-y-4">
          <Callout tone="warning">Tax rates are configurable placeholders. BeauFinance does not determine which rates apply to your products or claim tax compliance — confirm with your accountant.</Callout>
          <Card>
            <CardHeader title="Tax rates by market and transaction type" />
            <Table><THead><tr><Th>Market</Th><Th>Type</Th><Th>Name</Th><Th right>Rate</Th><Th>Flags</Th><Th /></tr></THead>
              <tbody>{ref.taxRates.map((t: any) => <Tr key={t.id}><Td>{t.market_code}</Td><Td>{t.transaction_type}</Td><Td>{t.name}<div className="text-xs text-muted">{t.notes}</div></Td><Td right>{Number(t.rate_pct)}%</Td><Td>{t.is_default && <Badge tone="sage">default</Badge>} {t.is_recoverable && <Badge>recoverable</Badge>}</Td><Td>{!readOnly && <DeleteTax id={t.id} />}</Td></Tr>)}</tbody>
            </Table>
            {!readOnly && <div className="border-t border-line p-4"><TaxForm markets={ref.markets.map((m: any) => m.code)} /></div>}
          </Card>
          <Card>
            <CardHeader title="Sales markets" />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-2">{ref.markets.map((m: any) => <Badge key={m.id} tone={m.is_active ? 'sage' : 'neutral'}>{m.code} · {m.name} · {m.currency}</Badge>)}</div>
              {!readOnly && <MarketForm />}
            </CardBody>
          </Card>
        </div>
      )}
      {tab === 'currencies' && (
        <div className="space-y-4">
          <Callout tone="info">Default rates only <strong>pre-fill</strong> new transactions. Every purchase, payment and expense stores its own rate, so changing a default never rewrites history.</Callout>
          <Card>
            <CardHeader title="Supported currencies" />
            <CardBody className="space-y-3"><div className="flex flex-wrap gap-2">{ref.currencies.map((c: any) => <Badge key={c.code}>{c.code} · {c.name}</Badge>)}</div>{!readOnly && <CurrencyForm />}</CardBody>
          </Card>
          <Card>
            <CardHeader title={`Default exchange rates → ${ctx.business.base_currency}`} />
            <Table><THead><tr><Th>Currency</Th><Th right>1 unit =</Th><Th>Effective</Th><Th>Source</Th><Th /></tr></THead>
              <tbody>{ref.rates.map((r: any) => <Tr key={r.id}><Td>{r.currency}</Td><Td right>{Number(r.rate_to_base)} {ctx.business.base_currency}</Td><Td muted>{fmtDate(r.effective_date)}</Td><Td muted className="text-xs">{r.source}</Td><Td>{!readOnly && <DeleteRate id={r.id} />}</Td></Tr>)}</tbody>
            </Table>
            {!readOnly && <div className="border-t border-line p-4"><RateForm currencies={ref.currencies.map((c: any) => c.code)} base={ctx.business.base_currency} /></div>}
          </Card>
        </div>
      )}
      {tab === 'channels' && (
        <Card>
          <CardHeader title="Sales channels & marketplace commissions" description="Commissions pre-fill the platform fee on new orders and the pricing calculator." />
          <CardBody className="divide-y divide-line">
            {ref.channels.map((c: any) => <ChannelRow key={c.id} c={c} />)}
            {!readOnly && <div className="pt-3"><ChannelRow /></div>}
          </CardBody>
        </Card>
      )}
      {tab === 'members' && (
        <Card>
          <CardHeader title="Users & roles" description="Owner: everything incl. settings and members. Manager: create and edit records. Viewer: read-only. Enforced by database row-level security." />
          <Table><THead><tr><Th>User</Th><Th>Role</Th><Th>Since</Th><Th /></tr></THead>
            <tbody>{ref.members.map((m: any) => <Tr key={m.user_id}><Td>{m.email}{m.user_id === ctx.user.id && <Badge className="ml-2">you</Badge>}</Td><Td><Badge tone={m.role === 'owner' ? 'gold' : m.role === 'manager' ? 'sage' : 'neutral'}>{m.role}</Badge></Td><Td muted>{fmtDate(m.created_at)}</Td><Td>{!readOnly && m.user_id !== ctx.user.id && <RemoveMember userId={m.user_id} />}</Td></Tr>)}</tbody>
          </Table>
          {!readOnly && <div className="border-t border-line p-4"><MemberForm /><p className="mt-2 text-xs text-muted">The person must have signed up first. Email invitations are not connected.</p></div>}
        </Card>
      )}
      {tab === 'data' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Export your data" description="Every report is available as CSV and Excel." />
            <CardBody className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
              {REPORTS.map((r) => <a key={r.key} className="text-sage-700 hover:underline" href={`/api/export/${r.key}?format=xlsx`}>{r.title} (.xlsx)</a>)}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Backup & recovery" />
            <CardBody className="space-y-3 text-sm text-ink-soft">
              <p>Environment: database <strong>{isLocalDatabase() ? 'embedded PostgreSQL (local)' : 'PostgreSQL (Supabase / server)'}</strong>, auth <strong>{authProvider()}</strong>.</p>
              {isLocalDatabase() ? <p>Run <code className="rounded bg-ivory-deep px-1">npm run db:backup</code> to write a full SQL dump to <code>./backups</code>. Restore instructions are in <code>docs/BACKUP.md</code>.</p>
                : <p>Supabase takes daily backups (Point-in-Time Recovery on paid plans). For your own copies run <code className="rounded bg-ivory-deep px-1">npm run db:backup</code> or <code>pg_dump</code> with your DATABASE_URL — see <code>docs/BACKUP.md</code>.</p>}
              <p>All changes to financial records are also kept in an append-only audit log.</p>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Demo data" description="Explore with realistic sample data in a separate business. Demo data is never mixed with your real records." />
            <CardBody className="flex flex-wrap items-center gap-3"><CreateDemo />{ctx.memberships.filter((m) => m.is_demo).length > 0 && <span className="text-sm text-muted">You already have {ctx.memberships.filter((m) => m.is_demo).length} demo business(es) — switch in the sidebar.</span>}</CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Audit log" description="Latest changes recorded by the database." action={<Link className="text-sm text-sage-700 hover:underline" href="/settings/audit">View</Link>} />
          </Card>
        </div>
      )}
    </>
  );
}
