import { Tx } from '../db/tenant';
import { AppError } from '../errors';
import { D, Decimal, sum } from '../calc/money';
import { classifyProfitability } from '../calc/analytics';
import { evaluatePrice, toExVat, marginStatus, type PricingInputs } from '../calc/pricing';
import { orderFacts } from './facts';
import { marketingAnalysis } from './marketing';
import { getSettings, defaultSaleTaxRate, type BusinessSettings } from './business';
import { listVariants, type VariantRow } from './products';

export interface Period {
  from?: string | null;
  to?: string | null;
}

async function expenseByTreatment(tx: Tx, p: Period) {
  const rows = await tx.many<{ treatment: string; category: string; total: string; missing: number }>(
    `select treatment::text, category, coalesce(sum(amount_base),0) as total, count(*) filter (where fx_rate is null)::int as missing
       from expenses where business_id = $1 and commitment = 'committed' and ($2::date is null or date_incurred >= $2) and ($3::date is null or date_incurred <= $3)
      group by treatment, category`,
    [tx.businessId, p.from || null, p.to || null],
  );
  const by = (t: string) => sum(rows.filter((r) => r.treatment === t).map((r) => r.total));
  return { rows, by, missingFx: rows.reduce((a, r) => a + r.missing, 0) };
}

/** Profit & loss (accrual, management view) built from recorded transactions. */
export async function profitAndLoss(tx: Tx, p: Period) {
  const facts = await orderFacts(tx, p);
  const exp = await expenseByTreatment(tx, p);
  const failed = await tx.one<{ costs: string; cogs: string; n: number }>(
    `select coalesce(sum(o.fulfilment_costs_base + o.selling_fees_base),0) as costs, coalesce(sum(o.cogs_shipped_base),0) as cogs, count(*)::int as n
       from v_order_financials o where o.business_id = $1 and o.status = 'cancelled' and o.shipped_at is not null
        and ($2::date is null or o.cancelled_at >= $2) and ($3::date is null or o.cancelled_at <= $3)`,
    [tx.businessId, p.from || null, p.to || null],
  );
  const losses = await tx.one<{ writeoff: string; adj: string }>(
    `select coalesce(-sum(m.quantity * l.landed_unit_cost) filter (where m.movement_type = 'write_off'),0) as writeoff,
            coalesce(-sum(m.quantity * l.landed_unit_cost) filter (where m.movement_type = 'adjustment'),0) as adj
       from inventory_movements m join inventory_lots l on l.id = m.lot_id
      where m.business_id = $1 and m.movement_type in ('write_off','adjustment') and ($2::date is null or m.created_at::date >= $2) and ($3::date is null or m.created_at::date <= $3)`,
    [tx.businessId, p.from || null, p.to || null],
  );
  const grossSales = sum(facts.map((f) => f.grossMerch.plus(f.shippingRevenue)));
  const discounts = sum(facts.map((f) => f.discounts));
  const refunds = sum(facts.map((f) => f.refunds));
  const netSales = grossSales.minus(discounts).minus(refunds);
  const cogs = sum(facts.map((f) => f.cogs));
  const grossProfit = netSales.minus(cogs);
  const fulfilment = sum(facts.map((f) => f.fulfilment.plus(f.returnShipping)));
  const sellingFees = sum(facts.map((f) => f.sellingFees));
  const perOrderExpenses = exp.by('per_order_variable');
  const failedDeliveries = D(failed.costs).plus(D(failed.cogs));
  const contributionBeforeMarketing = grossProfit.minus(fulfilment).minus(sellingFees).minus(perOrderExpenses).minus(failedDeliveries);
  const marketing = exp.by('marketing');
  const contributionAfterMarketing = contributionBeforeMarketing.minus(marketing);
  const operating = exp.by('operating');
  const startup = exp.by('startup');
  const inventoryLosses = D(losses.writeoff).plus(D(losses.adj));
  const netOperatingProfit = contributionAfterMarketing.minus(operating).minus(startup).minus(inventoryLosses);
  const vatCollected = sum(facts.map((f) => f.vat));
  return {
    orders: facts.length,
    units: facts.reduce((a, f) => a + f.items.reduce((b, i) => b + i.netUnits, 0), 0),
    grossSales,
    discounts,
    refunds,
    netSales,
    cogs,
    grossProfit,
    fulfilment,
    sellingFees,
    perOrderExpenses,
    failedDeliveries,
    failedDeliveryCount: failed.n,
    contributionBeforeMarketing,
    marketing,
    contributionAfterMarketing,
    operating,
    startup,
    inventoryLosses,
    netOperatingProfit,
    tax: { vatCollected, recoverableTaxPaid: exp.by('recoverable_tax') },
    capitalisedAcquisitionCosts: exp.by('product_acquisition'),
    missingFx: exp.missingFx,
    expenseRows: exp.rows,
  };
}

