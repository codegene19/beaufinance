import { addDays, differenceInCalendarDays, formatISO, parseISO } from 'date-fns';
import { D, Decimal, type Num } from './money';

export type ReorderStatus = 'healthy' | 'plan' | 'order_soon' | 'urgent' | 'insufficient_data';

export interface ReorderInputs {
  today: string; // ISO date
  unitsSoldInWindow: number;
  windowDays: number; // days of history actually observed (<= configured window)
  minDaysForForecast: number;
  sellableOnHand: number;
  reserved: number;
  incoming: { qty: number; expectedDate: string | null }[]; // confirmed, not yet received
  supplierLeadDays: number;
  shippingLeadDays: number;
  safetyStockQty: number;
  safetyBufferDays: number;
  targetCoverageDays: number;
  planningHorizonDays?: number; // how early to start "plan next order"
  minOrderQty: number;
  orderMultiple: number;
  // cost & cash (base currency)
  unitPurchaseCost: Num; // supplier price x fx
  extraLandedPerUnit: Num; // freight, customs, other capitalised costs per unit (estimate)
  depositPct: Num;
  contributionPerUnit: Num | null; // expected contribution per unit sold, for payback
  availableCash: Num | null; // null when the cash balance is unknown
  committedLiabilities: Num;
  minCashReserve: Num;
  /** override for scenario planning */
  orderQtyOverride?: number | null;
}

export interface ReorderResult {
  status: ReorderStatus;
  reasons: string[];
  confidence: 'low' | 'medium' | 'high';
  avgDailySales: Decimal;
  available: number;
  incomingTotal: number;
  inventoryPosition: number;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  daysOfStock: Decimal | null;
  stockoutDate: string | null;
  recommendedOrderDate: string | null;
  latestOrderDate: string | null;
  suggestedQty: number;
  rawNeededQty: number;
  expectedArrivalDate: string;
  expectedSalesUntilArrival: number;
  stockAtArrival: number;
  coverageAfterArrivalDays: Decimal | null;
  cost: {
    purchase: Decimal;
    extraLanded: Decimal;
    totalLanded: Decimal;
    deposit: Decimal;
    balance: Decimal;
    landedUnitCost: Decimal;
  };
  cash: {
    known: boolean;
    available: Decimal | null;
    afterLiabilities: Decimal | null;
    afterReserve: Decimal | null;
    remainingAfterPurchase: Decimal | null;
    affordable: boolean | null;
    shortfall: Decimal | null;
  };
  paybackUnits: number | null;
}

const iso = (d: Date) => formatISO(d, { representation: 'date' });

function roundUpTo(qty: number, moq: number, multiple: number) {
  if (qty <= 0) return 0;
  let q = Math.max(qty, moq || 0);
  const m = Math.max(1, multiple || 1);
  q = Math.ceil(q / m) * m;
  return q;
}

