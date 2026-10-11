import Link from 'next/link';
import { ShoppingBag, Plus, Upload, Download } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { listOrders } from '@/lib/services/sales';
import { PageHeader, EmptyState } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/badge';
import { FilterBar } from '@/components/app/filters';
import { Money, fmtDate } from '@/components/app/money';
import { Pagination } from '@/components/app/pagination';
import { sp } from '@/components/app/period';
import { ORDER_STATUSES, PAYMENT_STATUSES, humanize } from '@/lib/constants';

export const metadata = { title: 'Sales & orders' };
const PAGE = 50;

export default async function Sales({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const page = Number(sp(p.page) ?? 1);
  const { rows, channels, campaigns } = await tenant(async (tx) => ({
    rows: await listOrders(tx, { q: sp(p.q), status: sp(p.status), paymentStatus: sp(p.paymentStatus), channelId: sp(p.channel), campaignId: sp(p.campaign), variantId: sp(p.variant), from: sp(p.from), to: sp(p.to), recognized: p.recognized === '1', limit: PAGE, offset: (page - 1) * PAGE }),
    channels: await tx.many<{ id: string; name: string }>('select id, name from sales_channels where business_id = $1 order by name', [tx.businessId]),
    campaigns: await tx.many<{ id: string; name: string }>('select id, name from campaigns where business_id = $1 order by name', [tx.businessId]),
  }));
  const total = Number(rows[0]?.total_count ?? 0);
  const exportQs = new URLSearchParams(Object.entries(p).filter(([, v]) => typeof v === 'string') as [string, string][]);
  return (
    <>
      <PageHeader
        title="Sales & customer orders"
        description="Payment and delivery are tracked separately. Revenue counts only for completed business events."
        actions={<><Button asChild variant="secondary" size="sm"><a href={`/api/export/sales?${exportQs}`}><Download /> CSV</a></Button><Button asChild variant="secondary" size="sm"><Link href="/sales/import"><Upload /> Import CSV</Link></Button><Button asChild><Link href="/sales/new"><Plus /> Record sale</Link></Button></>}
      />
      <Card>
        <FilterBar filters={[
          { type: 'search', name: 'q', placeholder: 'Order no., customer, tracking' },
          { type: 'select', name: 'status', label: 'Order', options: ORDER_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          { type: 'select', name: 'paymentStatus', label: 'Payment', options: PAYMENT_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          { type: 'select', name: 'channel', label: 'Channel', options: channels.map((c) => ({ value: c.id, label: c.name })) },
          { type: 'select', name: 'campaign', label: 'Campaign', options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
          { type: 'select', name: 'recognized', label: 'Recognised', options: [{ value: '1', label: 'Recognised sales only' }] },
          { type: 'date', name: 'from', label: 'From' }, { type: 'date', name: 'to', label: 'To' },
        ]} />
        {rows.length === 0 ? (
          <EmptyState icon={<ShoppingBag />} title={Object.keys(p).length ? 'No orders match' : 'No sales yet'} action={<Button asChild><Link href="/sales/new"><Plus /> Record sale</Link></Button>}>Record orders manually or import a CSV export from your shop.</EmptyState>
        ) : (
          <>
            <Table>
              <THead><tr><Th>Order</Th><Th>Date</Th><Th>Customer</Th><Th>Channel</Th><Th>Status</Th><Th>Payment</Th><Th right>Units</Th><Th right>Total (incl. VAT)</Th><Th right>Net excl. VAT</Th></tr></THead>
              <tbody>{rows.map((o) => (
                <Tr key={o.id}>
                  <Td><Link href={`/sales/${o.id}`} className="font-medium hover:underline">{o.order_number}</Link>{o.campaign_name && <div className="text-xs text-muted">{o.campaign_name}</div>}</Td>
                  <Td muted className="whitespace-nowrap">{fmtDate(o.order_date)}</Td>
                  <Td muted>{o.customer_name ?? '—'}</Td>
                  <Td muted>{o.channel_name ?? '—'}</Td>
                  <Td><StatusBadge status={o.status} /></Td>
                  <Td><StatusBadge status={o.payment_status} /><div className="text-[11px] text-muted">{humanize(o.payment_method)}</div></Td>
                  <Td right>{o.units}</Td>
                  <Td right>{Number(o.total_incl_tax).toFixed(2)} {o.currency}</Td>
                  <Td right><Money value={Number(o.gross_merch_base) - Number(o.discounts_base) + Number(o.shipping_revenue_base) - Number(o.refunds_base)} currency={cur} /></Td>
                </Tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE} total={total} basePath="/sales" params={p} />
          </>
        )}
      </Card>
    </>
  );
}
