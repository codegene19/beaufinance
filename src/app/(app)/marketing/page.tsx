import Link from 'next/link';
import { Megaphone, Plus } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { marketingAnalysis } from '@/lib/services/marketing';
import { PageHeader, EmptyState, Stat, Callout } from '@/components/ui/misc';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Money, Pct, fmtDate } from '@/components/app/money';
import { PeriodPicker } from '@/components/app/filters';
import { resolvePeriod } from '@/components/app/period';
import { GroupedBars } from '@/components/app/charts';
import { CAMPAIGN_CHANNELS } from '@/lib/constants';
import { sum, formatMoney } from '@/lib/calc/money';

export const metadata = { title: 'Advertising & marketing' };

export default async function Marketing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const period = resolvePeriod(sp, 'all');
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const m = await tenant((tx) => marketingAnalysis(tx, period));
  const c = m.campaigns;
  const totalOrders = c.reduce((a, x) => a + x.orders, 0);
  const totalRev = sum(c.map((x) => x.revenue));
  const prelaunch = sum(c.filter((x) => x.is_prelaunch).map((x) => x.spend));
  const spreadUnits = ctx.settings.prelaunch_marketing_spread_units;
  return (
    <>
      <PageHeader title="Advertising & marketing" description={`Spend, attribution and profit after advertising · ${period.label}`} actions={<><PeriodPicker withBucket={false} defaultPreset="all" /><Button asChild variant="secondary"><Link href="/expenses/new?treatment=marketing&category=paid_advertising&link_type=campaign">Record ad spend</Link></Button><Button asChild><Link href="/marketing/new"><Plus /> New campaign</Link></Button></>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total marketing spend" value={<Money value={m.totalSpend} currency={cur} />} sub="Committed marketing expenses" href="/expenses?treatment=marketing" />
        <Stat label="Attributed orders" value={totalOrders} sub={<>Blended CPA {totalOrders ? formatMoney(sum(c.map((x) => x.spend)).div(totalOrders), cur) : '—'}</>} href="/sales?recognized=1" />
        <Stat label="Attributed net revenue" value={<Money value={totalRev} currency={cur} />} sub="Recognised, excl. VAT" />
        <Stat label="Unallocated marketing" value={<Money value={m.unallocatedTotal} currency={cur} />} sub="Pre-launch or unlinked; never added to unit costs" tone={m.unallocatedTotal.greaterThan(0) ? 'warning' : 'default'} />
      </div>
      <Callout tone="info" className="mb-4">
        Attributed revenue and ROAS show sales linked to a campaign — they do <strong>not</strong> prove the campaign caused those sales or generated incremental profit. Profit after ads deducts each campaign's spend once from the contribution of its attributed orders.
      </Callout>
      {prelaunch.greaterThan(0) && spreadUnits && (
        <p className="mb-4 text-sm text-muted">Pre-launch marketing of {formatMoney(prelaunch, cur)} spread over {spreadUnits} expected units ≈ <strong>{formatMoney(prelaunch.div(spreadUnits), cur)} per unit</strong> (informational, shown in the pricing calculator — not deducted twice).</p>
      )}
      {c.length === 0 ? (
        <Card><EmptyState icon={<Megaphone />} title="No campaigns yet" action={<Button asChild><Link href="/marketing/new"><Plus /> New campaign</Link></Button>}>Create campaigns for Meta, TikTok, Google, influencers… then link ad invoices and attribute orders.</EmptyState></Card>
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader title="Spend vs. attributed revenue vs. profit after ads" />
            <div className="p-5"><GroupedBars data={c.filter((x) => x.spend.greaterThan(0) || x.orders).map((x) => ({ name: x.name, spend: x.spend.toNumber(), revenue: x.revenue.toDecimalPlaces(2).toNumber(), profit: x.profitAfterAds.toDecimalPlaces(2).toNumber() }))} xKey="name" currency={cur} keys={[{ key: 'spend', name: 'Spend', color: '#b8955a' }, { key: 'revenue', name: 'Attributed revenue', color: '#4a6c4f' }, { key: 'profit', name: 'Est. profit after ads', color: '#2f5d73' }]} /></div>
          </Card>
          <Card>
            <Table>
              <THead><tr><Th>Campaign</Th><Th>Dates</Th><Th right>Budget</Th><Th right>Spend</Th><Th right>Orders</Th><Th right>Delivered</Th><Th right>CPA</Th><Th right>Delivered CPA</Th><Th right>ROAS</Th><Th right>Conv.</Th><Th right>Est. profit after ads</Th></tr></THead>
              <tbody>{c.map((x) => (
                <Tr key={x.id}>
                  <Td><Link href={`/marketing/${x.id}`} className="font-medium hover:underline">{x.name}</Link><div className="text-xs text-muted">{CAMPAIGN_CHANNELS.find((ch) => ch.value === x.channel)?.label}{x.is_prelaunch && <Badge tone="gold" className="ml-1">pre-launch</Badge>}</div></Td>
                  <Td muted className="text-xs whitespace-nowrap">{fmtDate(x.start_date)} → {x.end_date ? fmtDate(x.end_date) : 'ongoing'}</Td>
                  <Td right><Money value={x.planned_budget} currency={cur} /></Td>
                  <Td right className={x.spend.greaterThan(x.planned_budget) && x.planned_budget.greaterThan(0) ? 'text-amber-700' : ''}><Money value={x.spend} currency={cur} /></Td>
                  <Td right>{x.orders}</Td><Td right>{x.deliveredOrders}</Td>
                  <Td right><Money value={x.cpa} currency={cur} /></Td><Td right><Money value={x.deliveredCpa} currency={cur} /></Td>
                  <Td right>{x.roas ? `${x.roas.toDecimalPlaces(2)}×` : '—'}</Td>
                  <Td right><Pct value={x.conversionRatePct} /></Td>
                  <Td right><Money value={x.profitAfterAds} currency={cur} signed /></Td>
                </Tr>
              ))}</tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
