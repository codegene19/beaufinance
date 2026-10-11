import Link from 'next/link';
import { RefreshCcw } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { reorderPlan } from '@/lib/services/reorder';
import { PageHeader, EmptyState, Stat, Callout } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Money, fmtDate } from '@/components/app/money';
import { cn } from '@/components/ui/cn';

export const metadata = { title: 'Reorder planning' };
const RANK = { urgent: 0, order_soon: 1, plan: 2, insufficient_data: 3, healthy: 4 } as const;
const BORDER: Record<string, string> = { urgent: 'border-l-rose-600', order_soon: 'border-l-champagne-500', plan: 'border-l-sky-700', insufficient_data: 'border-l-line-strong', healthy: 'border-l-sage-500' };

export default async function Reorder() {
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const plan = await tenant((tx) => reorderPlan(tx));
  const rows = [...plan.results].sort((a, b) => RANK[a.result.status] - RANK[b.result.status]);
  const count = (s: string) => rows.filter((r) => r.result.status === s).length;
  return (
    <>
      <PageHeader title="Reorder planning" description={`Based on the last ${plan.settings.sales_history_days} days of demand, supplier + shipping lead times, safety stock and ${plan.settings.target_coverage_days} days target coverage. Inventory need and cash affordability are shown separately.`} actions={<Button asChild variant="secondary" size="sm"><Link href="/settings?tab=rules">Adjust planning rules</Link></Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Urgent" value={count('urgent')} tone={count('urgent') ? 'negative' : 'default'} />
        <Stat label="Order soon" value={count('order_soon')} tone={count('order_soon') ? 'warning' : 'default'} />
        <Stat label="Plan next order" value={count('plan')} />
        <Stat label="Healthy" value={count('healthy')} tone="positive" />
        <Stat label="Cash available for purchases" value={plan.cash.known ? <Money value={plan.cash.balance.minus(plan.liabilities.total).minus(plan.settings.min_cash_reserve)} currency={cur} /> : 'Unknown'} sub="Cash − liabilities − minimum reserve" tone={plan.cash.known ? 'default' : 'warning'} href="/cash-flow" />
      </div>
      {!plan.cash.known && <Callout tone="warning" className="mb-4">Affordability cannot be assessed until a cash balance is established in <Link href="/cash-flow">Cash flow</Link>.</Callout>}
      {rows.length === 0 ? <Card><EmptyState icon={<RefreshCcw />} title="No active products">Activate products to plan replenishment.</EmptyState></Card> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map(({ variant: v, result: r, notes }) => (
            <Card key={v.id} className={cn('border-l-4 p-5', BORDER[r.status])}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><Link href={`/reorder/${v.id}`} className="font-semibold hover:underline">{v.product_name} — {v.variant_name}</Link><div className="text-xs text-muted">{v.sku} · confidence {r.confidence}</div></div>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-2 text-sm text-ink-soft">{r.reasons.join(' ')}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
                {[
                  ['Sales/day', r.avgDailySales.toDecimalPlaces(2).toString()],
                  ['Available', r.available],
                  ['Incoming', r.incomingTotal],
                  ['Reorder pt.', r.reorderPoint],
                  ['Stockout', r.stockoutDate ? fmtDate(r.stockoutDate) : '—'],
                  ['Order by', r.latestOrderDate ? fmtDate(r.latestOrderDate) : '—'],
                ].map(([k, val]) => <div key={k as string}><dt className="text-muted">{k}</dt><dd className="num font-semibold text-ink">{val}</dd></div>)}
              </dl>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
                <span>{r.suggestedQty > 0 ? <>Suggest <strong>{r.suggestedQty}</strong> units · <Money value={r.cost.totalLanded} currency={cur} /> landed{r.cash.affordable === false && <Badge tone="rose" className="ml-2">not affordable now</Badge>}{r.cash.affordable && <Badge tone="sage" className="ml-2">affordable</Badge>}</> : <span className="text-muted">No order quantity suggested</span>}</span>
                <Link href={`/reorder/${v.id}`} className="text-sage-700 hover:underline">Plan & simulate →</Link>
              </div>
              {notes.length > 0 && <p className="mt-2 text-xs text-amber-700">{notes[0]}</p>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
