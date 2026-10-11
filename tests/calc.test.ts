import { describe, expect, it } from 'vitest';
import { D, allocateExact, sum } from '@/lib/calc/money';
import { allocatePool, lotLandedCost, type PoolLine } from '@/lib/calc/landed';
import { evaluatePrice, solvePriceForMargin, breakEvenPrice, charmRoundUp, toExVat, marginStatus, type PricingInputs } from '@/lib/calc/pricing';
import { computeReorder, type ReorderInputs } from '@/lib/calc/reorder';
import { campaignMetrics, classifyProfitability, orderRevenue } from '@/lib/calc/analytics';

describe('money', () => {
  it('allocates exactly with largest remainder (no lost cents)', () => {
    const parts = allocateExact('100.00', [1, 1, 1], 2);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(parts).toFixed(2)).toBe('100.00');
  });
  it('avoids floating point drift', () => {
    expect(D('0.1').plus('0.2').toString()).toBe('0.3');
  });
  it('refuses to allocate on zero weights', () => {
    expect(() => allocateExact(10, [0, 0])).toThrow();
  });
});

const lines: PoolLine[] = [
  { lineId: 'A', poItemId: 'pA', shipmentItemId: 'sA', variantId: 'vA', label: 'Argan oil', quantity: 100, purchaseValueBase: '600', totalWeightKg: '15', totalVolumeM3: '0.02' },
  { lineId: 'B', poItemId: 'pB', shipmentItemId: 'sB', variantId: 'vB', label: 'Rhassoul clay', quantity: 300, purchaseValueBase: '900', totalWeightKg: '45', totalVolumeM3: null },
];

describe('landed cost allocation', () => {
  it('allocates by quantity, value and weight', () => {
    const { allocations, lineCosts, issues } = allocatePool(lines, [
      { expenseId: 'freight', name: 'Freight', category: 'freight', amountBase: '400', method: 'weight' },
      { expenseId: 'duty', name: 'Duty', category: 'customs_duty', amountBase: '150', method: 'value' },
      { expenseId: 'label', name: 'Labels', category: 'packaging_labeling', amountBase: '40', method: 'quantity' },
    ]);
    expect(issues).toEqual([]);
    const a = (e: string, l: string) => allocations.find((x) => x.expenseId === e && x.lineId === l)!.amount.toFixed(2);
    expect(a('freight', 'A')).toBe('100.00'); // 15/60
    expect(a('freight', 'B')).toBe('300.00');
    expect(a('duty', 'A')).toBe('60.00'); // 600/1500
    expect(a('duty', 'B')).toBe('90.00');
    expect(a('label', 'A')).toBe('10.00');
    expect(a('label', 'B')).toBe('30.00');
    const A = lineCosts.find((l) => l.lineId === 'A')!;
    expect(A.total.toFixed(2)).toBe('770.00');
    expect(A.perBasisUnit.toFixed(2)).toBe('7.70');
    // Reconciliation: allocated amounts equal the source costs exactly
    expect(sum(allocations.map((x) => x.amount)).toFixed(2)).toBe('590.00');
  });

  it('reports instead of guessing when volume data is missing', () => {
    const { allocations, issues } = allocatePool(lines, [{ expenseId: 'x', name: 'Volume freight', category: 'freight', amountBase: '100', method: 'volume' }]);
    expect(allocations).toHaveLength(0);
    expect(issues[0].message).toMatch(/volume is missing/);
  });

  it('reports missing exchange rates', () => {
    const { issues } = allocatePool(lines, [{ expenseId: 'x', name: 'Broker', category: 'broker', amountBase: null, method: 'value' }]);
    expect(issues[0].message).toMatch(/exchange rate/);
  });

  it('supports manual shares and variant-restricted costs', () => {
    const { allocations } = allocatePool(lines, [
      { expenseId: 'm', name: 'Inspection', category: 'inspection', amountBase: '50', method: 'manual', manualShares: [{ variantId: 'vA', sharePct: 80 }, { variantId: 'vB', sharePct: 20 }] },
      { expenseId: 'only-b', name: 'Clay testing', category: 'quality_check', amountBase: '30', method: 'quantity', variantId: 'vB' },
    ]);
    expect(allocations.find((x) => x.expenseId === 'm' && x.lineId === 'A')!.amount.toFixed(2)).toBe('40.00');
    expect(allocations.filter((x) => x.expenseId === 'only-b')).toHaveLength(1);
    expect(allocations.find((x) => x.expenseId === 'only-b')!.lineId).toBe('B');
  });

  it('spreads losses over sellable units only', () => {
    // 100 units at 7.70 each; 95 arrive, 5 of them damaged, 5 missing -> 90 sellable
    const r = lotLandedCost('7.70', { received: 95, damaged: 5, rejected: 0, missing: 5 });
    expect(r.sellableUnits).toBe(90);
    expect(r.total.toFixed(2)).toBe('770.00');
    expect(r.unitCost!.toFixed(4)).toBe('8.5556');
  });

  it('handles partial receipts without inflating unit cost', () => {
    const first = lotLandedCost('7.70', { received: 60, damaged: 0, rejected: 0, missing: 0 });
    expect(first.unitCost!.toFixed(2)).toBe('7.70');
  });
});