export function computeReorder(inp: ReorderInputs): ReorderResult {
  const today = parseISO(inp.today);
  const reasons: string[] = [];
  const leadTimeDays = inp.supplierLeadDays + inp.shippingLeadDays;
  const windowDays = Math.max(0, inp.windowDays);
  const avg = windowDays > 0 ? D(inp.unitsSoldInWindow).div(windowDays) : new Decimal(0);
  const avgN = avg.toNumber();
  const available = inp.sellableOnHand - inp.reserved;
  const incomingTotal = inp.incoming.reduce((a, i) => a + i.qty, 0);
  const inventoryPosition = inp.sellableOnHand + incomingTotal - inp.reserved;
  const safetyStock = Math.max(inp.safetyStockQty, Math.ceil(avgN * inp.safetyBufferDays));
  const leadDemand = avgN * leadTimeDays;
  const reorderPoint = Math.ceil(leadDemand + safetyStock);

  const insufficient = windowDays < inp.minDaysForForecast || inp.unitsSoldInWindow < 3;
  let confidence: ReorderResult['confidence'] = 'high';
  if (insufficient) confidence = 'low';
  else if (windowDays < inp.minDaysForForecast * 2 || inp.unitsSoldInWindow < 20) confidence = 'medium';

  // Stockout projection, walking through confirmed incoming deliveries in date order
  let stockoutDate: string | null = null;
  let daysOfStock: Decimal | null = null;
  if (avgN > 0) {
    let stock = available;
    let cursor = 0;
    const deliveries = inp.incoming
      .map((i) => ({ qty: i.qty, day: i.expectedDate ? Math.max(0, differenceInCalendarDays(parseISO(i.expectedDate), today)) : leadTimeDays }))
      .sort((a, b) => a.day - b.day);
    let out: number | null = null;
    for (const dlv of deliveries) {
      const runOut = cursor + stock / avgN;
      if (runOut < dlv.day) {
        out = runOut;
        break;
      }
      stock -= (dlv.day - cursor) * avgN;
      stock += dlv.qty;
      cursor = dlv.day;
    }
    if (out === null) out = cursor + Math.max(0, stock) / avgN;
    daysOfStock = new Decimal(out).toDecimalPlaces(1);
    stockoutDate = iso(addDays(today, Math.floor(out)));
  }

  const latestOrderDate = stockoutDate ? iso(addDays(parseISO(stockoutDate), -leadTimeDays)) : null;
  const daysToRop = avgN > 0 ? (inventoryPosition - reorderPoint) / avgN : null;
  const recommendedOrderDate = daysToRop === null ? null : iso(addDays(today, Math.max(0, Math.floor(daysToRop))));

  // Quantity: cover lead time + target coverage + safety stock, net of inventory position
  const target = avgN * (leadTimeDays + inp.targetCoverageDays) + safetyStock;
  const rawNeededQty = Math.max(0, Math.ceil(target - inventoryPosition));
  const autoQty = insufficient ? 0 : roundUpTo(rawNeededQty, inp.minOrderQty, inp.orderMultiple);
  const suggestedQty = inp.orderQtyOverride !== undefined && inp.orderQtyOverride !== null ? Math.max(0, Math.round(inp.orderQtyOverride)) : autoQty;

  const expectedArrival = addDays(today, leadTimeDays);
  const expectedSalesUntilArrival = Math.round(leadDemand);
  const stockAtArrival = Math.round(inventoryPosition - leadDemand);
  const coverageAfterArrivalDays = avgN > 0 ? new Decimal(Math.max(0, stockAtArrival) + suggestedQty).div(avgN).toDecimalPlaces(0) : null;

  // Status
  let status: ReorderStatus;
  if (insufficient) {
    status = 'insufficient_data';
    reasons.push(
      windowDays < inp.minDaysForForecast
        ? `Only ${windowDays} day(s) of sales history; at least ${inp.minDaysForForecast} are needed for a reliable forecast.`
        : `Only ${inp.unitsSoldInWindow} unit(s) sold in the period — too few to estimate demand.`,
    );
    if (available <= inp.safetyStockQty) reasons.push(`Available stock (${available}) is at or below safety stock (${inp.safetyStockQty}).`);
  } else if (available <= 0 || (latestOrderDate !== null && differenceInCalendarDays(parseISO(latestOrderDate), today) <= 0)) {
    status = 'urgent';
    reasons.push(
      available <= 0
        ? 'No available stock.'
        : `At ${avg.toDecimalPlaces(2)} units/day, stock runs out on ${stockoutDate} — before a new order placed today could arrive (${leadTimeDays} days lead time).`,
    );
  } else if (inventoryPosition <= reorderPoint) {
    status = 'order_soon';
    reasons.push(`Inventory position (${inventoryPosition}) is at or below the reorder point (${reorderPoint} = ${Math.round(leadDemand)} lead-time demand + ${safetyStock} safety stock).`);
  } else if (daysToRop !== null && daysToRop <= (inp.planningHorizonDays ?? 30)) {
    status = 'plan';
    reasons.push(`Reorder point will be reached in about ${Math.ceil(daysToRop)} days (${recommendedOrderDate}). Start preparing the next order.`);
  } else {
    status = 'healthy';
    reasons.push(daysOfStock ? `About ${daysOfStock.toFixed(0)} days of stock including confirmed incoming goods.` : 'No current demand recorded.');
  }

  // Cost & affordability (financial view, separate from the inventory view)
  const purchase = D(inp.unitPurchaseCost).times(suggestedQty);
  const extraLanded = D(inp.extraLandedPerUnit).times(suggestedQty);
  const totalLanded = purchase.plus(extraLanded);
  const deposit = purchase.times(D(inp.depositPct).div(100));
  const balance = purchase.minus(deposit);
  const known = inp.availableCash !== null && inp.availableCash !== undefined;
  const available$ = known ? D(inp.availableCash) : null;
  const afterLiabilities = available$ ? available$.minus(D(inp.committedLiabilities)) : null;
  const afterReserve = afterLiabilities ? afterLiabilities.minus(D(inp.minCashReserve)) : null;
  const remainingAfterPurchase = afterLiabilities ? afterLiabilities.minus(totalLanded) : null;
  const affordable = afterReserve ? afterReserve.greaterThanOrEqualTo(totalLanded) : null;
  const shortfall = afterReserve && !affordable ? totalLanded.minus(afterReserve) : null;
  const cpu = inp.contributionPerUnit === null || inp.contributionPerUnit === undefined ? null : D(inp.contributionPerUnit);
  const paybackUnits = cpu && cpu.greaterThan(0) && suggestedQty > 0 ? Math.ceil(totalLanded.div(cpu).toNumber()) : null;

  return {
    status,
    reasons,
    confidence,
    avgDailySales: avg,
    available,
    incomingTotal,
    inventoryPosition,
    leadTimeDays,
    safetyStock,
    reorderPoint,
    daysOfStock,
    stockoutDate,
    recommendedOrderDate,
    latestOrderDate,
    suggestedQty,
    rawNeededQty,
    expectedArrivalDate: iso(expectedArrival),
    expectedSalesUntilArrival,
    stockAtArrival,
    coverageAfterArrivalDays,
    cost: { purchase, extraLanded, totalLanded, deposit, balance, landedUnitCost: suggestedQty > 0 ? totalLanded.div(suggestedQty) : D(inp.unitPurchaseCost).plus(D(inp.extraLandedPerUnit)) },
    cash: { known, available: available$, afterLiabilities, afterReserve, remainingAfterPurchase, affordable, shortfall },
    paybackUnits,
  };
}

/** Projects stock level per day for charting (no new order vs with the planned order). */
export function projectStock(inp: { today: string; available: number; avgDaily: number; incoming: { qty: number; day: number }[]; plannedQty: number; plannedArrivalDay: number; days: number }) {
  const out: { date: string; withoutOrder: number; withOrder: number }[] = [];
  let a = inp.available;
  let b = inp.available;
  const today = parseISO(inp.today);
  for (let d = 0; d <= inp.days; d++) {
    for (const i of inp.incoming) if (i.day === d) {
      a += i.qty;
      b += i.qty;
    }
    if (d === inp.plannedArrivalDay) b += inp.plannedQty;
    out.push({ date: iso(addDays(today, d)), withoutOrder: Math.max(0, Math.round(a)), withOrder: Math.max(0, Math.round(b)) });
    a -= inp.avgDaily;
    b -= inp.avgDaily;
  }
  return out;
}
