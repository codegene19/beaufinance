import Link from 'next/link';
import { Plus, PackageCheck } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { getShipment, shippableLines } from '@/lib/services/shipments';
import { deleteShipmentAction } from '@/app/actions/purchasing';
import { PageHeader, Callout } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { ConfirmButton } from '@/components/ui/confirm';
import { Money, fmtDate } from '@/components/app/money';
import { LandedBreakdown } from '@/components/app/landed-breakdown';
import { ShipmentForm } from '../shipment-form';
import { ItemsEditor } from './items-editor';
import { categoryLabel, treatmentLabel } from '@/lib/constants';
import { sum } from '@/lib/calc/money';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export const metadata = { title: 'Shipment' };

export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ po?: string }> }) {
  const { id } = await params;
  const { po } = await searchParams;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const data = await tenant(async (tx) => ({ ...(await getShipment(tx, id)), lines: await shippableLines(tx, id) }));
  const { shipment, items, expenses, pool, lines } = data;
  const linesWithOverrides = lines.map((l: any) => ({ ...l, total_weight_kg: items.find((i: any) => i.purchase_order_item_id === l.po_item_id)?.total_weight_kg ?? null, total_volume_m3: items.find((i: any) => i.purchase_order_item_id === l.po_item_id)?.total_volume_m3 ?? null }));
  const poIds = Array.from(new Set(items.map((i: any) => i.purchase_order_id)));
  const receivable = items.filter((i: any) => i.quantity > i.qty_accounted);
  const capitalised = expenses.filter((e: any) => e.treatment === 'product_acquisition' && e.commitment === 'committed');
  const initial = Object.fromEntries(['reference', 'carrier', 'mode', 'tracking_ref', 'status', 'dispatch_date', 'expected_arrival_date', 'actual_arrival_date', 'default_allocation_method', 'notes'].map((k) => [k, s(shipment[k])]));
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/shipments" className="hover:underline">Shipments</Link>}
        title={shipment.reference}
        description={`${shipment.carrier ?? 'Carrier not set'} · dispatched ${fmtDate(shipment.dispatch_date)} · ETA ${fmtDate(shipment.expected_arrival_date)}`}
        actions={
          <>
            <StatusBadge status={shipment.status} />
            <Button asChild variant="secondary" size="sm"><Link href={`/expenses/new?link_type=shipment&shipment_id=${id}&treatment=product_acquisition&category=freight`}><Plus /> Add import cost</Link></Button>
            {receivable.length > 0 && poIds.map((p: any) => (
              <Button key={p} asChild size="sm"><Link href={`/purchase-orders/${p}/receive`}><PackageCheck /> Receive {items.find((i: any) => i.purchase_order_id === p)?.po_number}</Link></Button>
            ))}
            <ConfirmButton action={deleteShipmentAction.bind(null, id)} title="Delete shipment?" description="Only shipments without costs or received goods can be deleted." confirmLabel="Delete" redirectTo="/shipments" successMessage="Deleted">Delete</ConfirmButton>
          </>
        }
      />
      {shipment.status !== 'received' && items.length > 0 && <Callout tone="info" className="mb-4">Goods on this shipment are <strong>in transit</strong>: they are not part of sellable stock until you receive them.</Callout>}

      <Card className="mb-4">
        <CardHeader title="Contents" description="Which purchase-order lines travel in this shipment. Weight and volume are needed for those allocation methods." />
        <ItemsEditor shipmentId={id} lines={linesWithOverrides as any} preselectPo={items.length === 0 ? po : undefined} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Import costs" description="Every invoice attached to this shipment. Capitalised costs flow into landed cost; recoverable VAT does not." action={<Button asChild variant="secondary" size="sm"><Link href={`/expenses/new?link_type=shipment&shipment_id=${id}&treatment=product_acquisition&category=freight`}><Plus /> Add cost</Link></Button>} />
          {expenses.length === 0 ? <CardBody className="text-sm text-muted">No costs yet. Add freight, insurance, duties, broker and handling fees as invoices arrive — even before the goods do.</CardBody> : (
            <Table>
              <THead><tr><Th>Cost</Th><Th>Treatment</Th><Th>Allocation</Th><Th>Payment</Th><Th right>Amount</Th><Th right>In {cur}</Th></tr></THead>
              <tbody>{expenses.map((e: any) => (
                <Tr key={e.id}>
                  <Td><Link href={`/expenses/${e.id}`} className="font-medium hover:underline">{e.name}</Link><div className="text-xs text-muted">{categoryLabel(e.category)} · {fmtDate(e.date_incurred)}</div></Td>
                  <Td muted className="text-xs">{treatmentLabel(e.treatment)}{e.commitment === 'planned' && <Badge className="ml-1">planned</Badge>}</Td>
                  <Td muted className="text-xs">{e.treatment === 'product_acquisition' ? (e.allocation_method ?? `${shipment.default_allocation_method} (default)`) : '—'}</Td>
                  <Td><StatusBadge status={e.payment_state} /></Td>
                  <Td right>{e.amount} {e.currency}</Td>
                  <Td right>{e.amount_base === null ? <Badge tone="amber">missing FX</Badge> : <Money value={e.amount_base} currency={cur} />}</Td>
                </Tr>
              ))}</tbody>
            </Table>
          )}
          <div className="flex justify-end gap-6 border-t border-line px-5 py-3 text-sm"><span className="text-muted">Capitalised total</span><span className="num font-semibold"><Money value={sum(capitalised.map((e: any) => e.amount_base))} currency={cur} /></span></div>
        </Card>
        <Card>
          <CardHeader title="Edit shipment" />
          <CardBody><ShipmentForm id={id} initial={initial} /></CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Allocation of shipment costs" description="How each shipment cost is split across the products on board. Purchase cost and PO-level costs are shown on each purchase order." />
        <div className="py-3"><LandedBreakdown pool={pool as any} currency={cur} includePurchase={false} /></div>
      </Card>
    </>
  );
}