const base: PricingInputs = {
  landedUnitCost: 6,
  packagingPerUnit: 0.8,
  fulfillmentPerOrder: 1.5,
  shippingPerOrder: 5.5,
  customerShippingRevenue: 0,
  unitsPerOrder: 1,
  paymentFeePct: 1.5,
  paymentFeeFixed: 0.25,
  marketplaceFeePct: 0,
  marketplaceFeeFixed: 0,
  adCostPerOrder: 4,
  returnRatePct: 3,
  returnCostPerReturn: 6,
  returnResellablePct: 80,
  discountPct: 0,
  vatRatePct: 20,
  feesOnGross: true,
};

describe('pricing calculator', () => {
  it('evaluates unit economics at a given price (worked example)', () => {
    const r = evaluatePrice(base, 25);
    expect(r.priceInclVat.toFixed(2)).toBe('30.00');
    expect(r.netRevenuePerOrder.toFixed(2)).toBe('24.25');
    expect(r.costs.paymentFees.toFixed(2)).toBe('0.70');
    expect(r.costs.product.toFixed(3)).toBe('5.856');
    expect(r.contributionPerOrder.toFixed(3)).toBe('5.714');
    expect(r.marginPct!.toFixed(2)).toBe('23.56');
    // markup is profit / cost, margin is profit / revenue — they differ
    expect(r.markupPct!.toFixed(2)).toBe('95.23');
  });

  it('solves exactly for a target contribution margin', () => {
    const p = solvePriceForMargin(base, 30)!;
    const r = evaluatePrice(base, p);
    expect(r.marginPct!.toFixed(6)).toBe('30.000000');
  });

  it('break-even price yields zero contribution', () => {
    const p = breakEvenPrice(base)!;
    expect(evaluatePrice(base, p).contributionPerOrder.abs().lessThan('0.000001')).toBe(true);
  });

  it('accounts for fees charged on VAT-inclusive prices', () => {
    const onGross = solvePriceForMargin(base, 30)!;
    const onNet = solvePriceForMargin({ ...base, feesOnGross: false }, 30)!;
    expect(onGross.greaterThan(onNet)).toBe(true);
  });

  it('returns null when the target margin is unreachable', () => {
    expect(solvePriceForMargin({ ...base, marketplaceFeePct: 80 }, 30)).toBeNull();
  });

  it('handles zero advertising and multi-unit orders', () => {
    const r = evaluatePrice({ ...base, adCostPerOrder: 0, unitsPerOrder: 2 }, 25);
    expect(r.costs.advertising.toFixed(2)).toBe('0.00');
    expect(r.profitPerUnit.times(2).toFixed(6)).toBe(r.contributionPerOrder.toFixed(6));
  });

  it('converts tax-inclusive prices and rounds charm prices', () => {
    expect(toExVat(30, true, 20).toFixed(2)).toBe('25.00');
    expect(toExVat(30, false, 20).toFixed(2)).toBe('30.00');
    expect(charmRoundUp(23.41).toFixed(2)).toBe('23.90');
    expect(charmRoundUp(23.95).toFixed(2)).toBe('24.90');
  });

  it('flags margin status', () => {
    expect(marginStatus(D(-1), 20, 35)).toBe('below_break_even');
    expect(marginStatus(D(10), 20, 35)).toBe('below_minimum');
    expect(marginStatus(D(25), 20, 35)).toBe('below_target');
    expect(marginStatus(D(40), 20, 35)).toBe('on_target');
    expect(marginStatus(null, 20, 35)).toBe('unknown');
  });
});

const ro: ReorderInputs = {
  today: '2026-10-10',
  unitsSoldInWindow: 120,
  windowDays: 60,
  minDaysForForecast: 14,
  sellableOnHand: 150,
  reserved: 10,
  incoming: [],
  supplierLeadDays: 30,
  shippingLeadDays: 21,
  safetyStockQty: 20,
  safetyBufferDays: 14,
  targetCoverageDays: 120,
  minOrderQty: 200,
  orderMultiple: 50,
  unitPurchaseCost: 5,
  extraLandedPerUnit: 1.5,
  depositPct: 30,
  contributionPerUnit: 8,
  availableCash: 5000,
  committedLiabilities: 1000,
  minCashReserve: 1000,
};