/** Monthly (or custom bucket) series of the P&L for charts. */
export async function pnlSeries(tx: Tx, p: Period & { bucket: 'day' | 'week' | 'month' | 'quarter' }) {
  const facts = await orderFacts(tx, p);
  const exp = await tx.many(
    `select date_trunc($4, date_incurred)::date as b, treatment::text, coalesce(sum(amount_base),0) as total from expenses
      where business_id = $1 and commitment = 'committed' and treatment in ('marketing','operating','startup','per_order_variable')
        and ($2::date is null or date_incurred >= $2) and ($3::date is null or date_incurred <= $3) group by 1, 2`,
    [tx.businessId, p.from || null, p.to || null, p.bucket],
  );
  const key = (d: string) => bucketKey(d, p.bucket);
  const map = new Map<string, { period: string; netSales: Decimal; cogs: Decimal; contribution: Decimal; marketing: Decimal; fixed: Decimal; orders: number }>();
  const get = (k: string) => map.get(k) ?? map.set(k, { period: k, netSales: new Decimal(0), cogs: new Decimal(0), contribution: new Decimal(0), marketing: new Decimal(0), fixed: new Decimal(0), orders: 0 }).get(k)!;
  for (const f of facts) {
    const r = get(key(f.recognizedDate!));
    r.netSales = r.netSales.plus(f.netSales);
    r.cogs = r.cogs.plus(f.cogs);
    r.contribution = r.contribution.plus(f.contribution);
    r.orders++;
  }
  for (const e of exp) {
    const r = get(key(e.b));
    if (e.treatment === 'marketing') r.marketing = r.marketing.plus(D(e.total));
    else if (e.treatment === 'per_order_variable') r.contribution = r.contribution.minus(D(e.total));
    else r.fixed = r.fixed.plus(D(e.total));
  }
  return [...map.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((r) => ({
      period: r.period,
      orders: r.orders,
      netSales: r.netSales.toDecimalPlaces(2).toNumber(),
      grossProfit: r.netSales.minus(r.cogs).toDecimalPlaces(2).toNumber(),
      contributionAfterAds: r.contribution.minus(r.marketing).toDecimalPlaces(2).toNumber(),
      netProfit: r.contribution.minus(r.marketing).minus(r.fixed).toDecimalPlaces(2).toNumber(),
      marketing: r.marketing.toDecimalPlaces(2).toNumber(),
    }));
}

export function bucketKey(date: string, bucket: 'day' | 'week' | 'month' | 'quarter') {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (bucket === 'day') return date.slice(0, 10);
  if (bucket === 'month') return date.slice(0, 7);
  if (bucket === 'quarter') return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  const day = (d.getUTCDay() + 6) % 7; // Monday-based week
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function pricingInputsFor(v: VariantRow, s: BusinessSettings, vatRate: string, overrides: Partial<PricingInputs> = {}): PricingInputs {
  return {
    landedUnitCost: v.current_landed_cost ?? 0,
    packagingPerUnit: v.packaging_cost ?? s.default_packaging_cost,
    fulfillmentPerOrder: s.default_fulfillment_cost,
    shippingPerOrder: s.default_shipping_cost,
    customerShippingRevenue: 0,
    unitsPerOrder: 1,
    paymentFeePct: s.default_payment_fee_pct,
    paymentFeeFixed: s.default_payment_fee_fixed,
    marketplaceFeePct: 0,
    marketplaceFeeFixed: 0,
    adCostPerOrder: 0,
    returnRatePct: 0,
    returnCostPerReturn: 0,
    returnResellablePct: 100,
    discountPct: 0,
    vatRatePct: vatRate,
    feesOnGross: s.fee_basis === 'gross_incl_tax',
    ...overrides,
  };
}

/**
 * Per-product profitability: actual period performance from completed sales (incl. allocated
 * advertising, allocated exactly once) and current unit economics at today's cost and price.
 */
export async function productProfitability(tx: Tx, p: Period) {
  const s = await getSettings(tx);
  const vat = await defaultSaleTaxRate(tx);
  const variants = await listVariants(tx);
  const facts = await orderFacts(tx, p);
  const mk = await marketingAnalysis(tx, p);
  const agg = new Map<string, { units: number; orders: Set<string>; revenue: Decimal; refunds: Decimal; cogs: Decimal; variable: Decimal; contribution: Decimal; returned: number }>();
  for (const f of facts)
    for (const it of f.items) {
      const a = agg.get(it.variantId) ?? agg.set(it.variantId, { units: 0, orders: new Set(), revenue: new Decimal(0), refunds: new Decimal(0), cogs: new Decimal(0), variable: new Decimal(0), contribution: new Decimal(0), returned: 0 }).get(it.variantId)!;
      a.units += it.netUnits;
      a.returned += it.unitsReturned;
      a.orders.add(f.id);
      a.revenue = a.revenue.plus(it.revenue);
      a.refunds = a.refunds.plus(it.refunds);
      a.cogs = a.cogs.plus(it.cogs);
      a.variable = a.variable.plus(it.variableCosts);
      a.contribution = a.contribution.plus(it.contribution);
    }
  const rows = variants.map((v) => {
    const a = agg.get(v.id);
    const ads = mk.perVariantAds.get(v.id) ?? new Decimal(0);
    const netRevenue = a ? a.revenue.minus(a.refunds) : new Decimal(0);
    const contributionAfterAds = a ? a.contribution.minus(ads) : ads.negated();
    const target = v.target_margin_pct ?? s.default_target_margin_pct;
    const hasCost = v.current_landed_cost !== null && v.current_landed_cost !== undefined;
    const cls = classifyProfitability({ unitsSold: a?.units ?? 0, netRevenue, contribution: contributionAfterAds, hasCost: hasCost || (a?.cogs.greaterThan(0) ?? false), targetMarginPct: target });
    // Current unit economics at the default selling price
    let unit: null | { priceExVat: Decimal; profitPerUnit: Decimal; marginPct: Decimal | null; markupPct: Decimal | null; status: string } = null;
    if (v.default_selling_price && hasCost) {
      const priceEx = toExVat(v.default_selling_price, v.selling_price_includes_tax, vat);
      const r = evaluatePrice(pricingInputsFor(v, s, vat), priceEx);
      unit = { priceExVat: priceEx, profitPerUnit: r.profitPerUnit, marginPct: r.marginBeforeAdsPct, markupPct: r.markupPct, status: marginStatus(r.marginBeforeAdsPct, s.min_acceptable_margin_pct, target) };
    }
    return {
      variant: v,
      targetMarginPct: D(target),
      unitsSold: a?.units ?? 0,
      unitsReturned: a?.returned ?? 0,
      orders: a?.orders.size ?? 0,
      netRevenue,
      cogs: a?.cogs ?? new Decimal(0),
      variableCosts: a?.variable ?? new Decimal(0),
      contributionBeforeAds: a?.contribution ?? new Decimal(0),
      advertising: ads,
      contributionAfterAds,
      marginPct: cls.marginPct,
      classification: cls.cls,
      unit,
    };
  });
  const pnl = await profitAndLoss(tx, p);
  return { rows, unallocatedMarketing: mk.unallocatedTotal, unallocatedReasons: mk.unallocatedReasons, totalMarketing: mk.totalSpend, pnl, settings: s, vatRate: vat };
}

/** Cash position from actual cash transactions only. */
export async function cashPosition(tx: Tx, asOf?: string | null) {
  const r = await tx.one(
    `select
       coalesce(sum(amount_base) filter (where direction = 'in'), 0) as cash_in,
       coalesce(sum(amount_base) filter (where direction = 'out'), 0) as cash_out,
       coalesce(sum(amount_base) filter (where category = 'opening_balance'), 0) as opening,
       coalesce(sum(amount_base) filter (where category = 'owner_contribution'), 0) as contributions,
       coalesce(sum(amount_base) filter (where category = 'owner_withdrawal'), 0) as withdrawals,
       coalesce(sum(amount_base) filter (where category = 'customer_receipt'), 0) as collections,
       coalesce(sum(amount_base) filter (where category = 'customer_refund'), 0) as refunds,
       coalesce(sum(amount_base) filter (where category = 'supplier_payment'), 0) as supplier_payments,
       coalesce(sum(amount_base) filter (where category in ('expense_payment','tax_payment')), 0) as expense_payments,
       coalesce(sum(amount_base) filter (where category in ('loan_in')), 0) as loans_in,
       count(*) filter (where category in ('opening_balance','owner_contribution'))::int as funding_entries
     from cash_transactions where business_id = $1 and ($2::date is null or txn_date <= $2)`,
    [tx.businessId, asOf || null],
  );
  const balance = D(r.cash_in).minus(D(r.cash_out));
  return {
    known: r.funding_entries > 0,
    balance,
    cashIn: D(r.cash_in),
    cashOut: D(r.cash_out),
    opening: D(r.opening),
    contributions: D(r.contributions),
    withdrawals: D(r.withdrawals),
    capitalInvested: D(r.opening).plus(D(r.contributions)),
    collections: D(r.collections),
    refunds: D(r.refunds),
    supplierPayments: D(r.supplier_payments),
    expensePayments: D(r.expense_payments),
    loansIn: D(r.loans_in),
  };
}

export async function liabilities(tx: Tx) {
  const r = await tx.one(
    `select
       (select coalesce(sum(outstanding_base),0) from v_po_summary where business_id = $1) as supplier,
       (select coalesce(sum(round(outstanding * fx_rate, 4)),0) from v_expense_summary where business_id = $1 and commitment = 'committed') as expenses,
       (select count(*) from v_expense_summary where business_id = $1 and commitment = 'committed' and outstanding > 0 and fx_rate is null)::int as missing_fx,
       (select coalesce(sum(round((total_incl_tax - paid) * fx_rate, 4)),0) from v_order_financials where business_id = $1 and status in ('shipped','delivered') and paid < total_incl_tax) as receivables`,
    [tx.businessId],
  );
  return { supplier: D(r.supplier), expenses: D(r.expenses), total: D(r.supplier).plus(D(r.expenses)), receivables: D(r.receivables), missingFx: r.missing_fx };
}

export async function inventoryValuation(tx: Tx) {
  const r = await tx.one(
    `select coalesce(sum(greatest(on_hand,0) * landed_unit_cost),0) as on_hand_value, coalesce(sum(greatest(on_hand,0)),0)::int as units,
            coalesce(sum(greatest(reserved,0) * landed_unit_cost),0) as reserved_value
       from v_lot_stock where business_id = $1`,
    [tx.businessId],
  );
  const transit = await tx.one(
    `select coalesce(sum(round(pi.qty_outstanding * pi.unit_price * po.fx_rate, 4)),0) as value, coalesce(sum(pi.qty_outstanding),0)::int as units
       from v_po_item_progress pi join purchase_orders po on po.id = pi.purchase_order_id where pi.business_id = $1 and po.status not in ('draft','cancelled','received')`,
    [tx.businessId],
  );
  return { onHandValue: D(r.on_hand_value), units: r.units, reservedValue: D(r.reserved_value), incomingValue: D(transit.value), incomingUnits: transit.units };
}

/** Cash forecast: known future inflows/outflows by week (estimates, clearly separated from actuals). */
export async function cashForecast(tx: Tx, weeks = 13) {
  const pos = await cashPosition(tx);
  const items = await tx.many(
    `select coalesce(po.expected_arrival_date, po.order_date + 30) as due, 'out' as dir, 'Supplier balance ' || po.po_number as label, v.outstanding_base as amount
       from v_po_summary v join purchase_orders po on po.id = v.id where v.business_id = $1 and v.outstanding > 0
     union all
     select coalesce(e.due_date, e.date_incurred), 'out', e.name || case when e.commitment = 'planned' then ' (planned)' else '' end, round(e.outstanding * coalesce(e.fx_rate,0), 4)
       from v_expense_summary e where e.business_id = $1 and e.commitment in ('committed','planned') and e.outstanding > 0
     union all
     select coalesce(o.shipped_at, o.order_date) + 7, 'in', 'Receivable ' || o.order_number, round((o.total_incl_tax - o.paid) * o.fx_rate, 4)
       from v_order_financials o where o.business_id = $1 and o.status in ('confirmed','processing','shipped','delivered') and o.paid < o.total_incl_tax`,
    [tx.businessId],
  );
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let bal = pos.balance;
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const ws = new Date(start.getTime() + w * 7 * 864e5);
    const we = new Date(ws.getTime() + 7 * 864e5);
    const inWeek = items.filter((i) => {
      const d = new Date(`${String(i.due).slice(0, 10)}T00:00:00Z`);
      return w === 0 ? d < we : d >= ws && d < we;
    });
    const inflow = sum(inWeek.filter((i) => i.dir === 'in').map((i) => i.amount));
    const outflow = sum(inWeek.filter((i) => i.dir === 'out').map((i) => i.amount));
    bal = bal.plus(inflow).minus(outflow);
    out.push({ week: ws.toISOString().slice(0, 10), inflow: inflow.toNumber(), outflow: outflow.toNumber(), balance: bal.toDecimalPlaces(2).toNumber(), items: inWeek.length });
  }
  return { known: pos.known, start: pos.balance, weeks: out, items };
}

export async function cashSeries(tx: Tx, p: Period & { bucket: 'day' | 'week' | 'month' | 'quarter' }) {
  const rows = await tx.many(
    `select txn_date::text as d, direction, amount_base from cash_transactions where business_id = $1 and ($2::date is null or txn_date >= $2) and ($3::date is null or txn_date <= $3) order by txn_date`,
    [tx.businessId, p.from || null, p.to || null],
  );
  const map = new Map<string, { period: string; cashIn: Decimal; cashOut: Decimal }>();
  for (const r of rows) {
    const k = bucketKey(r.d, p.bucket);
    const e = map.get(k) ?? map.set(k, { period: k, cashIn: new Decimal(0), cashOut: new Decimal(0) }).get(k)!;
    if (r.direction === 'in') e.cashIn = e.cashIn.plus(D(r.amount_base));
    else e.cashOut = e.cashOut.plus(D(r.amount_base));
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period)).map((r) => ({ period: r.period, cashIn: r.cashIn.toDecimalPlaces(2).toNumber(), cashOut: r.cashOut.toDecimalPlaces(2).toNumber(), net: r.cashIn.minus(r.cashOut).toDecimalPlaces(2).toNumber() }));
}

