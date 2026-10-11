import Link from 'next/link';
import { Plus } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { marketingAnalysis } from '@/lib/services/marketing';
import { listExpenses } from '@/lib/services/expenses';
import { listOrders } from '@/lib/services/sales';
import { deleteCampaignAction } from '@/app/actions/operations';
import { PageHeader, Stat, Callout } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { ConfirmButton } from '@/components/ui/confirm';
import { Money, Pct, fmtDate } from '@/components/app/money';
import { CampaignForm } from '../campaign-form';
import { variantOptions } from '../variants';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export const metadata = { title: 'Campaign' };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const data = await tenant(async (tx) => ({
    c: await tx.one('select * from campaigns where id = $1 and business_id = $2', [id, tx.businessId], 'Campaign not found'),
    products: await tx.many('select variant_id, manual_share_pct from campaign_products where campaign_id = $1', [id]),
    mk: await marketingAnalysis(tx, {}),
    expenses: await listExpenses(tx, { campaignId: id }),
    orders: await listOrders(tx, { campaignId: id, limit: 100 }),
    variants: await variantOptions(tx),
  }));
  const perf = data.mk.campaigns.find((x) => x.id === id)!;
  const c = data.c;
  const initial = { name: c.name, channel: c.channel, start_date: s(c.start_date), end_date: s(c.end_date), planned_budget: c.planned_budget, is_prelaunch: c.is_prelaunch, allocation_method: c.allocation_method, sessions: s(c.sessions), notes: s(c.notes), products: data.products.map((p: any) => ({ variant_id: p.variant_id, manual_share_pct: p.manual_share_pct ? String(Number(p.manual_share_pct)) : '' })) };
  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing" className="hover:underline">Marketing</Link>} title={c.name} description={`${fmtDate(c.start_date)} → ${c.end_date ? fmtDate(c.end_date) : 'ongoing'}`}
        actions={<><Button asChild size="sm"><Link href={`/expenses/new?treatment=marketing&category=paid_advertising&link_type=campaign&campaign_id=${id}`}><Plus /> Record spend</Link></Button><ConfirmButton action={deleteCampaignAction.bind(null, id)} title="Delete campaign?" description="Only campaigns without recorded spend can be deleted. Attributed orders keep their data but lose the link." confirmLabel="Delete" redirectTo="/marketing" successMessage="Deleted">Delete</ConfirmButton></>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Spend" value={<Money value={perf.spend} currency={cur} />} sub={<>of <Money value={perf.planned_budget} currency={cur} /> budget</>} />
        <Stat label="CPA" value={<Money value={perf.cpa} currency={cur} />} sub={`${perf.orders} attributed orders`} />
        <Stat label="Delivered-order CPA" value={<Money value={perf.deliveredCpa} currency={cur} />} sub={`${perf.deliveredOrders} delivered`} />
        <Stat label="ROAS" value={perf.roas ? `${perf.roas.toDecimalPlaces(2)}×` : '—'} sub={<>Revenue <Money value={perf.revenue} currency={cur} /></>} hint="Attributed revenue ÷ spend. Not proof of incremental profit." />
        <Stat label="Est. profit after ads" value={<Money value={perf.profitAfterAds} currency={cur} />} tone={perf.profitAfterAds.lessThan(0) ? 'negative' : 'positive'} sub={<>Conv. <Pct value={perf.conversionRatePct} /></>} />
      </div>
      {perf.allocationNote && <Callout tone="info" className="mb-4">{perf.allocationNote}</Callout>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Spend (expenses)" />
          {data.expenses.length === 0 ? <CardBody className="text-sm text-muted">No spend recorded.</CardBody> : (
            <Table><tbody>{data.expenses.map((e) => <Tr key={e.id}><Td><Link className="hover:underline" href={`/expenses/${e.id}`}>{e.name}</Link><div className="text-xs text-muted">{fmtDate(e.date_incurred)}</div></Td><Td><StatusBadge status={e.payment_state} /></Td><Td right><Money value={e.amount_base} currency={cur} /></Td></Tr>)}</tbody></Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Attributed orders" />
          {data.orders.length === 0 ? <CardBody className="text-sm text-muted">No orders attributed yet. Choose this campaign when recording a sale.</CardBody> : (
            <Table><THead><tr><Th>Order</Th><Th>Status</Th><Th right>Net excl. VAT</Th></tr></THead><tbody>{data.orders.map((o) => <Tr key={o.id}><Td><Link className="hover:underline" href={`/sales/${o.id}`}>{o.order_number}</Link><div className="text-xs text-muted">{fmtDate(o.order_date)}</div></Td><Td><StatusBadge status={o.status} /></Td><Td right><Money value={Number(o.gross_merch_base) - Number(o.discounts_base) + Number(o.shipping_revenue_base) - Number(o.refunds_base)} currency={cur} /></Td></Tr>)}</tbody></Table>
          )}
        </Card>
      </div>
      <h2 className="mb-3 mt-6 font-display text-2xl font-semibold">Edit campaign</h2>
      <CampaignForm id={id} initial={initial} variants={data.variants} />
    </>
  );
}