describe('reorder planning', () => {
  it('computes velocity, stockout date and reorder point', () => {
    const r = computeReorder(ro);
    expect(r.avgDailySales.toFixed(2)).toBe('2.00');
    expect(r.available).toBe(140);
    expect(r.daysOfStock!.toFixed(0)).toBe('70');
    expect(r.stockoutDate).toBe('2026-12-19');
    expect(r.leadTimeDays).toBe(51);
    expect(r.safetyStock).toBe(28); // max(20, 2*14)
    expect(r.reorderPoint).toBe(130); // 102 + 28
    expect(r.latestOrderDate).toBe('2026-10-29');
    expect(r.status).toBe('plan');
  });

  it('suggests a quantity honouring coverage, MOQ and multiples', () => {
    const r = computeReorder(ro);
    // target = 2*(51+120) + 28 = 370, position 140 -> need 230 -> multiple of 50 -> 250
    expect(r.rawNeededQty).toBe(230);
    expect(r.suggestedQty).toBe(250);
    expect(r.cost.purchase.toFixed(2)).toBe('1250.00');
    expect(r.cost.totalLanded.toFixed(2)).toBe('1625.00');
    expect(r.cost.deposit.toFixed(2)).toBe('375.00');
    expect(r.cash.afterReserve!.toFixed(2)).toBe('3000.00');
    expect(r.cash.affordable).toBe(true);
    expect(r.paybackUnits).toBe(204);
  });

  it('is urgent when stock runs out before a new order could arrive', () => {
    const r = computeReorder({ ...ro, sellableOnHand: 60 });
    expect(r.status).toBe('urgent');
    expect(r.reasons[0]).toMatch(/runs out/);
  });

  it('takes confirmed incoming stock into account', () => {
    const r = computeReorder({ ...ro, sellableOnHand: 60, incoming: [{ qty: 300, expectedDate: '2026-10-30' }] });
    expect(r.inventoryPosition).toBe(350);
    expect(r.status).toBe('healthy');
  });

  it('flags insufficient history and does not invent a quantity', () => {
    const r = computeReorder({ ...ro, windowDays: 5, unitsSoldInWindow: 2 });
    expect(r.status).toBe('insufficient_data');
    expect(r.suggestedQty).toBe(0);
    const z = computeReorder({ ...ro, unitsSoldInWindow: 0 });
    expect(z.status).toBe('insufficient_data');
    expect(z.stockoutDate).toBeNull();
  });

  it('separates affordability from the inventory recommendation', () => {
    const r = computeReorder({ ...ro, sellableOnHand: 60, availableCash: 1500 });
    expect(r.status).toBe('urgent');
    expect(r.cash.affordable).toBe(false);
    expect(r.cash.shortfall!.greaterThan(0)).toBe(true);
    const unknown = computeReorder({ ...ro, availableCash: null });
    expect(unknown.cash.known).toBe(false);
    expect(unknown.cash.affordable).toBeNull();
  });

  it('supports scenario overrides', () => {
    const r = computeReorder({ ...ro, orderQtyOverride: 500 });
    expect(r.suggestedQty).toBe(500);
    expect(r.cost.totalLanded.toFixed(2)).toBe('3250.00');
    expect(r.cash.affordable).toBe(false);
  });
});

describe('analytics', () => {
  it('computes CPA, delivered CPA and ROAS, with zero spend handled', () => {
    const m = campaignMetrics({ spend: 300, orders: 20, deliveredOrders: 15, revenueExVat: 900, contributionBeforeAds: 420 });
    expect(m.cpa!.toFixed(2)).toBe('15.00');
    expect(m.deliveredCpa!.toFixed(2)).toBe('20.00');
    expect(m.roas!.toFixed(2)).toBe('3.00');
    expect(m.profitAfterAds.toFixed(2)).toBe('120.00');
    const z = campaignMetrics({ spend: 0, orders: 0, deliveredOrders: 0, revenueExVat: 0, contributionBeforeAds: 0 });
    expect(z.cpa).toBeNull();
    expect(z.roas).toBeNull();
  });

  it('classifies profitability and refuses to judge without data', () => {
    expect(classifyProfitability({ unitsSold: 0, netRevenue: 0, contribution: 0, hasCost: true, targetMarginPct: 30 }).cls).toBe('insufficient_data');
    expect(classifyProfitability({ unitsSold: 10, netRevenue: 100, contribution: 40, hasCost: false, targetMarginPct: 30 }).cls).toBe('insufficient_data');
    expect(classifyProfitability({ unitsSold: 10, netRevenue: 100, contribution: 40, hasCost: true, targetMarginPct: 30 }).cls).toBe('profitable');
    expect(classifyProfitability({ unitsSold: 10, netRevenue: 100, contribution: 20, hasCost: true, targetMarginPct: 30 }).cls).toBe('below_target');
    expect(classifyProfitability({ unitsSold: 10, netRevenue: 100, contribution: 1, hasCost: true, targetMarginPct: 30 }).cls).toBe('break_even');
    expect(classifyProfitability({ unitsSold: 10, netRevenue: 100, contribution: -10, hasCost: true, targetMarginPct: 30 }).cls).toBe('unprofitable');
  });

  it('computes order revenue excluding VAT for tax-inclusive prices', () => {
    const r = orderRevenue({ pricesIncludeTax: true, taxRatePct: 20, items: [{ quantity: 2, unitPrice: 30, lineDiscount: 6 }], shippingCharged: 6, orderDiscount: 0 });
    expect(r.grossMerchExVat.toFixed(2)).toBe('50.00');
    expect(r.discountsExVat.toFixed(2)).toBe('5.00');
    expect(r.shippingExVat.toFixed(2)).toBe('5.00');
    expect(r.netExVat.toFixed(2)).toBe('50.00');
    expect(r.vat.toFixed(2)).toBe('10.00');
  });
});