export async function listCashTransactions(tx: Tx, f: { from?: string; to?: string; category?: string; limit?: number; offset?: number } = {}) {
  return tx.many(
    `select *, count(*) over() as total_count from cash_transactions where business_id = $1 and ($2::date is null or txn_date >= $2) and ($3::date is null or txn_date <= $3)
       and ($4::text is null or category::text = $4) order by txn_date desc, created_at desc limit $5 offset $6`,
    [tx.businessId, f.from || null, f.to || null, f.category || null, f.limit ?? 100, f.offset ?? 0],
  );
}

export async function addCashTransaction(tx: Tx, c: { txn_date: string; category: string; amount: string; currency: string; fx_rate: string; account: string; description: string | null }) {
  const inCats = ['opening_balance', 'owner_contribution', 'loan_in', 'tax_refund', 'other_in'];
  await tx.exec(
    `insert into cash_transactions (business_id, txn_date, direction, category, amount, currency, fx_rate, account, description, source_type, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10)`,
    [tx.businessId, c.txn_date, inCats.includes(c.category) ? 'in' : 'out', c.category, c.amount, c.currency, c.fx_rate, c.account, c.description, tx.userId],
  );
}

export async function deleteCashTransaction(tx: Tx, id: string) {
  const r = await tx.one<{ source_type: string | null }>('select source_type from cash_transactions where id = $1 and business_id = $2', [id, tx.businessId], 'Transaction not found');
  if (r.source_type && r.source_type !== 'manual') throw new AppError('This cash movement was created by a payment. Delete the payment on its purchase order, expense or sales order instead.', 'conflict');
  await tx.exec('delete from cash_transactions where id = $1', [id]);
}

