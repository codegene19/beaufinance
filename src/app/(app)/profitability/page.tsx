import Link from 'next/link';
import { tenant, getAppContext } from '@/lib/app-context';
import { productProfitability } from '@/lib/services/finance';
import { PageHeader, Stat, Callout } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/badge';
import { Money, Pct } from '@/components/app/money';
import { PeriodPicker } from '@/components/app/filters';
import { resolvePeriod } from '@/components/app/period';
import { HBars } from '@/components/app/charts';
import { sum } from '@/lib/calc/money';

export const metadata = { title: 'Profitability' };

const ORDER = ['unprofitable', 'break_even', 'below_target', 'profitable', 'insufficient_data'];

export default async function Profitability({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const d = await tenant((tx) => productProfitability(tx, period));
  const rows = [...d.rows].sort((a, b) => ORDER.indexOf(a.classification) - ORDER.indexOf(b.classification) || b.netRevenue.comparedTo(a.netRevenue));
  const productContribution = sum(rows.map((r) => r.contributionAfterAds));
  const fixed = d.pnl.operating.plus(d.pnl.startup);
  const counts = Object.fromEntries(ORDER.map((c) => [c, rows.filter((r) => r.classification === c).length]));
  return (
    <>
      <PageHeader title="Profitability & business health" description={`Actual results from completed sales · ${period.label}. Unit economics use today's landed cost and default price.`} actions={<PeriodPicker withBucket={false} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Profitable" value={counts.profitable} tone="positive" />
        <Stat label="Below target margin" value={counts.below_target} tone="warning" />
        <Stat label="Break-even" value={counts.break_even} />
        <Stat label="Unprofitable" value={counts.unprofitable} tone={counts.unprofitable ? 'negative' : 'default'} />
        <Stat label="Insufficient data" value={counts.insufficient_data} />
      </div>
      <Card className="mb-4">
        <CardHeader title="Product assessment" description="Contribution after allocated advertising, from completed (recognised) sales. Margin = contribution ÷ net revenue excl. VAT." />
        <Table>
          <THead><tr><Th>Product</Th><Th>Assessment</Th><Th right>Units</Th><Th right>Net revenue</Th><Th right>COGS</Th><Th right>Selling costs</Th><Th right>Advertising</Th><Th right>Contribution</Th><Th right>Margin</Th><Th right>Target</Th><Th>Current unit economics</Th></tr></THead>
          <tbody>{rows.map((r) => (
            <Tr key={r.variant.id}>
              <Td><Link className="font-medium hover:underline" href={`/pricing?variant=${r.variant.id}`}>{r.variant.product_name} — {r.variant.variant_name}</Link><div className="text-xs text-muted">{r.variant.sku}</div></Td>
              <Td><StatusBadge status={r.classification} /></Td>
              <Td right>{r.unitsSold}</Td>
              <Td right><Money value={r.netRevenue} currency={cur} /></Td>
              <Td right><Money value={r.cogs} currency={cur} /></Td>
              <Td right><Money value={r.variableCosts} currency={cur} /></Td>
              <Td right><Money value={r.advertising} currency={cur} /></Td>
              <Td right><Money value={r.contributionAfterAds} currency={cur} signed /></Td>
              <Td right><Pct value={r.marginPct} signed /></Td>
              <Td right><Pct value={r.targetMarginPct} dp={0} /></Td>
              <Td className="text-xs">{r.unit ? <><Money value={r.unit.profitPerUnit} currency={cur} />/unit · <Pct value={r.unit.marginPct} /> · markup <Pct value={r.unit.markupPct} dp={0} /> <StatusBadge status={r.unit.status} /></> : <span className="text-muted">{r.variant.current_landed_cost ? 'No default price' : 'No landed cost yet'}</span>}</Td>
            </Tr>
          ))}</tbody>
        </Table>
        <div className="border-t border-line px-5 py-3 text-xs text-muted">
          Products are judged on actual completed sales only: “insufficient data” means no recognised sales or no cost basis yet — no estimate is presented as actual profit.
          Advertising is allocated per campaign rule exactly once; selling costs are order-level costs split by each line's share of order value.
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Does product profit cover the business?" description="A product can have a positive margin and still not cover fixed costs." />
          <CardBody className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Product contribution after allocated ads</span><Money value={productContribution} currency={cur} /></div>
            <div className="flex justify-between"><span>Unallocated marketing (pre-launch / unlinked)</span><Money value={d.unallocatedMarketing.negated()} currency={cur} /></div>
            <div className="flex justify-between"><span>Per-order expenses & failed deliveries</span><Money value={d.pnl.perOrderExpenses.plus(d.pnl.failedDeliveries).negated()} currency={cur} /></div>
            <div className="flex justify-between"><span>Operating & startup expenses</span><Money value={fixed.negated()} currency={cur} /></div>
            <div className="flex justify-between"><span>Inventory losses</span><Money value={d.pnl.inventoryLosses.negated()} currency={cur} /></div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold"><span>Net operating profit</span><Money value={d.pnl.netOperatingProfit} currency={cur} signed /></div>
            {d.unallocatedReasons.length > 0 && <p className="pt-2 text-xs text-muted">Unallocated: {d.unallocatedReasons.map((u) => u.label).join(', ')}.</p>}
            <Link href={`/reports/pnl?period=${period.preset}${period.preset === 'custom' ? `&from=${period.from}&to=${period.to}` : ''}`} className="inline-block pt-2 text-sage-700 hover:underline">Full profit & loss statement →</Link>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Contribution by product" />
          <CardBody><HBars data={rows.filter((r) => r.unitsSold > 0).map((r) => ({ name: r.variant.sku, contribution: r.contributionAfterAds.toDecimalPlaces(2).toNumber() }))} dataKey="contribution" currency={cur} /></CardBody>
        </Card>
      </div>
      {d.pnl.missingFx > 0 && <Callout tone="warning" className="mt-4">{d.pnl.missingFx} expense(s) without exchange rate are excluded.</Callout>}
    </>
  );
}
