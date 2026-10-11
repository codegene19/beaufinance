import Link from 'next/link';
import { Pencil, PackageCheck, Plus, Ship } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { getPurchaseOrder } from '@/lib/services/purchasing';
import { landedBreakdownForPo } from '@/lib/services/landed';
import { defaultFxRate } from '@/lib/services/business';
import { addSupplierPaymentAction, deleteSupplierPaymentAction, setPoStatusAction, deletePurchaseOrderAction } from '@/app/actions/purchasing';
import { PageHeader, Stat, KV, Callout } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { ConfirmButton } from '@/components/ui/confirm';
import { Money, fmtDate } from '@/components/app/money';
import { PaymentDialog } from '@/components/app/payment-dialog';
import { StatusSelect } from '@/components/app/status-select';
import { LandedBreakdown } from '@/components/app/landed-breakdown';
import { categoryLabel, humanize } from '@/lib/constants';
import { D } from '@/lib/calc/money';

export const metadata = { title: 'Purchase order' };

export default async function PODetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const data = await tenant(async (tx) => {
    const d = await getPurchaseOrder(tx, id);
    return { ...d, breakdown: await landedBreakdownForPo(tx, id), rate: await defaultFxRate(tx, d.po.currency) };
  });
  const { po, items, payments, shipments, expenses, breakdown, receipts } = data;
  const canReceive = !['draft', 'cancelled', 'received'].includes(po.status);
  const statusOptions = ['draft', 'ordered', 'partially_paid', 'paid', 'in_production', 'shipped', 'cancelled', ...(po.status === 'received' ? ['received'] : [])].map((s) => ({ value: s, label: humanize(s) }));
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/purchase-orders" className="hover:underline">Purchase orders</Link>}
        title={po.po_number}
        description={<>Supplier <Link className="underline" href={`/suppliers/${po.supplier_id}`}>{po.supplier_name}</Link> · ordered {fmtDate(po.order_date)} · {po.currency} at {Number(po.fx_rate)} {cur}</>}
        actions={
          <>
            {po.status === 'received' ? <StatusBadge status="received" /> : <StatusSelect value={po.status} options={statusOptions} action={setPoStatusAction.bind(null, id)} />}
            {po.status !== 'cancelled' && <Button asChild variant="secondary" size="sm"><Link href={`/purchase-orders/${id}/edit`}><Pencil /> Edit</Link></Button>}
            {canReceive && <Button asChild size="sm"><Link href={`/purchase-orders/${id}/receive`}><PackageCheck /> Receive goods</Link></Button>}
            <ConfirmButton action={deletePurchaseOrderAction.bind(null, id)} title="Delete purchase order?" description="Only orders without payments, costs, shipments or receipts can be deleted. Otherwise cancel it to keep the audit trail." confirmLabel="Delete" redirectTo="/purchase-orders" successMessage="Deleted">Delete</ConfirmButton>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Committed (order value)" value={`${Number(po.subtotal).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ${po.currency}`} sub={<><Money value={po.subtotal_base} currency={cur} /> at accounting rate</>} />
        <Stat label="Paid" value={`${Number(po.paid).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ${po.currency}`} sub={<><Money value={po.paid_base} currency={cur} /> actual cash</>} />
        <Stat label="Outstanding liability" tone={Number(po.outstanding) > 0 ? 'warning' : 'default'} value={`${Number(po.outstanding).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ${po.currency}`} sub={<>≈ <Money value={po.outstanding_base} currency={cur} /></>} />
        <Stat label="Received inventory" value={`${po.units_sellable} sellable`} sub={`${po.units_accounted} of ${po.units_ordered} units accounted for`} />
      </div>
      {Number(po.deposit_due) > 0 && D(po.paid).lessThan(D(po.deposit_due)) && po.status !== 'cancelled' && <Callout tone="warning" className="mb-4">Deposit of {po.deposit_due} {po.currency} not fully paid yet.</Callout>}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Products" />
          <Table>
            <THead><tr><Th>Product</Th><Th right>Ordered</Th><Th right>Unit price</Th><Th right>Line total</Th><Th right>Shipped</Th><Th right>Received</Th><Th right>Sellable</Th></tr></THead>
            <tbody>{items.map((i: any) => (
              <Tr key={i.po_item_id}>
                <Td><span className="font-medium">{i.product_name}</span> <span className="text-muted">— {i.variant_name}</span><div className="text-xs text-muted">{i.sku}</div></Td>
                <Td right>{i.quantity}</Td><Td right>{Number(i.unit_price)} {po.currency}</Td><Td right>{i.line_total}</Td><Td right>{i.qty_shipped}</Td><Td right>{i.qty_received}</Td><Td right>{i.qty_sellable}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Supplier payments" description="Deposits and balance payments, each at its actual rate." action={po.status !== 'cancelled' && Number(po.outstanding) > 0 && <PaymentDialog title={`Pay ${po.supplier_name}`} currency={po.currency} baseCurrency={cur} outstanding={po.outstanding} defaultRate={data.rate} showDeposit action={addSupplierPaymentAction.bind(null, id)} />} />
          {payments.length === 0 ? <CardBody className="text-sm text-muted">No payments recorded.</CardBody> : (
            <ul className="divide-y divide-line">
              {payments.map((p: any) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div>
                    <div className="font-medium">{Number(p.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {po.currency} {p.is_deposit && <span className="ml-1 text-xs text-champagne-700">deposit</span>}</div>
                    <div className="text-xs text-muted">{fmtDate(p.payment_date)} · rate {Number(p.fx_rate)} · <Money value={p.amount_base} currency={cur} />{p.reference ? ` · ${p.reference}` : ''}</div>
                  </div>
                  <ConfirmButton action={deleteSupplierPaymentAction.bind(null, p.id)} title="Delete payment?" description="This also removes the matching cash movement." confirmLabel="Delete payment" variant="ghost">Delete</ConfirmButton>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line px-5 py-3"><KV className="sm:grid-cols-1" items={[['Expected production', fmtDate(po.expected_production_date)], ['Expected shipment', fmtDate(po.expected_ship_date)], ['Expected arrival', fmtDate(po.expected_arrival_date)], ['Actual delivery', fmtDate(po.actual_delivery_date)]]} /></div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Landed cost breakdown"
          description="Purchase cost + allocated freight, duties and import costs. Recoverable VAT and planned costs are excluded."
          action={
            <>
              <Button asChild variant="secondary" size="sm"><Link href={`/expenses/new?link_type=purchase_order&purchase_order_id=${id}&treatment=product_acquisition`}><Plus /> Add PO cost</Link></Button>
              <Button asChild variant="secondary" size="sm"><Link href={`/shipments/new?po=${id}`}><Ship /> Create shipment</Link></Button>
            </>
          }
        />
        <div className="space-y-6 py-3">
          <div>
            <div className="px-5 pb-2 text-xs font-semibold uppercase tracking-wide text-champagne-700">Purchase order level</div>
            <LandedBreakdown pool={breakdown.poPool as any} currency={cur} includePurchase />
          </div>
          {breakdown.shipPools.map((sp: any) => (
            <div key={sp.id}>
              <div className="px-5 pb-2 text-xs font-semibold uppercase tracking-wide text-champagne-700">Shipment {sp.label} (all lines in the shipment)</div>
              <LandedBreakdown pool={sp} currency={cur} includePurchase={false} />
            </div>
          ))}
          {breakdown.lots.length > 0 && (
            <div>
              <div className="px-5 pb-2 text-xs font-semibold uppercase tracking-wide text-champagne-700">Received lots — landed cost per sellable unit</div>
              <Table>
                <THead><tr><Th>Lot</Th><Th>Product</Th><Th right>Received</Th><Th right>Damaged</Th><Th right>Missing</Th><Th right>Sellable</Th><Th right>Landed total</Th><Th right>Per sellable unit</Th></tr></THead>
                <tbody>{breakdown.lots.map((l: any) => (
                  <Tr key={l.id}><Td className="font-medium">{l.lot_code}</Td><Td muted>{l.product_name} — {l.variant_name}</Td><Td right>{l.qty_received}</Td><Td right>{l.qty_damaged + l.qty_rejected}</Td><Td right>{l.qty_missing}</Td><Td right>{l.qty_sellable}</Td>
                    <Td right><Money value={l.landed_cost_total} currency={cur} /></Td><Td right className="font-semibold"><Money value={l.landed_unit_cost} currency={cur} decimals={4} /></Td></Tr>
                ))}</tbody>
              </Table>
              <p className="px-5 pt-2 text-xs text-muted">Landed cost per sellable unit = cost of all units accounted for (incl. damaged, rejected and missing) ÷ sellable units received.</p>
            </div>
          )}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Linked costs" description="Expenses attached directly to this purchase order." />
          {expenses.length === 0 ? <CardBody className="text-sm text-muted">None. Shipment costs are listed on each shipment.</CardBody> : (
            <Table><tbody>{expenses.map((e: any) => (
              <Tr key={e.id}><Td><Link className="hover:underline" href={`/expenses/${e.id}`}>{e.name}</Link><div className="text-xs text-muted">{categoryLabel(e.category)}</div></Td><Td><StatusBadge status={e.payment_state} /></Td><Td right>{e.amount} {e.currency}</Td></Tr>
            ))}</tbody></Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Shipments & receipts" />
          <CardBody className="space-y-2 text-sm">
            {shipments.length === 0 && receipts.length === 0 && <p className="text-muted">Not shipped yet. Create a shipment to track freight and customs, or receive goods directly.</p>}
            {shipments.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between"><Link href={`/shipments/${s.id}`} className="font-medium hover:underline">{s.reference}</Link><span className="flex items-center gap-2 text-muted">ETA {fmtDate(s.actual_arrival_date ?? s.expected_arrival_date)} <StatusBadge status={s.status} /></span></div>
            ))}
            {receipts.map((r: any) => <div key={r.id} className="text-muted">Goods received {fmtDate(r.received_date)}{r.notes ? ` — ${r.notes}` : ''}</div>)}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
