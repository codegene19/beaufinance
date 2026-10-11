import Link from 'next/link';
import { tenant, getAppContext } from '@/lib/app-context';
import { cashPosition, liabilities, inventoryValuation, cashForecast, cashSeries, listCashTransactions, profitAndLoss } from '@/lib/services/finance';
import { allDefaultFxRates } from '@/lib/services/business';
import { deleteCashAction } from '@/app/actions/operations';
import { PageHeader, Stat, Callout, EstimateTag } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ConfirmButton } from '@/components/ui/confirm';
import { Money, Pct, fmtDate } from '@/components/app/money';
import { CashBars, LinesChart } from '@/components/app/charts';
import { PeriodPicker, FilterBar } from '@/components/app/filters';
import { resolvePeriod, sp as s } from '@/components/app/period';
import { Pagination } from '@/components/app/pagination';
import { CashDialog } from './cash-dialog';
import { CASH_CATEGORIES, cashCategoryLabel } from '@/lib/constants';

export const metadata = { title: 'Cash flow' };
const PAGE = 50;

export default async function CashFlow({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const period = resolvePeriod(sp, 'all');
  const page = Number(s(sp.page) ?? 1);
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const d = await tenant(async (tx) => ({
    pos: await cashPosition(tx), liab: await liabilities(tx), inv: await inventoryValuation(tx), fc: await cashForecast(tx, 13), series: await cashSeries(tx, period),
    txns: await listCashTransactions(tx, { from: period.from ?? undefined, to: period.to ?? undefined, category: s(sp.category), limit: PAGE, offset: (page - 1) * PAGE }),
    pnl: await profitAndLoss(tx, {}), rates: await allDefaultFxRates(tx),
    currencies: (await tx.many<{ code: string }>('select code from currencies where business_id = $1 order by code', [tx.businessId])).map((c) => c.code),
  }));
  const { pos, liab, inv } = d;
  const netOps = pos.balance.minus(pos.capitalInvested).plus(pos.withdrawals).minus(pos.loansIn);
  const free = pos.balance.minus(liab.total).minus(ctx.settings.min_cash_reserve);
  const recoveryCash = pos.capitalInvested.isZero() ? null : pos.balance.plus(pos.withdrawals).div(pos.capitalInvested).times(100);
  const recoveryProfit = pos.capitalInvested.isZero() ? null : d.pnl.netOperatingProfit.div(pos.capitalInvested).times(100);
  const total = Number(d.txns[0]?.total_count ?? 0);
  return (
    <>
      <PageHeader title="Cash flow & investment recovery" description="Follows the money that actually entered and left the business. Unpaid obligations and inventory are shown separately — never netted into “cash”." actions={<><PeriodPicker defaultPreset="all" /><CashDialog currency={cur} currencies={d.currencies} rates={d.rates} defaultCategory={pos.known ? 'owner_contribution' : 'opening_balance'} label={pos.known ? 'Record cash movement' : 'Record opening balance'} /></>} />
      {!pos.known && <Callout tone="warning" title="Cash balance incomplete" className="mb-4">Record an opening balance or your initial owner contribution. Until then the balance below is only the sum of recorded movements and is labelled as incomplete.</Callout>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={pos.known ? 'Available cash (actual)' : 'Cash (incomplete)'} value={<Money value={pos.balance} currency={cur} />} tone={pos.known ? (pos.balance.lessThan(0) ? 'negative' : 'default') : 'warning'} sub="Sum of all recorded cash movements" />
        <Stat label="Outstanding liabilities" value={<Money value={liab.total} currency={cur} />} tone="warning" sub={<>Suppliers <Money value={liab.supplier} currency={cur} /> · expenses <Money value={liab.expenses} currency={cur} /></>} href="/suppliers" />
        <Stat label="Owed by customers" value={<Money value={liab.receivables} currency={cur} />} sub="Shipped/delivered, not yet collected" href="/sales?paymentStatus=unpaid" />
        <Stat label="Free cash after obligations" value={<Money value={free} currency={cur} />} tone={free.lessThan(0) ? 'negative' : 'positive'} sub={<>Cash − liabilities − <Money value={ctx.settings.min_cash_reserve} currency={cur} /> reserve</>} />
        <Stat label="Capital invested" value={<Money value={pos.capitalInvested} currency={cur} />} sub={<>Opening <Money value={pos.opening} currency={cur} /> + contributions <Money value={pos.contributions} currency={cur} /></>} />
        <Stat label="Owner withdrawals" value={<Money value={pos.withdrawals} currency={cur} />} />
        <Stat label="Customer collections" value={<Money value={pos.collections} currency={cur} />} sub={<>Refunds paid <Money value={pos.refunds} currency={cur} /></>} />
        <Stat label="Net cash from operations" value={<Money value={netOps} currency={cur} />} tone={netOps.lessThan(0) ? 'negative' : 'positive'} sub="Excludes capital, loans & withdrawals" />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Investment recovery" description="Shown separately from accounting profit." />
          <CardBody className="space-y-4 text-sm">
            <div>
              <div className="flex justify-between"><span className="text-muted">Cash recovered (cash now + withdrawals ÷ capital)</span><Pct value={recoveryCash} dp={0} /></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ivory-deep"><div className="h-full bg-sage-500" style={{ width: `${Math.max(0, Math.min(100, recoveryCash?.toNumber() ?? 0))}%` }} /></div>
            </div>
            <div>
              <div className="flex justify-between"><span className="text-muted">Cumulative net operating profit ÷ capital</span><Pct value={recoveryProfit} dp={0} signed /></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ivory-deep"><div className="h-full bg-champagne-500" style={{ width: `${Math.max(0, Math.min(100, recoveryProfit?.toNumber() ?? 0))}%` }} /></div>
            </div>
            <div className="border-t border-line pt-3">
              <div className="flex justify-between"><span>Cash tied up in unsold inventory</span><Money value={inv.onHandValue} currency={cur} /></div>
              <div className="flex justify-between"><span>Inventory ordered, not yet received</span><Money value={inv.incomingValue} currency={cur} /></div>
              <p className="mt-2 text-xs text-muted">Buying inventory uses cash immediately but becomes a cost (COGS) only when units are sold — so profit and cash differ.</p>
            </div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="13-week cash forecast" description="Starts from actual cash; adds receivables and subtracts supplier balances, unpaid and planned expenses by due date." action={<EstimateTag />} />
          <CardBody>
            {!d.fc.known && <p className="mb-2 text-xs text-amber-700">Starting balance incomplete — forecast is indicative only.</p>}
            <LinesChart data={d.fc.weeks} xKey="week" currency={cur} refY={{ y: Number(ctx.settings.min_cash_reserve), label: 'Minimum reserve' }} keys={[{ key: 'balance', name: 'Forecast balance', color: '#4a6c4f' }]} />
          </CardBody>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader title="Cash in vs. cash out" description={period.label} />
        <CardBody><CashBars data={d.series} currency={cur} /></CardBody>
      </Card>

      <Card>
        <CardHeader title="Cash movements" description="Payments on purchase orders, expenses and sales orders create these automatically." />
        <FilterBar filters={[{ type: 'select', name: 'category', label: 'Type', options: CASH_CATEGORIES.map((c) => ({ value: c.value, label: c.label })) }]} />
        {d.txns.length === 0 ? <p className="p-5 text-sm text-muted">No cash movements recorded in this period.</p> : (
          <>
            <Table>
              <THead><tr><Th>Date</Th><Th>Type</Th><Th>Description</Th><Th>Account</Th><Th right>Original</Th><Th right>In</Th><Th right>Out</Th><Th /></tr></THead>
              <tbody>{d.txns.map((t) => (
                <Tr key={t.id}>
                  <Td muted className="whitespace-nowrap">{fmtDate(t.txn_date)}</Td>
                  <Td><Badge tone={t.direction === 'in' ? 'sage' : 'neutral'}>{cashCategoryLabel(t.category)}</Badge></Td>
                  <Td>{t.description}</Td>
                  <Td muted>{t.account}</Td>
                  <Td right muted>{t.currency !== cur ? `${t.amount} ${t.currency}` : ''}</Td>
                  <Td right>{t.direction === 'in' ? <Money value={t.amount_base} currency={cur} /> : ''}</Td>
                  <Td right>{t.direction === 'out' ? <Money value={t.amount_base} currency={cur} /> : ''}</Td>
                  <Td>{t.source_type === 'manual' ? <ConfirmButton action={deleteCashAction.bind(null, t.id)} title="Delete cash movement?" description="This changes your cash balance." confirmLabel="Delete" variant="ghost">Delete</ConfirmButton> : <span className="text-[11px] text-muted">auto</span>}</Td>
                </Tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE} total={total} basePath="/cash-flow" params={sp} />
          </>
        )}
      </Card>
    </>
  );
}
