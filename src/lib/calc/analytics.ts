import { D, Decimal, div, type Num } from './money';

export interface CampaignMetricsInput {
  spend: Num;
  orders: number;
  deliveredOrders: number;
  revenueExVat: Num; // attributed, recognised, net of refunds
  sessions?: number | null;
  contributionBeforeAds: Num; // from attributed delivered orders
}

export function campaignMetrics(m: CampaignMetricsInput) {
  const spend = D(m.spend);
  return {
    cpa: m.orders > 0 ? spend.div(m.orders) : null,
    deliveredCpa: m.deliveredOrders > 0 ? spend.div(m.deliveredOrders) : null,
    roas: spend.isZero() ? null : D(m.revenueExVat).div(spend),
    conversionRatePct: m.sessions && m.sessions > 0 ? new Decimal(m.orders).div(m.sessions).times(100) : null,
    profitAfterAds: D(m.contributionBeforeAds).minus(spend),
  };
}

export type ProfitClass = 'profitable' | 'below_target' | 'break_even' | 'unprofitable' | 'insufficient_data';

/** Classifies a product from ACTUAL unit economics (completed sales). */
export function classifyProfitability(input: { unitsSold: number; netRevenue: Num; contribution: Num; hasCost: boolean; targetMarginPct: Num; breakEvenBandPct?: Num }) {
  if (input.unitsSold <= 0 || !input.hasCost || D(input.netRevenue).lessThanOrEqualTo(0)) {
    return { cls: 'insufficient_data' as ProfitClass, marginPct: null as Decimal | null };
  }
  const margin = div(input.contribution, input.netRevenue)!.times(100);
  const band = D(input.breakEvenBandPct ?? 2);
  let cls: ProfitClass;
  if (margin.abs().lessThan(band)) cls = 'break_even';
  else if (margin.lessThan(0)) cls = 'unprofitable';
  else if (margin.lessThan(D(input.targetMarginPct))) cls = 'below_target';
  else cls = 'profitable';
  return { cls, marginPct: margin };
}

/** Revenue figures for an order, all excluding VAT, in order currency. */
export function orderRevenue(o: { pricesIncludeTax: boolean; taxRatePct: Num; items: { quantity: number; unitPrice: Num; lineDiscount: Num }[]; shippingCharged: Num; orderDiscount: Num }) {
  const t = D(o.taxRatePct).div(100).plus(1);
  const conv = (v: Num) => (o.pricesIncludeTax ? D(v).div(t) : D(v));
  const grossMerch = o.items.reduce((a, i) => a.plus(D(i.unitPrice).times(i.quantity)), new Decimal(0));
  const lineDisc = o.items.reduce((a, i) => a.plus(D(i.lineDiscount)), new Decimal(0));
  const discounts = lineDisc.plus(D(o.orderDiscount));
  const merchExVat = conv(grossMerch);
  const discountsExVat = conv(discounts);
  const shippingExVat = conv(o.shippingCharged);
  const netExVat = merchExVat.minus(discountsExVat).plus(shippingExVat);
  const totalInclVat = netExVat.times(t);
  return { grossMerchExVat: merchExVat, discountsExVat, shippingExVat, netExVat, vat: totalInclVat.minus(netExVat), totalInclVat };
}
