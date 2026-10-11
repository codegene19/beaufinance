import { Tx } from '../db/tenant';
import { D, Decimal, sum } from '../calc/money';
import { orderFacts } from './facts';
import { profitAndLoss, pnlSeries, cashPosition, liabilities, inventoryValuation, cashSeries, productProfitability, type Period } from './finance';
import { marketingAnalysis } from './marketing';
import { reorderPlan } from './reorder';
import { expenseTotals } from './expenses';

export async function dashboard(tx: Tx, p: Period & { bucket: 'day' | 'week' | 'month' | 'quarter' }) {
  const pnl = await profitAndLoss(tx, p);
  const facts = await orderFacts(tx, p);
  const allTime = await profitAndLoss(tx, {});
  const cash = await cashPosition(tx);
  const liab = await liabilities(tx);
  const inv = await inventoryValuation(tx);
  const series = await pnlSeries(tx, p);
  const cashS = await cashSeries(tx, p);
  const mk = await marketingAnalysis(tx, p);
  const prof = await productProfitability(tx, p);
  const reorder = await reorderPlan(tx);
  const exp = await expenseTotals(tx, p);
  const delivered = facts.filter((f) => f.delivered).length;
  const placed = await tx.one<{ n: number; cancelled: number }>(
    `select count(*)::int as n, count(*) filter (where status = 'cancelled')::int as cancelled from sales_orders where business_id = $1 and ($2::date is null or order_date >= $2) and ($3::date is null or order_date <= $3)`,
    [tx.businessId, p.from || null, p.to || null],
  );
  const acquisition = await tx.one<{ v: string }>(
    `select coalesce(sum(subtotal_base) filter (where status <> 'cancelled'),0) + (select coalesce(sum(amount_base),0) from expenses where business_id = $1 and treatment = 'product_acquisition' and commitment = 'committed') as v from v_po_summary where business_id = $1`,
    [tx.businessId],
  );
  const salesByProduct = new Map<string, { name: string; revenue: Decimal; contribution: Decimal; units: number }>();
  for (const r of prof.rows)
    if (r.unitsSold > 0 || r.netRevenue.greaterThan(0))
      salesByProduct.set(r.variant.id, { name: `${r.variant.product_name} · ${r.variant.variant_name}`, revenue: r.netRevenue, contribution: r.contributionAfterAds, units: r.unitsSold });
  const channels = await tx.many<{ id: string; name: string }>('select id, name from sales_channels where business_id = $1', [tx.businessId]);
  const byChannel = new Map<string, Decimal>();
  for (const f of facts) {
    const n = channels.find((c) => c.id === f.channelId)?.name ?? 'Unassigned';
    byChannel.set(n, (byChannel.get(n) ?? new Decimal(0)).plus(f.netSales));
  }
  const expByCat = await tx.many<{ category: string; total: string }>(
    `select category, coalesce(sum(amount_base),0) as total from expenses where business_id = $1 and commitment = 'committed' and ($2::date is null or date_incurred >= $2) and ($3::date is null or date_incurred <= $3) group by category order by 2 desc`,
    [tx.businessId, p.from || null, p.to || null],
  );
  const forecastByMonth = await tx.many<{ m: string; planned: string; committed: string }>(
    `select to_char(date_incurred, 'YYYY-MM') as m, coalesce(sum(amount_base) filter (where commitment = 'planned'),0) as planned, coalesce(sum(amount_base) filter (where commitment = 'committed'),0) as committed
       from expenses where business_id = $1 and ($2::date is null or date_incurred >= $2) group by 1 order by 1`,
    [tx.businessId, p.from || null],
  );
  const fixedAllTime = allTime.operating.plus(allTime.startup);
  const breakEvenPct = fixedAllTime.isZero() ? null : allTime.contributionAfterMarketing.div(fixedAllTime).times(100);
  const unitsSold = facts.reduce((a, f) => a + f.items.reduce((b, i) => b + i.netUnits, 0), 0);
  const totalAvail = reorder.results.reduce((a, r) => a + Math.max(0, r.result.available), 0);
  const totalDaily = reorder.results.reduce((a, r) => a + r.result.avgDailySales.toNumber(), 0);
  return {
    kpis: {
      grossSales: pnl.grossSales,
      netSales: pnl.netSales,
      ordersPlaced: placed.n,
      ordersCancelled: placed.cancelled,
      recognizedOrders: facts.length,
      deliveredOrders: delivered,
      unitsSold,
      aov: facts.length ? pnl.netSales.div(facts.length) : null,
      acquisitionCosts: D(acquisition.v),
      inventoryValue: inv.onHandValue,
      incomingValue: inv.incomingValue,
      grossProfit: pnl.grossProfit,
      contribution: pnl.contributionBeforeMarketing,
      advertising: pnl.marketing,
      profitAfterAds: pnl.contributionAfterMarketing,
      netOperatingProfit: pnl.netOperatingProfit,
      cashSpent: D(exp.cash_spent_base).plus(cash.supplierPayments),
      supplierOutstanding: liab.supplier,
      expenseOutstanding: liab.expenses,
      customerOutstanding: liab.receivables,
      cash,
      breakEvenPct,
      fixedAllTime,
      contributionAllTime: allTime.contributionAfterMarketing,
      daysOfStock: totalDaily > 0 ? Math.round(totalAvail / totalDaily) : null,
      missingFx: pnl.missingFx,
    },
    series,
    cashSeries: cashS,
    salesByProduct: [...salesByProduct.values()].sort((a, b) => b.revenue.comparedTo(a.revenue)).map((r) => ({ name: r.name, revenue: r.revenue.toDecimalPlaces(2).toNumber(), contribution: r.contribution.toDecimalPlaces(2).toNumber(), units: r.units })),
    byChannel: [...byChannel.entries()].map(([name, v]) => ({ name, value: v.toDecimalPlaces(2).toNumber() })),
    expensesByCategory: expByCat.map((e) => ({ category: e.category, value: D(e.total).toDecimalPlaces(2).toNumber() })),
    marketing: mk.campaigns.filter((c) => c.spend.greaterThan(0) || c.orders > 0).map((c) => ({ name: c.name, spend: c.spend.toNumber(), revenue: c.revenue.toDecimalPlaces(2).toNumber(), roas: c.roas?.toDecimalPlaces(2).toNumber() ?? null, profitAfterAds: c.profitAfterAds.toDecimalPlaces(2).toNumber() })),
    inventory: reorder.results.map((r) => ({ sku: r.variant.sku, name: `${r.variant.product_name} · ${r.variant.variant_name}`, available: r.result.available, reserved: r.variant.reserved, incoming: r.result.incomingTotal, status: r.result.status, daysOfStock: r.result.daysOfStock?.toNumber() ?? null, reasons: r.result.reasons })),
    belowTarget: prof.rows.filter((r) => r.unit && ['below_break_even', 'below_minimum', 'below_target'].includes(r.unit.status)).map((r) => ({ id: r.variant.product_id, sku: r.variant.sku, name: `${r.variant.product_name} · ${r.variant.variant_name}`, margin: r.unit!.marginPct?.toDecimalPlaces(1).toNumber() ?? null, target: r.targetMarginPct.toNumber(), status: r.unit!.status })),
    reorderAlerts: reorder.results.filter((r) => ['order_soon', 'urgent', 'plan'].includes(r.result.status)).map((r) => ({ variantId: r.variant.id, sku: r.variant.sku, name: `${r.variant.product_name} · ${r.variant.variant_name}`, status: r.result.status, reason: r.result.reasons[0], stockoutDate: r.result.stockoutDate })),
    forecastByMonth: forecastByMonth.map((f) => ({ month: f.m, planned: D(f.planned).toNumber(), committed: D(f.committed).toNumber() })),
    unallocatedMarketing: mk.unallocatedTotal,
    totalsCheck: { expensesCommitted: D(exp.committed_base), forecast: D(exp.forecast_base) },
  };
}
