import Link from 'next/link';
import { Factory, Plus } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { listSuppliers } from '@/lib/services/suppliers';
import { PageHeader, EmptyState, Stat } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FilterBar } from '@/components/app/filters';
import { Money } from '@/components/app/money';
import { sp } from '@/components/app/period';
import { sum } from '@/lib/calc/money';

export const metadata = { title: 'Suppliers' };

export default async function Suppliers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const rows = await tenant((tx) => listSuppliers(tx, { q: sp(p.q), includeArchived: p.archived === '1' }));
  return (
    <>
      <PageHeader title="Suppliers" description="Committed purchase value, cash actually paid and remaining balances per supplier." actions={<Button asChild><Link href="/suppliers/new"><Plus /> Add supplier</Link></Button>} />
      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Committed purchases" value={<Money value={sum(rows.map((r) => r.committed_base))} currency={cur} />} sub="At each PO's accounting rate" href="/purchase-orders" />
          <Stat label="Paid to suppliers" value={<Money value={sum(rows.map((r) => r.paid_base))} currency={cur} />} sub="At actual payment rates" href="/cash-flow?category=supplier_payment" />
          <Stat label="Outstanding balances" value={<Money value={sum(rows.map((r) => r.outstanding_base))} currency={cur} />} tone="warning" href="/purchase-orders?status=partially_paid" />
        </div>
      )}
      <Card>
        <FilterBar filters={[{ type: 'search', name: 'q', placeholder: 'Search suppliers' }, { type: 'select', name: 'archived', label: 'Archived', options: [{ value: '1', label: 'Include archived' }] }]} />
        {rows.length === 0 ? (
          <EmptyState icon={<Factory />} title="No suppliers yet" action={<Button asChild><Link href="/suppliers/new"><Plus /> Add supplier</Link></Button>}>Add your Moroccan producer with their payment terms, MOQ and lead time.</EmptyState>
        ) : (
          <Table>
            <THead><tr><Th>Supplier</Th><Th>Country</Th><Th>Terms</Th><Th right>Lead time</Th><Th right>Committed</Th><Th right>Paid</Th><Th right>Outstanding</Th></tr></THead>
            <tbody>
              {rows.map((s) => (
                <Tr key={s.id}>
                  <Td><Link href={`/suppliers/${s.id}`} className="font-medium hover:text-sage-700 hover:underline">{s.name}</Link>{s.is_archived && <Badge className="ml-2">Archived</Badge>}<div className="text-xs text-muted">{s.contact_name ?? ''} {s.email ?? ''}</div></Td>
                  <Td muted>{s.country}</Td>
                  <Td muted className="max-w-56 truncate">{s.payment_terms ?? '—'}</Td>
                  <Td right>{s.lead_time_days ?? '—'}{s.lead_time_days ? ' d' : ''}</Td>
                  <Td right><Money value={s.committed_base} currency={cur} /></Td>
                  <Td right><Money value={s.paid_base} currency={cur} /></Td>
                  <Td right className={Number(s.outstanding_base) > 0 ? 'font-semibold text-amber-700' : ''}><Money value={s.outstanding_base} currency={cur} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
