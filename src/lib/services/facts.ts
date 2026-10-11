import { Tx } from '../db/tenant';
import { D, Decimal, allocateExact, sum } from '../calc/money';

export interface ItemFact {
  orderItemId: string;
  variantId: string;
  quantity: number;
  unitsReturned: number;
  netUnits: number;
  revenue: Decimal; // ex VAT, after discounts, incl. allocated shipping revenue, before refunds
  refunds: Decimal;
  cogs: Decimal; // net of restocked returns
  variableCosts: Decimal; // allocated fulfilment, packaging, shipping, fees, return shipping
  contribution: Decimal; // before advertising
}

export interface OrderFact {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  channelId: string | null;
  campaignId: string | null;
  recognizedDate: string | null;
  delivered: boolean;
  units: number;
  grossMerch: Decimal;
  discounts: Decimal;
  shippingRevenue: Decimal;
  revenue: Decimal; // net of discounts, ex VAT, before refunds
  refunds: Decimal;
  netSales: Decimal;
  vat: Decimal;
  cogs: Decimal;
  fulfilment: Decimal;
  sellingFees: Decimal;
  returnShipping: Decimal;
  contribution: Decimal; // before advertising
  items: ItemFact[];
}

/**
 * Financial facts for every order in base currency, ex VAT, built from recorded transactions only.
 * Only orders with a recognition date (per the configured revenue-recognition rule) count as sales.
 */
export async function orderFacts(tx: Tx, f: { from?: string | null; to?: string | null; recognizedOnly?: boolean; byOrderDate?: boolean } = {}): Promise<OrderFact[]> {
  const dateCol = f.byOrderDate ? 'o.order_date' : 'o.recognized_date';
  const orders = await tx.many(
    `select o.* from v_order_financials o where o.business_id = $1
       and ($2::date is null or ${dateCol} >= $2) and ($3::date is null or ${dateCol} <= $3)
       and (not $4 or o.recognized_date is not null)`,
    [tx.businessId, f.from || null, f.to || null, f.recognizedOnly !== false],
  );
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const items = await tx.many(
    `select i.id, i.order_id, i.variant_id, i.quantity, i.unit_price, i.line_discount,
            coalesce((select -sum(m.quantity * l.landed_unit_cost) from inventory_movements m join inventory_lots l on l.id = m.lot_id where m.order_item_id = i.id), 0) as cogs,
            coalesce((select sum(ri.quantity) from return_items ri where ri.order_item_id = i.id), 0)::int as returned
       from sales_order_items i where i.order_id = any($1::uuid[])`,
    [ids],
  );
  const byOrder = new Map<string, any[]>();
  for (const it of items) (byOrder.get(it.order_id) ?? byOrder.set(it.order_id, []).get(it.order_id)!).push(it);

  return orders.map((o) => {
    const t = D(o.tax_rate_pct).div(100).plus(1);
    const its = byOrder.get(o.id) ?? [];
    const revenue = D(o.gross_merch_base).minus(D(o.discounts_base)).plus(D(o.shipping_revenue_base));
    const refunds = D(o.refunds_base);
    const fulfilment = D(o.fulfilment_costs_base);
    const sellingFees = D(o.selling_fees_base);
    const returnShipping = D(o.return_shipping_base);
    const cogs = sum(its.map((i) => i.cogs));
    // allocate order-level amounts to items by their share of item net value
    const weights = its.map((i) => D(i.unit_price).times(i.quantity).minus(D(i.line_discount)));
    const wSum = sum(weights);
    const w = wSum.isZero() ? its.map((i) => D(i.quantity)) : weights;
    const split = (amt: Decimal) => (its.length ? (sum(w).isZero() ? its.map(() => new Decimal(0)) : allocateExact(amt, w)) : []);
    const revSplit = split(revenue);
    const refSplit = split(refunds);
    const varSplit = split(fulfilment.plus(sellingFees).plus(returnShipping));
    const itemFacts: ItemFact[] = its.map((i, k) => {
      const c = D(i.cogs);
      return {
        orderItemId: i.id,
        variantId: i.variant_id,
        quantity: i.quantity,
        unitsReturned: i.returned,
        netUnits: i.quantity - i.returned,
        revenue: revSplit[k],
        refunds: refSplit[k],
        cogs: c,
        variableCosts: varSplit[k],
        contribution: revSplit[k].minus(refSplit[k]).minus(c).minus(varSplit[k]),
      };
    });
    return {
      id: o.id,
      orderNumber: o.order_number,
      orderDate: o.order_date,
      status: o.status,
      channelId: o.channel_id,
      campaignId: o.campaign_id,
      recognizedDate: o.recognized_date,
      delivered: ['delivered', 'returned'].includes(o.status),
      units: o.units,
      grossMerch: D(o.gross_merch_base),
      discounts: D(o.discounts_base),
      shippingRevenue: D(o.shipping_revenue_base),
      revenue,
      refunds,
      netSales: revenue.minus(refunds),
      vat: revenue.minus(refunds).times(t.minus(1)),
      cogs,
      fulfilment,
      sellingFees,
      returnShipping,
      contribution: revenue.minus(refunds).minus(cogs).minus(fulfilment).minus(sellingFees).minus(returnShipping),
      items: itemFacts,
    };
  });
}
