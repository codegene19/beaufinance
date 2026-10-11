import { differenceInCalendarDays, formatISO, parseISO, subDays } from 'date-fns';
import { Tx } from '../db/tenant';
import { D, Decimal } from '../calc/money';
import { computeReorder, type ReorderInputs } from '../calc/reorder';
import { evaluatePrice, toExVat } from '../calc/pricing';
import { getSettings, defaultFxRate, defaultSaleTaxRate } from './business';
import { listVariants } from './products';
import { cashPosition, liabilities, pricingInputsFor } from './finance';

export interface ScenarioOverrides {
  orderQty?: number | null;
  supplierUnitPrice?: string | null; // in purchase currency
  fxRate?: string | null;
  freightCustomsPerUnit?: string | null; // base currency
  depositPct?: string | null;
  historyDays?: number | null;
  coverageDays?: number | null;
  supplierLeadDays?: number | null;
  shippingLeadDays?: number | null;
}

/** Builds reorder inputs for every active variant from actual records, then runs the engine. */
export async function reorderPlan(tx: Tx, opts: { variantId?: string; overrides?: ScenarioOverrides; today?: string } = {}) {
  const s = await getSettings(tx);
  const today = opts.today ?? formatISO(new Date(), { representation: 'date' });
  const ov = opts.overrides ?? {};
  const historyDays = ov.historyDays ?? s.sales_history_days;
  const windowStart = formatISO(subDays(parseISO(today), historyDays - 1), { representation: 'date' });
  const vat = await defaultSaleTaxRate(tx);
  const variants = (await listVariants(tx, { activeOnly: !opts.variantId })).filter((v) => !opts.variantId || v.id === opts.variantId);
  const demand = await tx.many<{ variant_id: string; units: number }>(
    `select i.variant_id, sum(i.quantity)::int as units from sales_order_items i join sales_orders o on o.id = i.order_id
      where o.business_id = $1 and o.status not in ('cancelled','pending') and o.order_date between $2 and $3 group by i.variant_id`,
    [tx.businessId, windowStart, today],
  );
  const firstActivity = await tx.many<{ variant_id: string; first: string }>(
    `select variant_id, min(d)::text as first from (
        select variant_id, received_date as d from inventory_lots where business_id = $1
        union all select i.variant_id, o.order_date from sales_order_items i join sales_orders o on o.id = i.order_id where o.business_id = $1 and o.status <> 'cancelled'
     ) x group by variant_id`,
    [tx.businessId],
  );
  const incoming = await tx.many<{ variant_id: string; qty: number; expected: string | null }>(
    `select pi.variant_id, pi.qty_outstanding as qty,
            coalesce((select max(sh.expected_arrival_date) from shipment_items si join shipments sh on sh.id = si.shipment_id where si.purchase_order_item_id = pi.po_item_id and sh.status <> 'cancelled'), po.expected_arrival_date)::text as expected
       from v_po_item_progress pi join purchase_orders po on po.id = pi.purchase_order_id
      where pi.business_id = $1 and pi.qty_outstanding > 0 and po.status not in ('draft','cancelled','received')`,
    [tx.businessId],
  );
  const lastLots = await tx.many<{ variant_id: string; landed_cost_total: string; qty_sellable: number; purchase: string | null }>(
    `select distinct on (variant_id) variant_id, landed_cost_total, qty_sellable, cost_breakdown->>'purchase' as purchase
       from inventory_lots where business_id = $1 and not is_opening_stock and qty_sellable > 0 order by variant_id, received_date desc, created_at desc`,
    [tx.businessId],
  );
  const cash = await cashPosition(tx);
  const liab = await liabilities(tx);
  const fxCache = new Map<string, string | null>();

  const results = [];
  for (const v of variants) {
    const first = firstActivity.find((f) => f.variant_id === v.id)?.first;
    const observed = first ? Math.min(historyDays, differenceInCalendarDays(parseISO(today), parseISO(first)) + 1) : 0;
    if (!fxCache.has(v.purchase_currency)) fxCache.set(v.purchase_currency, await defaultFxRate(tx, v.purchase_currency, today));
    const fx = ov.fxRate ?? fxCache.get(v.purchase_currency) ?? null;
    const supplierPrice = ov.supplierUnitPrice ?? v.supplier_unit_price;
    const unitPurchase = fx ? D(supplierPrice).times(D(fx)) : null;
    const lot = lastLots.find((l) => l.variant_id === v.id);
    const histExtra = lot && lot.purchase !== null ? D(lot.landed_cost_total).minus(D(lot.purchase)).div(lot.qty_sellable) : null;
    const extra = ov.freightCustomsPerUnit !== undefined && ov.freightCustomsPerUnit !== null ? D(ov.freightCustomsPerUnit) : (histExtra ?? new Decimal(0));
    let contributionPerUnit: Decimal | null = null;
    if (v.default_selling_price && unitPurchase) {
      const priceEx = toExVat(v.default_selling_price, v.selling_price_includes_tax, vat);
      contributionPerUnit = evaluatePrice(pricingInputsFor(v, s, vat, { landedUnitCost: unitPurchase.plus(extra) }), priceEx).profitPerUnit;
    }
    const inputs: ReorderInputs = {
      today,
      unitsSoldInWindow: demand.find((d) => d.variant_id === v.id)?.units ?? 0,
      windowDays: observed,
      minDaysForForecast: s.min_sales_days_for_forecast,
      sellableOnHand: Math.max(0, v.on_hand),
      reserved: v.reserved,
      incoming: incoming.filter((i) => i.variant_id === v.id).map((i) => ({ qty: i.qty, expectedDate: i.expected })),
      supplierLeadDays: ov.supplierLeadDays ?? v.supplier_lead_days ?? v.supplier_default_lead ?? s.default_supplier_lead_days,
      shippingLeadDays: ov.shippingLeadDays ?? v.shipping_lead_days ?? s.default_shipping_lead_days,
      safetyStockQty: v.safety_stock_qty,
      safetyBufferDays: s.safety_buffer_days,
      targetCoverageDays: ov.coverageDays ?? s.target_coverage_days,
      minOrderQty: v.min_order_qty ?? 0,
      orderMultiple: v.order_multiple ?? 1,
      unitPurchaseCost: unitPurchase ?? 0,
      extraLandedPerUnit: extra,
      depositPct: ov.depositPct ?? v.default_deposit_pct ?? 30,
      contributionPerUnit,
      availableCash: cash.known ? cash.balance : null,
      committedLiabilities: liab.total,
      minCashReserve: s.min_cash_reserve,
      orderQtyOverride: ov.orderQty ?? null,
    };
    const result = computeReorder(inputs);
    const notes: string[] = [];
    if (!fx) notes.push(`No exchange rate recorded for ${v.purchase_currency}; purchase cost cannot be estimated. Add one in Settings.`);
    if (histExtra === null && (ov.freightCustomsPerUnit === undefined || ov.freightCustomsPerUnit === null)) notes.push('No received shipment yet, so freight & customs per unit are unknown (assumed 0). Enter an estimate in the scenario planner.');
    if (!cash.known) notes.push('Cash balance is not established (record an opening balance or owner contribution), so affordability cannot be assessed.');
    results.push({ variant: v, inputs, result, notes, fxRate: fx, historicalExtraPerUnit: histExtra });
  }
  return { results, cash, liabilities: liab, settings: s, today };
}

export async function savePurchaseScenario(tx: Tx, variantId: string, name: string, inputs: unknown, results: unknown) {
  await tx.exec('insert into purchase_scenarios (business_id, variant_id, name, inputs, results, created_by) values ($1,$2,$3,$4,$5,$6)', [tx.businessId, variantId, name, JSON.stringify(inputs), JSON.stringify(results), tx.userId]);
}

export async function listPurchaseScenarios(tx: Tx, variantId?: string) {
  return tx.many(
    `select ps.*, v.sku from purchase_scenarios ps left join product_variants v on v.id = ps.variant_id where ps.business_id = $1 and ($2::uuid is null or ps.variant_id = $2) order by ps.created_at desc limit 50`,
    [tx.businessId, variantId || null],
  );
}
