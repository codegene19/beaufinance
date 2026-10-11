import { D, Decimal, type Num } from './money';

/**
 * Unit-economics model for one product sold in orders of `unitsPerOrder` units.
 * All money inputs are in base currency and EXCLUDE VAT unless stated.
 */
export interface PricingInputs {
  landedUnitCost: Num;
  packagingPerUnit: Num;
  fulfillmentPerOrder: Num; // pick/pack/handling
  shippingPerOrder: Num; // shipping paid by the business
  customerShippingRevenue: Num; // charged to customer, tax-INCLUSIVE when vat applies
  unitsPerOrder: number;
  paymentFeePct: Num;
  paymentFeeFixed: Num;
  marketplaceFeePct: Num;
  marketplaceFeeFixed: Num;
  adCostPerOrder: Num; // advertising cost per delivered order
  returnRatePct: Num; // % of orders refunded
  returnCostPerReturn: Num; // return shipping / handling per returned order
  returnResellablePct: Num; // % of returned units that can be resold
  discountPct: Num;
  vatRatePct: Num;
  /** whether % fees are charged on the VAT-inclusive amount the customer pays (typical for card/marketplace) */
  feesOnGross: boolean;
}

export interface PricingResult {
  priceExVat: Decimal; // list price per unit, excluding VAT, before discount
  priceInclVat: Decimal;
  netRevenuePerOrder: Decimal; // ex VAT, after discount and expected refunds
  grossCollectedPerOrder: Decimal; // what the customer pays incl. VAT (before refunds)
  costs: {
    product: Decimal;
    packaging: Decimal;
    fulfillment: Decimal;
    shipping: Decimal;
    paymentFees: Decimal;
    marketplaceFees: Decimal;
    advertising: Decimal;
    returns: Decimal;
  };
  contributionPerOrder: Decimal; // after advertising
  contributionBeforeAdsPerOrder: Decimal;
  profitPerUnit: Decimal;
  marginPct: Decimal | null; // contribution / net revenue ex VAT
  marginBeforeAdsPct: Decimal | null;
  markupPct: Decimal | null; // profit per unit / landed unit cost
  vatPerOrder: Decimal;
}

const hundred = new Decimal(100);

export function evaluatePrice(inp: PricingInputs, priceExVat: Num): PricingResult {
  const P = D(priceExVat);
  const u = Math.max(1, inp.unitsPerOrder || 1);
  const v = D(inp.vatRatePct).div(hundred);
  const d = D(inp.discountPct).div(hundred);
  const r = D(inp.returnRatePct).div(hundred);
  const k = D(inp.returnResellablePct).div(hundred);

  const shipRevEx = D(inp.customerShippingRevenue).div(v.plus(1));
  const merchEx = P.times(u).times(new Decimal(1).minus(d));
  const revenueEx = merchEx.plus(shipRevEx); // before refunds
  const gross = revenueEx.times(v.plus(1));
  const netRevenue = revenueEx.times(new Decimal(1).minus(r)); // expected refunds reverse revenue

  const feeBase = inp.feesOnGross ? gross : revenueEx;
  const paymentFees = feeBase.times(D(inp.paymentFeePct).div(hundred)).plus(D(inp.paymentFeeFixed));
  const marketplaceFees = feeBase.times(D(inp.marketplaceFeePct).div(hundred)).plus(D(inp.marketplaceFeeFixed));
  // Product cost: units from returned orders that are resellable come back to stock
  const product = D(inp.landedUnitCost).times(u).times(new Decimal(1).minus(r.times(k)));
  const packaging = D(inp.packagingPerUnit).times(u);
  const fulfillment = D(inp.fulfillmentPerOrder);
  const shipping = D(inp.shippingPerOrder);
  const advertising = D(inp.adCostPerOrder);
  const returns = r.times(D(inp.returnCostPerReturn));

  const before = netRevenue.minus(product).minus(packaging).minus(fulfillment).minus(shipping).minus(paymentFees).minus(marketplaceFees).minus(returns);
  const contribution = before.minus(advertising);
  const landed = D(inp.landedUnitCost);
  return {
    priceExVat: P,
    priceInclVat: P.times(v.plus(1)),
    netRevenuePerOrder: netRevenue,
    grossCollectedPerOrder: gross,
    costs: { product, packaging, fulfillment, shipping, paymentFees, marketplaceFees, advertising, returns },
    contributionPerOrder: contribution,
    contributionBeforeAdsPerOrder: before,
    profitPerUnit: contribution.div(u),
    marginPct: netRevenue.isZero() ? null : contribution.div(netRevenue).times(hundred),
    marginBeforeAdsPct: netRevenue.isZero() ? null : before.div(netRevenue).times(hundred),
    markupPct: landed.isZero() ? null : contribution.div(u).div(landed).times(hundred),
    vatPerOrder: gross.minus(revenueEx),
  };
}

