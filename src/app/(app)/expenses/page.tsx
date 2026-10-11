import Link from 'next/link';
import { Receipt, Plus } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { listExpenses, expenseTotals } from '@/lib/services/expenses';
import { PageHeader, EmptyState, Stat, Callout } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { LinkTabs } from '@/components/ui/tabs';
import { FilterBar } from '@/components/app/filters';
import { Money, fmtDate } from '@/components/app/money';
import { Pagination } from '@/components/app/pagination';
import { sp } from '@/components/app/period';
import { EXPENSE_CATEGORIES, EXPENSE_TREATMENTS, categoryLabel, treatmentLabel } from '@/lib/constants';

export const metadata = { title: 'Expenses' };
const PAGE = 50;

export default async function Expenses({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const view = (sp(p.view) ?? 'all') as any;
  const page = Number(sp(p.page) ?? 1);
  const f = { q: sp(p.q), view, category: sp(p.category), treatment: sp(p.treatment), from: sp(p.from), to: sp(p.to) };
  const { rows, totals } = await tenant(async (tx) => ({ rows: await listExpenses(tx, f), totals: await expenseTotals(tx, { from: f.from, to: f.to }) }));
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const qs = (v: string) => { const q = new URLSearchParams(); for (const [k, val] of Object.entries(p)) if (typeof val === 'string' && k !== 'view' && k !== 'page') q.set(k, val); q.set('view', v); return `/expenses?${q}`; };
  return (
    <>
      <PageHeader title="Expenses" description="What you committed, what you actually paid, and what you plan to spend are kept separate." actions={<><Button asChild variant="secondary"><Link href="/expenses/new?commitment=planned">Plan a cost</Link></Button><Button asChild><Link href="/expenses/new"><Plus /> Record expense</Link></Button></>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Committed investment" hint="Ordered or invoiced, paid or not" value={<Money value={totals.committed_base} currency={cur} />} href={qs('committed')} />
        <Stat label="Actual cash spent" hint="Payments that left the business" value={<Money value={totals.cash_spent_base} currency={cur} />} href={qs('paid')} />
        <Stat label="Still owed" value={<Money value={totals.outstanding_base} currency={cur} />} tone="warning" href={qs('outstanding')} />
        <Stat label="Forecast (planned)" tone="estimate" value={<Money value={totals.forecast_base} currency={cur} />} href={qs('forecast')} sub="Not yet committed" />
      </div>
      {totals.missing_fx > 0 && <Callout tone="warning" className="mb-4">{totals.missing_fx} expense(s) have no exchange rate and are excluded from {cur} totals until a rate is entered.</Callout>}
      <LinkTabs active={view} tabs={[{ key: 'all', label: 'All', href: qs('all') }, { key: 'committed', label: 'Committed', href: qs('committed') }, { key: 'paid', label: 'Cash spent', href: qs('paid') }, { key: 'outstanding', label: 'Unpaid', href: qs('outstanding') }, { key: 'forecast', label: 'Forecast', href: qs('forecast') }]} />
      <Card>
        <FilterBar filters={[{ type: 'search', name: 'q', placeholder: 'Search name, payee…' }, { type: 'select', name: 'category', label: 'Category', options: EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label })) }, { type: 'select', name: 'treatment', label: 'Treatment', options: EXPENSE_TREATMENTS.map((t) => ({ value: t.value, label: t.label })) }, { type: 'date', name: 'from', label: 'From' }, { type: 'date', name: 'to', label: 'To' }]} />
        {rows.length === 0 ? (
          <EmptyState icon={<Receipt />} title="No expenses here" action={<Button asChild><Link href="/expenses/new"><Plus /> Record expense</Link></Button>}>Record samples, branding, website, freight, customs, advertising — before and after launch.</EmptyState>
        ) : (
          <>
            <Table>
              <THead><tr><Th>Date</Th><Th>Expense</Th><Th>Treatment</Th><Th>Linked to</Th><Th>Status</Th><Th right>Amount</Th><Th right>{cur}</Th><Th right>Paid</Th></tr></THead>
              <tbody>{pageRows.map((e) => (
                <Tr key={e.id}>
                  <Td muted className="whitespace-nowrap">{fmtDate(e.date_incurred)}</Td>
                  <Td><Link href={`/expenses/${e.id}`} className="font-medium hover:underline">{e.name}</Link><div className="text-xs text-muted">{categoryLabel(e.category)}{e.payee ? ` · ${e.payee}` : ''}</div></Td>
                  <Td muted className="text-xs">{treatmentLabel(e.treatment)}</Td>
                  <Td muted className="text-xs">{e.shipment_ref ? `Shipment ${e.shipment_ref}` : e.po_number ? `PO ${e.po_number}` : e.campaign_name ? `Campaign ${e.campaign_name}` : 'General'}{e.sku ? ` · ${e.sku}` : ''}</Td>
                  <Td><StatusBadge status={e.payment_state} /></Td>
                  <Td right>{Number(e.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {e.currency}</Td>
                  <Td right>{e.amount_base === null ? <Badge tone="amber">no rate</Badge> : <Money value={e.amount_base} currency={cur} />}</Td>
                  <Td right><Money value={e.paid_base} currency={cur} /></Td>
                </Tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE} total={rows.length} basePath="/expenses" params={p} />
          </>
        )}
      </Card>
    </>
  );
}
