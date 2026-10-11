import Link from 'next/link';
import { tenant, getAppContext } from '@/lib/app-context';
import { getOrder } from '@/lib/services/sales';
import { deleteOrderAction, deleteOrderPaymentAction } from '@/app/actions/operations';
import { PageHeader, KV, Callout } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { ConfirmButton } from '@/components/ui/confirm';
import { Money, Pct, fmtDate } from '@/components/app/money';
import { OrderActions } from './order-actions';
import { D } from '@/lib/calc/money';
import { humanize } from '@/lib/constants';

export const metadata = { title: 'Order' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const { order: o, items, allocations, payments, returns, movements } = await tenant((tx) => getOrder(tx, id));
  const revenue = D(o.gross_merch_base).minus(D(o.discounts_base)).plus(D(o.shipping_revenue_base));
  const net = revenue.minus(D(o.refunds_base));
  const cogs = D(o.cogs_shipped_base).minus(D(o.cogs_returned_base));
  const costs = D(o.fulfilment_costs_base).plus(D(o.selling_fees_base)).plus(D(o.return_shipping_base));
  const contribution = net.minus(cogs).minus(costs);
  const recognised = !!o.recognized_date;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/sales" className="hover:underline">Sales</Link>}
        title={`Order ${o.order_number}`}
        description={`${fmtDate(o.order_date)} · ${o.channel_name ?? 'No channel'}${o.campaign_name ? ` · campaign ${o.campaign_name}` : ''} · ${humanize(o.payment_method)}`}
        actions={<><StatusBadge status={o.status} /><StatusBadge status={o.payment_status} />{['pending', 'cancelled'].includes(o.status) && <ConfirmButton action={deleteOrderAction.bind(null, id)} title="Delete order?" description="Only pending or cancelled orders without payments or stock movements can be deleted." confirmLabel="Delete" redirectTo="/sales" successMessage="Order deleted">Delete</ConfirmButton>}</>}
      />
      <Card className="mb-4 p-4"><OrderActions order={o} items={items} allowNegative={ctx.settings.negative_stock_policy === 'allow_with_warning'} /></Card>
      {!recognised && o.status !== 'cancelled' && <Callout tone="info" className="mb-4">Not yet recognised as a sale — revenue and profit count once the order is {ctx.settings.revenue_recognition === 'on_delivery' ? 'delivered' : ctx.settings.revenue_recognition === 'on_shipment' ? 'shipped' : 'paid'}.</Callout>}
      {o.status === 'cancelled' && <Callout tone="warning" className="mb-4">Cancelled{o.shipped_at ? ' after shipment — shipping and fulfilment costs are reported as failed-delivery losses' : ''}. No revenue recognised.</Callout>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Items" />
          <Table>
            <THead><tr><Th>Product</Th><Th right>Qty</Th><Th right>Unit price {o.prices_include_tax ? '(incl. VAT)' : '(excl. VAT)'}</Th><Th right>Discount</Th><Th right>Shipped</Th><Th right>Returned</Th></tr></THead>
            <tbody>{items.map((i: any) => (
              <Tr key={i.id}><Td><span className="font-medium">{i.product_name}</span> — {i.variant_name}<div className="text-xs text-muted">{i.sku}</div></Td><Td right>{i.quantity}</Td><Td right>{i.unit_price}</Td><Td right>{i.line_discount}</Td><Td right>{i.shipped_qty}</Td><Td right>{i.returned_qty}</Td></Tr>
            ))}</tbody>
          </Table>
          <div className="border-t border-line px-5 py-3 text-sm"><KV items={[['Order discount', o.order_discount], ['Shipping charged', o.shipping_charged], ['VAT rate', `${Number(o.tax_rate_pct)}%`], ['Customer total (incl. VAT)', `${o.total_incl_tax} ${o.currency}`], ['Paid', `${o.paid} ${o.currency}`], ['Refunded', `${o.refunded} ${o.currency}`]]} /></div>
        </Card>
        <Card>
          <CardHeader title={recognised ? 'Order profitability (actual)' : 'Order economics (not yet recognised)'} description={`In ${cur}, excluding VAT`} />
          <CardBody>
            <KV className="sm:grid-cols-1" items={[
              ['Revenue', <Money key="a" value={revenue} currency={cur} />],
              ['Refunds', <Money key="b" value={D(o.refunds_base).negated()} currency={cur} />],
              ['Cost of goods (lots)', <Money key="c" value={cogs.negated()} currency={cur} />],
              ['Shipping, fulfilment, packaging', <Money key="d" value={D(o.fulfilment_costs_base).negated()} currency={cur} />],
              ['Payment & platform fees', <Money key="e" value={D(o.selling_fees_base).negated()} currency={cur} />],
              ['Return shipping', <Money key="f" value={D(o.return_shipping_base).negated()} currency={cur} />],
              ['Contribution (before ads)', <Money key="g" value={contribution} currency={cur} signed />],
              ['Contribution margin', <Pct key="h" value={net.isZero() ? null : contribution.div(net).times(100)} />],
            ]} />
            <p className="mt-3 text-xs text-muted">Advertising is not deducted per order here; it is allocated once at campaign / product level.</p>
          </CardBody>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Payments & refunds" />
          {payments.length === 0 ? <CardBody className="text-sm text-muted">No payments recorded.</CardBody> : (
            <ul className="divide-y divide-line">{payments.map((p: any) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div><Badge tone={p.kind === 'refund' ? 'rose' : 'sage'}>{p.kind}</Badge> <span className="num ml-1 font-medium">{p.amount} {o.currency}</span><div className="text-xs text-muted">{fmtDate(p.payment_date)} · {p.method ?? ''} {p.reference ?? ''}</div></div>
                <ConfirmButton action={deleteOrderPaymentAction.bind(null, p.id)} title="Delete this entry?" description="The cash movement is removed too." confirmLabel="Delete" variant="ghost">Delete</ConfirmButton>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Delivery" />
          <CardBody><KV className="sm:grid-cols-1" items={[['Provider', o.delivery_provider], ['Tracking', o.tracking_ref], ['Shipped', fmtDate(o.shipped_at)], ['Delivered', fmtDate(o.delivered_at)], ['Cancelled', fmtDate(o.cancelled_at)], ['Customer', [o.customer_name, o.customer_city].filter(Boolean).join(', ') || '—']]} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Stock traceability" description="Which lots fulfilled this order, at which landed cost." />
          {allocations.length === 0 ? <CardBody className="text-sm text-muted">No stock reserved.</CardBody> : (
            <Table><THead><tr><Th>Lot</Th><Th>Status</Th><Th right>Qty</Th><Th right>Landed / unit</Th></tr></THead>
              <tbody>{allocations.map((a: any) => <Tr key={a.id}><Td className="font-medium">{a.lot_code}</Td><Td><Badge>{a.status}</Badge></Td><Td right>{a.quantity}</Td><Td right><Money value={a.landed_unit_cost} currency={cur} decimals={4} /></Td></Tr>)}</tbody>
            </Table>
          )}
          {movements.length > 0 && <div className="border-t border-line px-5 py-3 text-xs text-muted">{movements.map((m: any) => `${humanize(m.movement_type)} ${m.quantity > 0 ? '+' : ''}${m.quantity} (${m.lot_code})`).join(' · ')}</div>}
        </Card>
        <Card>
          <CardHeader title="Returns" />
          {returns.length === 0 ? <CardBody className="text-sm text-muted">No returns.</CardBody> : (
            <ul className="divide-y divide-line">{returns.map((r: any) => (
              <li key={r.id} className="px-5 py-3 text-sm"><div className="font-medium">{fmtDate(r.return_date)} · refund {r.refund_amount} {o.currency}</div><div className="text-xs text-muted">{r.reason ?? ''} · {(r.items as any[]).map((x) => `${x.quantity} ${x.condition}`).join(', ')}</div></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
