import Link from 'next/link';
import { Ship, Plus } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { listShipments } from '@/lib/services/shipments';
import { inTransit } from '@/lib/services/inventory';
import { PageHeader, EmptyState, Stat } from '@/components/ui/misc';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { FilterBar } from '@/components/app/filters';
import { Money, fmtDate } from '@/components/app/money';
import { sp } from '@/components/app/period';
import { SHIPMENT_STATUSES, humanize } from '@/lib/constants';
import { sum } from '@/lib/calc/money';

export const metadata = { title: 'Shipments & import costs' };

export default async function Shipments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const { rows, transit } = await tenant(async (tx) => ({ rows: await listShipments(tx, { q: sp(p.q), status: sp(p.status) }), transit: await inTransit(tx) }));
  return (
    <>
      <PageHeader title="Shipments & import costs" description="Track freight, customs, duties and every import cost; allocate them to products by value, weight, volume, quantity or manual shares." actions={<Button asChild><Link href="/shipments/new"><Plus /> New shipment</Link></Button>} />
      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="In transit (units)" value={sum(transit.map((t) => t.quantity - t.accounted)).toFixed(0)} sub="Not yet part of sellable stock" href="/inventory?tab=transit" />
          <Stat label="In-transit purchase value" value={<Money value={sum(transit.map((t) => t.purchase_value_base))} currency={cur} />} />
          <Stat label="Capitalised import costs" value={<Money value={sum(rows.map((r) => r.capitalised_costs_base))} currency={cur} />} sub="Part of landed cost" />
          <Stat label="Recoverable import VAT" value={<Money value={sum(rows.map((r) => r.recoverable_tax_base))} currency={cur} />} sub="Receivable, not a product cost" />
        </div>
      )}
      <Card>
        <FilterBar filters={[{ type: 'search', name: 'q', placeholder: 'Reference, tracking or carrier' }, { type: 'select', name: 'status', label: 'Status', options: SHIPMENT_STATUSES.map((s) => ({ value: s, label: humanize(s) })) }]} />
        {rows.length === 0 ? (
          <EmptyState icon={<Ship />} title="No shipments yet" action={<Button asChild><Link href="/shipments/new"><Plus /> New shipment</Link></Button>}>Create a shipment as soon as your goods are booked — then attach freight, customs and broker invoices as they arrive.</EmptyState>
        ) : (
          <Table>
            <THead><tr><Th>Reference</Th><Th>Purchase orders</Th><Th>Carrier</Th><Th>Dispatched</Th><Th>ETA / arrived</Th><Th>Status</Th><Th right>Units</Th><Th right>Import costs</Th></tr></THead>
            <tbody>{rows.map((s) => (
              <Tr key={s.id}>
                <Td><Link href={`/shipments/${s.id}`} className="font-medium hover:underline">{s.reference}</Link>{s.missing_fx > 0 && <Badge tone="amber" className="ml-2">missing FX</Badge>}<div className="text-xs text-muted">{s.tracking_ref}</div></Td>
                <Td muted>{s.po_numbers ?? '—'}</Td><Td muted>{s.carrier ?? '—'}{s.mode ? ` · ${s.mode}` : ''}</Td>
                <Td muted>{fmtDate(s.dispatch_date)}</Td><Td muted>{fmtDate(s.actual_arrival_date ?? s.expected_arrival_date)}</Td>
                <Td><StatusBadge status={s.status} /></Td><Td right>{s.units}</Td><Td right><Money value={s.capitalised_costs_base} currency={cur} /></Td>
              </Tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
