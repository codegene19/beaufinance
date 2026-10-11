import Link from 'next/link';
import { tenant, getAppContext } from '@/lib/app-context';
import { getSupplier } from '@/lib/services/suppliers';
import { listPurchaseOrders } from '@/lib/services/purchasing';
import { archiveSupplierAction, deleteSupplierAction } from '@/app/actions/catalog';
import { PageHeader, Stat } from '@/components/ui/misc';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmButton } from '@/components/ui/confirm';
import { Money, fmtDate } from '@/components/app/money';
import { SupplierForm } from '../supplier-form';
import { sum } from '@/lib/calc/money';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export const metadata = { title: 'Supplier' };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const data = await tenant(async (tx) => ({
    supplier: await getSupplier(tx, id),
    pos: await listPurchaseOrders(tx, { supplierId: id }),
    currencies: (await tx.many<{ code: string }>('select code from currencies where business_id = $1 order by code', [tx.businessId])).map((c) => c.code),
  }));
  const sup = data.supplier;
  const initial = Object.fromEntries(['name', 'country', 'contact_name', 'email', 'phone', 'address', 'currency', 'payment_terms', 'default_deposit_pct', 'lead_time_days', 'min_order_qty', 'notes'].map((k) => [k, s(sup[k])]));
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/suppliers" className="hover:underline">Suppliers</Link>}
        title={sup.name}
        actions={
          <>
            <ConfirmButton action={archiveSupplierAction.bind(null, id, !sup.is_archived)} danger={false} title={sup.is_archived ? 'Restore supplier?' : 'Archive supplier?'} description="Archived suppliers are hidden from lists but keep their full history." confirmLabel={sup.is_archived ? 'Restore' : 'Archive'} successMessage="Updated">{sup.is_archived ? 'Restore' : 'Archive'}</ConfirmButton>
            <ConfirmButton action={deleteSupplierAction.bind(null, id)} title="Delete supplier?" description="Only suppliers without purchase orders can be deleted. This cannot be undone." confirmLabel="Delete" redirectTo="/suppliers" successMessage="Supplier deleted">Delete</ConfirmButton>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Committed" value={<Money value={sum(data.pos.filter((p) => p.status !== 'cancelled').map((p) => p.subtotal_base))} currency={cur} />} />
        <Stat label="Paid" value={<Money value={sum(data.pos.map((p) => p.paid_base))} currency={cur} />} />
        <Stat label="Outstanding" tone="warning" value={<Money value={sum(data.pos.map((p) => p.outstanding_base))} currency={cur} />} />
      </div>
      <Card className="mb-6">
        <CardHeader title="Purchase orders" action={<Link className="text-sm text-sage-700 hover:underline" href={`/purchase-orders/new?supplier=${id}`}>New purchase order</Link>} />
        {data.pos.length === 0 ? <p className="p-5 text-sm text-muted">No purchase orders yet.</p> : (
          <Table>
            <THead><tr><Th>PO</Th><Th>Date</Th><Th>Status</Th><Th right>Total</Th><Th right>Paid</Th><Th right>Outstanding</Th></tr></THead>
            <tbody>{data.pos.map((p) => (
              <Tr key={p.id}><Td><Link className="font-medium hover:underline" href={`/purchase-orders/${p.id}`}>{p.po_number}</Link></Td><Td muted>{fmtDate(p.order_date)}</Td><Td><StatusBadge status={p.status} /></Td>
                <Td right>{p.subtotal} {p.currency}</Td><Td right>{p.paid} {p.currency}</Td><Td right>{p.outstanding} {p.currency}</Td></Tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <h2 className="mb-3 font-display text-2xl font-semibold">Edit details</h2>
      <SupplierForm id={id} initial={initial} currencies={data.currencies} />
    </>
  );
}
