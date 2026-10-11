import Link from 'next/link';
import { tenant, getAppContext } from '@/lib/app-context';
import { profitAndLoss } from '@/lib/services/finance';
import { PageHeader, Callout } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { Money, Pct } from '@/components/app/money';
import { PeriodPicker } from '@/components/app/filters';
import { resolvePeriod } from '@/components/app/period';
import { PrintButton } from '../print-button';
import { D } from '@/lib/calc/money';
import { categoryLabel } from '@/lib/constants';

export const metadata = { title: 'Profit & loss' };

export default async function PnL({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const period = resolvePeriod(sp, 'ytd');
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const p = await tenant((tx) => profitAndLoss(tx, period));
  const pct = (v: any) => (p.netSales.isZero() ? null : D(v.toString()).div(p.netSales).times(100));
  const Line = ({ label, value, strong, neg, indent, note }: { label: string; value: any; strong?: boolean; neg?: boolean; indent?: boolean; note?: string }) => (
    <div className={`grid grid-cols-[1fr_auto_70px] items-baseline gap-4 py-2 ${strong ? 'border-t border-line-strong font-semibold' : 'border-t border-line/60'} ${indent ? 'pl-5 text-ink-soft' : ''}`}>
      <span>{label}{note && <span className="block text-xs font-normal text-muted">{note}</span>}</span>
      <span className="num text-right"><Money value={neg ? D(value.toString()).negated() : value} currency={cur} signed={strong} /></span>
      <span className="num text-right text-xs text-muted"><Pct value={pct(neg ? D(value.toString()).negated() : value)} /></span>
    </div>
  );
  const opexCats = p.expenseRows.filter((r) => ['operating', 'startup'].includes(r.treatment));
  return (
    <>
      <PageHeader eyebrow={<Link href="/reports" className="no-print hover:underline">Reports</Link>} title="Profit & loss" description={`${ctx.business.name} · ${period.label} · ${cur}, excluding VAT · accrual (management) basis`} actions={<><PeriodPicker withBucket={false} defaultPreset="ytd" /><PrintButton /></>} />
      {p.missingFx > 0 && <Callout tone="warning" className="mb-4">{p.missingFx} expense(s) are missing exchange rates and are not included.</Callout>}
      <Card className="mx-auto max-w-3xl p-6 sm:p-8">
        <div className="mb-2 grid grid-cols-[1fr_auto_70px] gap-4 text-xs font-semibold uppercase tracking-wide text-muted"><span /><span className="text-right">Amount</span><span className="text-right">% net</span></div>
        <Line label="Gross sales" value={p.grossSales} note={`${p.orders} recognised orders · ${p.units} units`} />
        <Line label="Discounts" value={p.discounts} neg indent />
        <Line label="Refunds" value={p.refunds} neg indent />
        <Line label="Net sales (excl. VAT)" value={p.netSales} strong />
        <Line label="Cost of goods sold" value={p.cogs} neg indent note="Batch landed cost of units sold (FIFO/FEFO), net of restocked returns" />
        <Line label="Gross profit" value={p.grossProfit} strong />
        <Line label="Shipping, fulfilment & packaging" value={p.fulfilment} neg indent />
        <Line label="Payment & platform fees" value={p.sellingFees} neg indent />
        <Line label="Per-order variable expenses" value={p.perOrderExpenses} neg indent />
        <Line label="Failed deliveries" value={p.failedDeliveries} neg indent note={`${p.failedDeliveryCount} order(s) cancelled after shipment`} />
        <Line label="Contribution before marketing" value={p.contributionBeforeMarketing} strong />
        <Line label="Advertising & marketing" value={p.marketing} neg indent />
        <Line label="Contribution after marketing" value={p.contributionAfterMarketing} strong />
        <Line label="Operating expenses" value={p.operating} neg indent />
        {opexCats.filter((r) => r.treatment === 'operating').map((r) => <div key={r.category} className="grid grid-cols-[1fr_auto_70px] gap-4 py-1 pl-10 text-xs text-muted"><span>{categoryLabel(r.category)}</span><span className="num text-right"><Money value={r.total} currency={cur} /></span><span /></div>)}
        <Line label="Startup expenses (one-time)" value={p.startup} neg indent />
        <Line label="Inventory write-offs & adjustments" value={p.inventoryLosses} neg indent />
        <Line label="Net operating profit" value={p.netOperatingProfit} strong />
        <div className="mt-6 rounded-lg bg-ivory p-4 text-sm">
          <div className="mb-1 font-semibold">Tax information (as configured — not a tax return)</div>
          <div className="flex justify-between"><span className="text-muted">Output VAT on recognised sales</span><Money value={p.tax.vatCollected} currency={cur} /></div>
          <div className="flex justify-between"><span className="text-muted">Recoverable import VAT recorded</span><Money value={p.tax.recoverableTaxPaid} currency={cur} /></div>
          <div className="flex justify-between"><span className="text-muted">Acquisition costs capitalised into inventory (not expensed)</span><Money value={p.capitalisedAcquisitionCosts} currency={cur} /></div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Sales are recognised {ctx.settings.revenue_recognition.replace(/_/g, ' ')}; refunds, returned stock and return shipping are reported in the period of the original sale. Expenses use the date incurred and include committed (not planned or cancelled) costs.
          Import costs are capitalised into inventory and reach the P&L only as COGS when units are sold. Shared marketing is not allocated in this statement. Actuals only — no forecasts.
        </p>
      </Card>
    </>
  );
}
