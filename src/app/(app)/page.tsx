import Link from 'next/link';
import { Package, ClipboardList, Receipt, ShoppingBag, Ship, RefreshCcw, Sparkles } from 'lucide-react';
import { getAppContext, tenant } from '@/lib/app-context';
import { dashboard } from '@/lib/services/dashboard';
import { resolvePeriod } from '@/components/app/period';
import { PeriodPicker } from '@/components/app/filters';
import { PageHeader, Stat, Callout, EmptyState } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Money, Pct, fmtDate } from '@/components/app/money';
import { TrendChart, HBars, Donut, CashBars, GroupedBars } from '@/components/app/charts';
import { formatMoney, D } from '@/lib/calc/money';
import { categoryLabel } from '@/lib/constants';

export const metadata = { title: 'Overview' };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const period = resolvePeriod(sp);
  const data = await tenant((tx) => dashboard(tx, { from: period.from, to: period.to, bucket: period.bucket }));
  const counts = await tenant((tx) => tx.one<{ products: number; pos: number; orders: number; expenses: number }>(
    `select (select count(*) from products where business_id = $1)::int as products, (select count(*) from purchase_orders where business_id = $1)::int as pos,
            (select count(*) from sales_orders where business_id = $1)::int as orders, (select count(*) from expenses where business_id = $1)::int as expenses`, [tx.businessId]));
  const k = data.kpis;
  const q = (extra: string) => `${extra}${period.from ? `&from=${period.from}` : ''}${period.to ? `&to=${period.to}` : ''}`;
  const isNew = counts.products === 0 && counts.orders === 0 && counts.pos === 0;

  return (
    <>
      <PageHeader
        eyebrow={ctx.business.name}
        title="Overview"
        description={`Figures for ${period.label.toLowerCase()}, calculated from your recorded transactions. Sales count only when recognised (${ctx.settings.revenue_recognition.replace(/_/g, ' ')}).`}
        actions={
          <>
            <PeriodPicker />
            <Button asChild variant="secondary" size="sm"><Link href="/sales/new"><ShoppingBag /> Record sale</Link></Button>
            <Button asChild size="sm"><Link href="/expenses/new"><Receipt /> Record expense</Link></Button>
          </>
        }
      />

      {isNew && (
        <Card className="mb-6 overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1.2fr_2fr]">
            <div className="bg-sage-800 p-6 text-sage-50">
              <Sparkles className="mb-3 size-6 text-champagne-300" />
              <h2 className="font-display text-2xl font-semibold">Let’s set up your control centre</h2>
              <p className="mt-2 text-sm text-sage-100/80">Follow the product lifecycle. Every number on this page will then be calculated from what you record — nothing is hardcoded.</p>
            </div>
            <ol className="grid gap-3 p-6 sm:grid-cols-2">
              {[
                ['1', 'Add your first product & supplier', '/products/new', Package],
                ['2', 'Create the bulk purchase order', '/purchase-orders/new', ClipboardList],
                ['3', 'Record shipping, customs & launch costs', '/expenses/new', Receipt],
                ['4', 'Receive the shipment into stock', '/shipments', Ship],
                ['5', 'Set your selling price', '/pricing', Sparkles],
                ['6', 'Record sales & plan the next order', '/reorder', RefreshCcw],
              ].map(([n, label, href, Icon]: any) => (
                <li key={n}>
                  <Link href={href} className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm hover:border-sage-400 hover:bg-sage-50">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sage-100 font-semibold text-sage-700">{n}</span>
                    <span className="font-medium text-ink">{label}</span>
                    <Icon className="ml-auto size-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ol>
          </div>
          <div className="border-t border-line px-6 py-3 text-xs text-muted">Want to explore first? Create a separate demo business from <Link className="text-sage-700 underline" href="/settings?tab=data">Settings › Data</Link>.</div>
        </Card>
      )}

      {!k.cash.known && !isNew && (
        <Callout tone="warning" title="Cash balance is not established" className="mb-5">
          Record an opening balance or owner contribution in <Link href="/cash-flow">Cash flow</Link>. Until then, cash figures are incomplete and affordability checks are disabled.
        </Callout>
      )}
      {k.missingFx > 0 && (
        <Callout tone="warning" className="mb-5">
          {k.missingFx} expense(s) have no exchange rate and are excluded from totals. <Link href="/expenses">Review expenses</Link>.
        </Callout>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Net sales" hint="Excl. VAT, after discounts & refunds" value={<Money value={k.netSales} currency={cur} />} sub={<>Gross <Money value={k.grossSales} currency={cur} /></>} href={`/sales?${q('recognized=1')}`} />
        <Stat label="Delivered orders" value={k.deliveredOrders} sub={`${k.ordersPlaced} placed · ${k.ordersCancelled} cancelled`} href={`/sales?${q('status=delivered')}`} />
        <Stat label="Avg. order value" value={k.aov ? <Money value={k.aov} currency={cur} /> : '—'} sub="Net, excl. VAT" href={`/sales?${q('recognized=1')}`} />
        <Stat label="Gross profit" value={<Money value={k.grossProfit} currency={cur} />} tone={k.grossProfit.lessThan(0) ? 'negative' : 'positive'} sub={<>Margin <Pct value={k.netSales.isZero() ? null : k.grossProfit.div(k.netSales).times(100)} /></>} href={`/profitability?${q('')}`} />
        <Stat label="Contribution" hint="After COGS, fulfilment, payment & platform fees" value={<Money value={k.contribution} currency={cur} />} tone={k.contribution.lessThan(0) ? 'negative' : 'default'} href={`/profitability?${q('')}`} />
        <Stat label="Advertising spend" value={<Money value={k.advertising} currency={cur} />} href={`/marketing?${q('')}`} />
        <Stat label="Profit after advertising" value={<Money value={k.profitAfterAds} currency={cur} />} tone={k.profitAfterAds.lessThan(0) ? 'negative' : 'positive'} href={`/profitability?${q('')}`} />
        <Stat label="Net operating profit" hint="After operating & startup expenses and inventory losses" value={<Money value={k.netOperatingProfit} currency={cur} />} tone={k.netOperatingProfit.lessThan(0) ? 'negative' : 'positive'} href={`/reports/pnl?${q('')}`} />
        <Stat label="Available cash" value={k.cash.known ? <Money value={k.cash.balance} currency={cur} /> : 'Incomplete'} tone={k.cash.known ? 'default' : 'warning'} sub={k.cash.known ? 'From recorded cash movements' : 'Record opening balance'} href="/cash-flow" />
        <Stat label="Inventory value" hint="Units on hand × batch landed cost" value={<Money value={k.inventoryValue} currency={cur} />} sub={<>+ <Money value={k.incomingValue} currency={cur} /> on order</>} href="/inventory" />
        <Stat label="Owed to suppliers" value={<Money value={k.supplierOutstanding} currency={cur} />} sub={<>+ <Money value={k.expenseOutstanding} currency={cur} /> unpaid expenses</>} href="/suppliers" />
        <Stat label="Owed by customers" value={<Money value={k.customerOutstanding} currency={cur} />} sub="Shipped/delivered, unpaid (e.g. COD)" href="/sales?paymentStatus=unpaid" />
        <Stat label="Acquisition costs" hint="Committed purchase orders + capitalised import costs, all time" value={<Money value={k.acquisitionCosts} currency={cur} />} href="/purchase-orders" />
        <Stat label="Cash spent" hint="Supplier + expense payments actually made, all time" value={<Money value={k.cashSpent} currency={cur} />} href="/cash-flow" />
        <Stat label="Days of stock" hint="Available units ÷ recent daily sales, all products" value={k.daysOfStock ?? '—'} sub="Based on sales velocity" href="/reorder" />
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Sales & profit over time" description="Actual results by recognition date." />
          <CardBody><TrendChart data={data.series} currency={cur} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Break-even progress" description="All-time profit after advertising vs. fixed (operating + startup) costs." />
          <CardBody>
            {k.breakEvenPct === null ? (
              <p className="text-sm text-muted">No fixed costs recorded yet.</p>
            ) : (
              <>
                <div className="num font-display text-5xl font-semibold text-sage-700">{Math.max(0, Math.min(999, k.breakEvenPct.toNumber())).toFixed(0)}%</div>
                <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-ivory-deep">
                  <div className="h-full rounded-full bg-gradient-to-r from-sage-500 to-champagne-500" style={{ width: `${Math.max(0, Math.min(100, k.breakEvenPct.toNumber()))}%` }} />
                </div>
                <p className="mt-3 text-sm text-muted">
                  <Money value={k.contributionAllTime} currency={cur} /> earned towards <Money value={k.fixedAllTime} currency={cur} /> of fixed and startup costs.
                </p>
              </>
            )}
            <div className="mt-6 border-t border-line pt-4">
              <h3 className="mb-2 text-sm font-semibold">Reorder alerts</h3>
              {data.reorderAlerts.length === 0 ? (
                <p className="text-sm text-muted">No product needs replenishment planning right now.</p>
              ) : (
                <ul className="space-y-2">
                  {data.reorderAlerts.slice(0, 5).map((r) => (
                    <li key={r.variantId}>
                      <Link href={`/reorder/${r.variantId}`} className="flex items-start justify-between gap-3 rounded-lg p-2 hover:bg-ivory">
                        <span className="min-w-0 text-sm">
                          <span className="font-medium">{r.name}</span>
                          <span className="block truncate text-xs text-muted">{r.reason}</span>
                        </span>
                        <StatusBadge status={r.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profitability by product" description="Contribution after allocated advertising" action={<Link className="text-sm text-sage-700 hover:underline" href="/profitability">Details</Link>} />
          <CardBody><HBars data={data.salesByProduct} dataKey="contribution" currency={cur} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Sales by product" description="Net revenue excl. VAT" />
          <CardBody><HBars data={data.salesByProduct} dataKey="revenue" currency={cur} color="#b8955a" /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Sales by channel" />
          <CardBody><Donut data={data.byChannel} currency={cur} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Expenses by category" description="Committed expenses in period" action={<Link className="text-sm text-sage-700 hover:underline" href={`/expenses?${q('view=committed')}`}>Details</Link>} />
          <CardBody><Donut data={data.expensesByCategory.map((e) => ({ name: categoryLabel(e.category), value: e.value }))} currency={cur} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Cash in vs. cash out" action={<Link className="text-sm text-sage-700 hover:underline" href="/cash-flow">Cash flow</Link>} />
          <CardBody><CashBars data={data.cashSeries} currency={cur} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Marketing performance" description="Attributed revenue is not proof of incremental profit." action={<Link className="text-sm text-sage-700 hover:underline" href="/marketing">Campaigns</Link>} />
          <CardBody>
            <GroupedBars data={data.marketing} xKey="name" currency={cur} keys={[{ key: 'spend', name: 'Spend', color: '#b8955a' }, { key: 'revenue', name: 'Attributed revenue', color: '#4a6c4f' }, { key: 'profitAfterAds', name: 'Profit after ads', color: '#2f5d73' }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Inventory availability" action={<Link className="text-sm text-sage-700 hover:underline" href="/inventory">Inventory</Link>} />
          <CardBody>
            <GroupedBars data={data.inventory} xKey="sku" money={false} keys={[{ key: 'available', name: 'Available', color: '#4a6c4f' }, { key: 'reserved', name: 'Reserved', color: '#b8955a' }, { key: 'incoming', name: 'Incoming', color: '#2f5d73' }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Actual vs. forecast spending" description="Committed (actual) vs. planned (forecast) expenses by month." />
          <CardBody>
            <GroupedBars data={data.forecastByMonth} xKey="month" currency={cur} keys={[{ key: 'committed', name: 'Committed (actual)', color: '#4a6c4f' }, { key: 'planned', name: 'Planned (forecast)', color: '#e3cc9f' }]} />
          </CardBody>
        </Card>
      </section>

      {data.belowTarget.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Products below their target margin" description="Current unit economics at default price and current landed cost (before advertising)." action={<Link className="text-sm text-sage-700 hover:underline" href="/pricing">Open pricing calculator</Link>} />
          <ul className="divide-y divide-line">
            {data.belowTarget.map((b) => (
              <li key={b.sku} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <Link href={`/pricing?sku=${encodeURIComponent(b.sku)}`} className="font-medium hover:underline">{b.name}</Link>
                <span className="flex items-center gap-3">
                  <span className="text-muted">margin <Pct value={b.margin} /> vs target <Pct value={b.target} /></span>
                  <StatusBadge status={b.status} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {D(data.unallocatedMarketing).greaterThan(0) && (
        <p className="mt-4 text-xs text-muted">
          {formatMoney(data.unallocatedMarketing, cur)} of marketing in this period is not attributed to products (pre-launch or unlinked spend). It is included once in profit after advertising and never added to unit costs.
        </p>
      )}
      <p className="mt-2 text-xs text-muted">Last calculated {fmtDate(new Date().toISOString())}. Click any metric to see the underlying records.</p>
    </>
  );
}