/**
 * Solve for the ex-VAT unit price that yields `targetMarginPct` contribution margin.
 * Contribution and net revenue are both linear in price, so the solution is exact:
 *   C(P) = a·P + b,   N(P) = c·P + e,   C = m·N  =>  P = (m·e − b) / (a − m·c)
 * Returns null when the target is unreachable (e.g. % fees + margin >= 100%).
 */
export function solvePriceForMargin(inp: PricingInputs, targetMarginPct: Num): Decimal | null {
  const m = D(targetMarginPct).div(hundred);
  if (m.greaterThanOrEqualTo(1)) return null;
  const r0 = evaluatePrice(inp, 0);
  const r1 = evaluatePrice(inp, 1);
  const a = r1.contributionPerOrder.minus(r0.contributionPerOrder);
  const b = r0.contributionPerOrder;
  const c = r1.netRevenuePerOrder.minus(r0.netRevenuePerOrder);
  const e = r0.netRevenuePerOrder;
  const den = a.minus(m.times(c));
  if (den.lessThanOrEqualTo(0)) return null;
  const P = m.times(e).minus(b).div(den);
  return P.lessThan(0) ? new Decimal(0) : P;
}

/** Break-even price: contribution (after advertising) exactly zero. */
export function breakEvenPrice(inp: PricingInputs): Decimal | null {
  return solvePriceForMargin(inp, 0);
}

/** Round a VAT-inclusive consumer price up to a .90 ending (e.g. 23.41 -> 23.90). */
export function charmRoundUp(priceInclVat: Num): Decimal {
  const p = D(priceInclVat);
  const whole = p.floor();
  const candidate = whole.plus(0.9);
  return candidate.greaterThanOrEqualTo(p) ? candidate : whole.plus(1.9);
}

export interface ScenarioSet {
  breakEvenExVat: Decimal | null;
  minimum: Decimal | null; // conservative: min acceptable margin
  target: Decimal | null;
  premium: Decimal | null;
}

export function priceScenarios(inp: PricingInputs, minMarginPct: Num, targetMarginPct: Num, premiumUpliftPct: Num): ScenarioSet {
  return {
    breakEvenExVat: breakEvenPrice(inp),
    minimum: solvePriceForMargin(inp, minMarginPct),
    target: solvePriceForMargin(inp, targetMarginPct),
    premium: solvePriceForMargin(inp, D(targetMarginPct).plus(D(premiumUpliftPct))),
  };
}

/** Convert a displayed price to ex-VAT using the declared tax basis. */
export function toExVat(price: Num, includesTax: boolean, vatRatePct: Num): Decimal {
  return includesTax ? D(price).div(D(vatRatePct).div(hundred).plus(1)) : D(price);
}

export type MarginStatus = 'below_break_even' | 'below_minimum' | 'below_target' | 'on_target' | 'unknown';

export function marginStatus(marginPct: Decimal | null, minPct: Num, targetPct: Num): MarginStatus {
  if (marginPct === null) return 'unknown';
  if (marginPct.lessThan(0)) return 'below_break_even';
  if (marginPct.lessThan(D(minPct))) return 'below_minimum';
  if (marginPct.lessThan(D(targetPct))) return 'below_target';
  return 'on_target';
}
