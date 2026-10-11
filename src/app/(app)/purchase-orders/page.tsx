import Link from 'next/link';
import { ClipboardList, Plus } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { listPurchaseOrders } from '@/lib/services/purchasing';
import { listSuppliers } from '@/lib/services/suppliers';
import { PageHeader, EmptyState, Stat } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/badge';
import { FilterBar } from '@/components/app/filters';
import { Money, fmtDate } from '@/components/app/money';
import { sp } from '@/components/app/period';
import { PO_STATUSES, humanize } from '@/lib/constants';
import { sum } from '@/lib/calc/money';

export const metadata = { title: 'Purchase orders' };

export default async function POs({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const { rows, suppliers } = await tenant(async (tx) => ({ rows: await listPurchaseOrders(tx, { q: sp(p.q), status: sp(p.status), supplierId: sp(p.supplier), from: sp(p.from), to: sp(p.to) }), suppliers: await listSuppliers(tx) }));
  const live = rows.filter((r) => r.status !== 'cancelled');
  return (
    <>
      <PageHeader title="Purchase orders" description="Committed costs, cash paid, remaining liabilities and received inventory are tracked separately." actions={<Button asChild><Link href="/purchase-orders/new"><Plus /> Create purchase order</Link></Button>} />
      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Committed value" value={<Money value={sum(live.map((r) => r.subtotal_base))} currency={cur} />} sub="Accounting rate, excl. import costs" />
          <Stat label="Paid" value={<Money value={sum(rows.map((r) => r.paid_base))} currency={cur} />} sub="Actual cash at payment rates" />
          <Stat label="Outstanding" tone="warning" value={<Money value={sum(rows.map((r) => r.outstanding_base))} currency={cur} />} />
          <Stat label="Units received" value={`${sum(live.map((r) => r.units_sellable)).toFixed(0)} / ${sum(live.map((r) => r.units_ordered)).toFixed(0)}`} sub="Sellable / ordered" />
        </div>
      )}
      <Card>
        <FilterBar filters={[{ type: 'search', name: 'q', placeholder: 'Search PO or supplier' }, { type: 'select', name: 'status', label: 'Status', options: PO_STATUSES.map((s) => ({ value: s, label: humanize(s) })) }, { type: 'select', name: 'supplier', label: 'Supplier', options: suppliers.map((s) => ({ value: s.id, label: s.name })) }, { type: 'date', name: 'from', label: 'From' }, { type: 'date', name: 'to', label: 'To' }]} />
        {rows.length === 0 ? (
          <EmptyState icon={<ClipboardList />} title="No purchase orders" action={<Button asChild><Link href="/purchase-orders/new"><Plus /> Create purchase order</Link></Button>}>Record your bulk order with all its products, the agreed exchange rate and the deposit.</EmptyState>
        ) : (
          <Table>
            <THead><tr><Th>PO</Th><Th>Supplier</Th><Th>Ordered</Th><Th>Arrival</Th><Th>Status</Th><Th right>Total</Th><Th right>Paid</Th><Th right>Outstanding</Th><Th right>Received</Th></tr></THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/purchase-orders/${r.id}`} className="font-medium hover:text-sage-700 hover:underline">{r.po_number}</Link></Td>
                  <Td muted>{r.supplier_name}</Td>
                  <Td muted>{fmtDate(r.order_date)}</Td>
                  <Td muted>{fmtDate(r.actual_delivery_date ?? r.expected_arrival_date)}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td right>{Number(r.subtotal).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {r.currency}<div className="text-xs text-muted"><Money value={r.subtotal_base} currency={cur} /></div></Td>
                  <Td right>{Number(r.paid).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</Td>
                  <Td right className={Number(r.outstanding) > 0 ? 'text-amber-700' : ''}>{Number(r.outstanding).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</Td>
                  <Td right>{r.units_accounted}/{r.units_ordered}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
