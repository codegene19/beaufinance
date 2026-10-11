import { Tx } from '../db/tenant';
import { AppError } from '../errors';
import { D } from '../calc/money';
import type { SalesOrderInput } from '../validation/schemas';
import { getSettings } from './business';
import { reserveForItem } from './inventory';

export interface OrderFilters {
  q?: string;
  status?: string;
  paymentStatus?: string;
  channelId?: string;
  campaignId?: string;
  variantId?: string;
  from?: string;
  to?: string;
  recognized?: boolean;
  limit?: number;
  offset?: number;
}

export async function listOrders(tx: Tx, f: OrderFilters = {}) {
  return tx.many(
    `select o.*, so.order_number, c.name as customer_name, ch.name as channel_name, cp.name as campaign_name, so.tracking_ref, so.delivery_provider,
            count(*) over() as total_count
       from v_order_financials o join sales_orders so on so.id = o.id
       left join customers c on c.id = so.customer_id left join sales_channels ch on ch.id = o.channel_id left join campaigns cp on cp.id = o.campaign_id
      where o.business_id = $1
        and ($2::text is null or o.order_number ilike '%' || $2 || '%' or c.name ilike '%' || $2 || '%' or so.tracking_ref ilike '%' || $2 || '%')
        and ($3::text is null or o.status::text = $3)
        and ($4::text is null or o.payment_status::text = $4)
        and ($5::uuid is null or o.channel_id = $5)
        and ($6::uuid is null or o.campaign_id = $6)
        and ($7::uuid is null or exists (select 1 from sales_order_items i where i.order_id = o.id and i.variant_id = $7))
        and ($8::date is null or o.order_date >= $8) and ($9::date is null or o.order_date <= $9)
        and (not $10 or o.recognized_date is not null)
      order by o.order_date desc, so.created_at desc
      limit $11 offset $12`,
    [tx.businessId, f.q || null, f.status || null, f.paymentStatus || null, f.channelId || null, f.campaignId || null, f.variantId || null, f.from || null, f.to || null, !!f.recognized, f.limit ?? 50, f.offset ?? 0],
  );
}

export async function getOrder(tx: Tx, id: string) {
  const order = await tx.one(
    `select so.*, o.total_incl_tax, o.paid, o.refunded, o.gross_merch_base, o.discounts_base, o.shipping_revenue_base, o.refunds_base, o.cogs_shipped_base, o.cogs_returned_base,
            o.fulfilment_costs_base, o.selling_fees_base, o.return_shipping_base, o.recognized_date, o.units,
            c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.city as customer_city, ch.name as channel_name, cp.name as campaign_name
       from sales_orders so join v_order_financials o on o.id = so.id
       left join customers c on c.id = so.customer_id left join sales_channels ch on ch.id = so.channel_id left join campaigns cp on cp.id = so.campaign_id
      where so.id = $1 and so.business_id = $2`,
    [id, tx.businessId],
    'Order not found',
  );
  const items = await tx.many(
    `select i.*, v.sku, v.variant_name, p.name as product_name,
            coalesce((select sum(quantity) from order_lot_allocations a where a.order_item_id = i.id and a.status = 'shipped'),0)::int as shipped_qty,
            coalesce((select sum(quantity) from return_items r where r.order_item_id = i.id),0)::int as returned_qty
       from sales_order_items i join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id where i.order_id = $1 order by p.name`,
    [id],
  );
  const allocations = await tx.many(
    `select a.*, l.lot_code, l.landed_unit_cost, l.expiry_date, i.variant_id from order_lot_allocations a join inventory_lots l on l.id = a.lot_id join sales_order_items i on i.id = a.order_item_id where i.order_id = $1 order by a.created_at`,
    [id],
  );
  const payments = await tx.many('select * from order_payments where order_id = $1 order by payment_date, created_at', [id]);
  const returns = await tx.many(
    `select r.*, coalesce(json_agg(json_build_object('order_item_id', ri.order_item_id, 'quantity', ri.quantity, 'condition', ri.condition)) filter (where ri.id is not null), '[]') as items
       from returns r left join return_items ri on ri.return_id = r.id where r.order_id = $1 group by r.id order by r.return_date`,
    [id],
  );
  const movements = await tx.many(`select m.*, l.lot_code from inventory_movements m join inventory_lots l on l.id = m.lot_id where m.reference_type = 'sales_order' and m.reference_id = $1 order by m.created_at`, [id]);
  return { order, items, allocations, payments, returns, movements };
}

export async function nextOrderNumber(tx: Tx) {
  const r = await tx.one<{ n: number }>(`select count(*)::int as n from sales_orders where business_id = $1`, [tx.businessId]);
  let n = r.n + 1001;
  while (await tx.maybe('select 1 from sales_orders where business_id = $1 and order_number = $2', [tx.businessId, `SO-${n}`])) n++;
  return `SO-${n}`;
}

async function upsertCustomer(tx: Tx, input: SalesOrderInput) {
  if (!input.customer_name && !input.customer_email && !input.customer_phone) return null;
  if (input.customer_email) {
    const ex = await tx.maybe<{ id: string }>('select id from customers where business_id = $1 and lower(email) = lower($2) limit 1', [tx.businessId, input.customer_email]);
    if (ex) {
      await tx.exec('update customers set name = coalesce($2, name), phone = coalesce($3, phone), city = coalesce($4, city) where id = $1', [ex.id, input.customer_name, input.customer_phone, input.customer_city]);
      return ex.id;
    }
  }
  const c = await tx.one<{ id: string }>(
    'insert into customers (business_id, name, email, phone, city, country) values ($1,$2,$3,$4,$5,$6) returning id',
    [tx.businessId, input.customer_name ?? input.customer_email ?? input.customer_phone, input.customer_email, input.customer_phone, input.customer_city, input.market_code],
  );
  return c.id;
}

async function reserveOrder(tx: Tx, orderId: string, asOf: string, allowNegative: boolean) {
  const items = await tx.many<{ id: string; variant_id: string; quantity: number; sku: string }>(
    'select i.id, i.variant_id, i.quantity, v.sku from sales_order_items i join product_variants v on v.id = i.variant_id where i.order_id = $1',
    [orderId],
  );
  const warnings: string[] = [];
  for (const it of items) {
    const existing = await tx.one<{ n: number }>(`select coalesce(sum(quantity),0)::int as n from order_lot_allocations where order_item_id = $1 and status in ('reserved','shipped')`, [it.id]);
    if (existing.n > 0) continue; // idempotent: already reserved
    warnings.push(...(await reserveForItem(tx, it, { allowNegative, asOf })));
  }
  return warnings;
}

export async function createOrder(tx: Tx, input: SalesOrderInput) {
  const customerId = await upsertCustomer(tx, input);
  const o = await tx.one<{ id: string }>(
    `insert into sales_orders (business_id, order_number, order_date, customer_id, channel_id, campaign_id, market_code, currency, fx_rate, prices_include_tax, tax_rate_pct,
       shipping_charged, order_discount, payment_method, status, delivery_provider, tracking_ref, shipping_cost, fulfillment_cost, packaging_cost, payment_fee, platform_fee, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',$15,$16,$17,$18,$19,$20,$21,$22) returning id`,
    [tx.businessId, input.order_number, input.order_date, customerId, input.channel_id, input.campaign_id, input.market_code, input.currency, input.fx_rate, input.prices_include_tax, input.tax_rate_pct,
     input.shipping_charged, input.order_discount, input.payment_method, input.delivery_provider, input.tracking_ref, input.shipping_cost, input.fulfillment_cost, input.packaging_cost, input.payment_fee, input.platform_fee, input.notes],
  );
  for (const it of input.items) {
    if (D(it.line_discount).greaterThan(D(it.unit_price).times(it.quantity))) throw new AppError('A line discount cannot exceed the line value.');
    await tx.exec('insert into sales_order_items (business_id, order_id, variant_id, quantity, unit_price, line_discount) values ($1,$2,$3,$4,$5,$6)', [tx.businessId, o.id, it.variant_id, it.quantity, it.unit_price, it.line_discount]);
  }
  const total = await tx.one<{ total_incl_tax: string }>('select total_incl_tax from v_order_financials where id = $1', [o.id]);
  if (D(total.total_incl_tax).lessThan(0)) throw new AppError('Discounts exceed the order value.');
  let warnings: string[] = [];
  if (input.initial_status === 'confirmed') warnings = (await transitionOrder(tx, o.id, { to: 'confirmed', date: input.order_date, allow_negative_stock: input.allow_negative_stock })).warnings;
  return { id: o.id, warnings };
}

const TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
  returned: [],
};

/**
 * Order lifecycle with inventory effects. Each step is guarded by the current status (row-locked)
 * and every stock movement carries a unique idempotency key, so repeating a step can never
 * duplicate stock or revenue.
 */
export async function transitionOrder(
  tx: Tx,
  orderId: string,
  t: { to: string; date: string; tracking_ref?: string | null; restock?: boolean; collect_payment?: boolean; allow_negative_stock?: boolean },
) {
  const o = await tx.one<{ status: string; order_number: string; payment_method: string }>('select status, order_number, payment_method from sales_orders where id = $1 and business_id = $2 for update', [orderId, tx.businessId], 'Order not found');
  if (o.status === t.to) throw new AppError(`The order is already ${t.to}.`, 'invalid_state');
  if (!TRANSITIONS[o.status]?.includes(t.to)) throw new AppError(`An order that is ${o.status} cannot be moved to ${t.to}.`, 'invalid_state');
  const warnings: string[] = [];

  if (t.to === 'confirmed') {
    warnings.push(...(await reserveOrder(tx, orderId, t.date, !!t.allow_negative_stock)));
    await tx.exec(`update sales_orders set status = 'confirmed', confirmed_at = now() where id = $1`, [orderId]);
  }
  if (t.to === 'processing') await tx.exec(`update sales_orders set status = 'processing' where id = $1`, [orderId]);

  if (t.to === 'shipped') {
    const allocs = await tx.many<{ id: string; lot_id: string; quantity: number; variant_id: string; order_item_id: string }>(
      `select a.id, a.lot_id, a.quantity, i.variant_id, a.order_item_id from order_lot_allocations a join sales_order_items i on i.id = a.order_item_id where i.order_id = $1 and a.status = 'reserved'`,
      [orderId],
    );
    if (allocs.length === 0) throw new AppError('No reserved stock found for this order.', 'invalid_state');
    for (const a of allocs) {
      await tx.exec(
        `insert into inventory_movements (business_id, variant_id, lot_id, movement_type, quantity, reference_type, reference_id, order_item_id, reason, idempotency_key, created_by)
         values ($1,$2,$3,'sale_shipment',$4,'sales_order',$5,$6,$7,$8,$9)`,
        [tx.businessId, a.variant_id, a.lot_id, -a.quantity, orderId, a.order_item_id, `Shipped ${o.order_number}`, `ship:${a.id}`, tx.userId],
      );
      await tx.exec(`update order_lot_allocations set status = 'shipped' where id = $1`, [a.id]);
    }
    await tx.exec(`update sales_orders set status = 'shipped', shipped_at = $2, tracking_ref = coalesce($3, tracking_ref) where id = $1`, [orderId, t.date, t.tracking_ref ?? null]);
  }

  if (t.to === 'delivered') {
    await tx.exec(`update sales_orders set status = 'delivered', delivered_at = $2 where id = $1`, [orderId, t.date]);
    if (t.collect_payment) {
      const f = await tx.one<{ total_incl_tax: string; paid: string; fx_rate: string }>('select total_incl_tax, paid, fx_rate from v_order_financials where id = $1', [orderId]);
      const due = D(f.total_incl_tax).minus(D(f.paid));
      if (due.greaterThan(0))
        await addOrderPayment(tx, orderId, { kind: 'payment', payment_date: t.date, amount: due.toFixed(2), method: o.payment_method, reference: 'Collected on delivery', idempotency_key: `deliver:${orderId}` });
    }
  }

  if (t.to === 'cancelled') {
    // release reservations not yet shipped
    await tx.exec(`update order_lot_allocations set status = 'released' where status = 'reserved' and order_item_id in (select id from sales_order_items where order_id = $1)`, [orderId]);
    if (o.status === 'shipped') {
      // undelivered / returned to sender (typical for refused COD parcels)
      const s = await getSettings(tx);
      const restock = t.restock ?? s.cod_undelivered_restock;
      const allocs = await tx.many<{ id: string; lot_id: string; quantity: number; variant_id: string; order_item_id: string }>(
        `select a.id, a.lot_id, a.quantity, i.variant_id, a.order_item_id from order_lot_allocations a join sales_order_items i on i.id = a.order_item_id where i.order_id = $1 and a.status = 'shipped'`,
        [orderId],
      );
      for (const a of allocs) {
        if (restock) {
          await tx.exec(
            `insert into inventory_movements (business_id, variant_id, lot_id, movement_type, quantity, reference_type, reference_id, order_item_id, reason, idempotency_key, created_by)
             values ($1,$2,$3,'sale_reversal',$4,'sales_order',$5,$6,$7,$8,$9)`,
            [tx.businessId, a.variant_id, a.lot_id, a.quantity, orderId, a.order_item_id, `Undelivered ${o.order_number} returned to stock`, `reverse:${a.id}`, tx.userId],
          );
          await tx.exec(`update order_lot_allocations set status = 'reversed' where id = $1`, [a.id]);
        }
      }
      if (!restock) warnings.push('Units were not returned to stock; their cost stays as a loss on this failed delivery.');
    }
    await tx.exec(`update sales_orders set status = 'cancelled', cancelled_at = $2 where id = $1`, [orderId, t.date]);
  }
  return { warnings };
}

export async function syncOrderPaymentStatus(tx: Tx, orderId: string) {
  const f = await tx.one<{ total_incl_tax: string; paid: string; refunded: string }>('select total_incl_tax, paid, refunded from v_order_financials where id = $1', [orderId]);
  const paid = D(f.paid);
  const refunded = D(f.refunded);
  let st = 'unpaid';
  if (refunded.greaterThan(0)) st = refunded.greaterThanOrEqualTo(paid) ? 'refunded' : 'partially_refunded';
  else if (paid.greaterThan(0)) st = paid.greaterThanOrEqualTo(D(f.total_incl_tax)) ? 'paid' : 'partially_paid';
  await tx.exec('update sales_orders set payment_status = $2 where id = $1', [orderId, st]);
}

export async function addOrderPayment(
  tx: Tx,
  orderId: string,
  p: { kind: 'payment' | 'refund'; payment_date: string; amount: string; method: string | null; reference: string | null; idempotency_key: string; return_id?: string | null },
) {
  const o = await tx.one<{ order_number: string; currency: string; fx_rate: string; total_incl_tax: string; paid: string; refunded: string; status: string }>(
    'select order_number, currency, fx_rate, total_incl_tax, paid, refunded, status from v_order_financials where id = $1 and business_id = $2',
    [orderId, tx.businessId],
    'Order not found',
  );
  await tx.exec('select id from sales_orders where id = $1 for update', [orderId]);
  if (p.kind === 'payment' && D(o.paid).plus(D(p.amount)).greaterThan(D(o.total_incl_tax)))
    throw new AppError(`Payment exceeds the order total (${o.total_incl_tax} ${o.currency}; ${o.paid} already received).`, 'validation');
  if (p.kind === 'refund' && D(o.refunded).plus(D(p.amount)).greaterThan(D(o.paid)))
    throw new AppError(`Refunds cannot exceed what the customer paid (${o.paid} ${o.currency}; ${o.refunded} already refunded).`, 'validation');
  const pay = await tx.one<{ id: string }>(
    `insert into order_payments (business_id, order_id, kind, payment_date, amount, fx_rate, method, reference, return_id, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [tx.businessId, orderId, p.kind, p.payment_date, p.amount, o.fx_rate, p.method, p.reference, p.return_id ?? null, `op:${p.idempotency_key}`],
  );
  await tx.exec(
    `insert into cash_transactions (business_id, txn_date, direction, category, amount, currency, fx_rate, description, source_type, source_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'order_payment',$9,$10)`,
    [tx.businessId, p.payment_date, p.kind === 'payment' ? 'in' : 'out', p.kind === 'payment' ? 'customer_receipt' : 'customer_refund', p.amount, o.currency, o.fx_rate,
     `${p.kind === 'payment' ? 'Payment' : 'Refund'} ${o.order_number}`, pay.id, tx.userId],
  );
  await syncOrderPaymentStatus(tx, orderId);
  return pay.id;
}

export async function deleteOrderPayment(tx: Tx, paymentId: string) {
  const p = await tx.one<{ order_id: string }>('select order_id from order_payments where id = $1 and business_id = $2', [paymentId, tx.businessId], 'Payment not found');
  await tx.exec(`delete from cash_transactions where source_type = 'order_payment' and source_id = $1`, [paymentId]);
  await tx.exec('delete from order_payments where id = $1', [paymentId]);
  await syncOrderPaymentStatus(tx, p.order_id);
}

/**
 * Customer return of delivered goods. Resellable units go back into the lots they were shipped
 * from (cost reverses out of COGS); damaged units stay out of stock (their cost remains a loss).
 */
export async function createReturn(
  tx: Tx,
  orderId: string,
  r: { return_date: string; reason: string | null; items: { order_item_id: string; quantity: number; condition: 'resellable' | 'damaged' }[]; refund_amount: string; return_shipping_cost: string; refund_now: boolean; idempotency_key: string },
) {
  const o = await tx.one<{ status: string; order_number: string; payment_method: string }>('select status, order_number, payment_method from sales_orders where id = $1 and business_id = $2 for update', [orderId, tx.businessId], 'Order not found');
  if (!['delivered', 'shipped', 'returned'].includes(o.status)) throw new AppError('Only shipped or delivered orders can have returns. Cancel the order instead.', 'invalid_state');
  const ret = await tx.one<{ id: string }>(
    `insert into returns (business_id, order_id, return_date, reason, refund_amount, return_shipping_cost, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [tx.businessId, orderId, r.return_date, r.reason, r.refund_amount, r.return_shipping_cost, `ret:${r.idempotency_key}`],
  );
  for (const it of r.items.filter((i) => i.quantity > 0)) {
    const line = await tx.one<{ variant_id: string; shipped: number; returned: number }>(
      `select i.variant_id,
              coalesce((select sum(quantity) from order_lot_allocations a where a.order_item_id = i.id and a.status = 'shipped'),0)::int as shipped,
              coalesce((select sum(quantity) from return_items ri where ri.order_item_id = i.id),0)::int as returned
         from sales_order_items i where i.id = $1 and i.order_id = $2`,
      [it.order_item_id, orderId],
      'Order line not found',
    );
    if (line.returned + it.quantity > line.shipped) throw new AppError(`You cannot return more units than were shipped (${line.shipped} shipped, ${line.returned} already returned).`, 'validation');
    const ri = await tx.one<{ id: string }>('insert into return_items (business_id, return_id, order_item_id, quantity, condition) values ($1,$2,$3,$4,$5) returning id', [tx.businessId, ret.id, it.order_item_id, it.quantity, it.condition]);
    if (it.condition === 'resellable') {
      // put units back into the source lots, most recent shipment allocation first
      const allocs = await tx.many<{ lot_id: string; quantity: number; restocked: number }>(
        `select a.lot_id, sum(a.quantity)::int as quantity,
                coalesce((select sum(m.quantity) from inventory_movements m where m.order_item_id = $1 and m.lot_id = a.lot_id and m.movement_type = 'customer_return'),0)::int as restocked
           from order_lot_allocations a where a.order_item_id = $1 and a.status = 'shipped' group by a.lot_id order by min(a.created_at) desc`,
        [it.order_item_id],
      );
      let left = it.quantity;
      for (const a of allocs) {
        if (left <= 0) break;
        const take = Math.min(left, a.quantity - a.restocked);
        if (take <= 0) continue;
        await tx.exec(
          `insert into inventory_movements (business_id, variant_id, lot_id, movement_type, quantity, reference_type, reference_id, order_item_id, reason, idempotency_key, created_by)
           values ($1,$2,$3,'customer_return',$4,'sales_order',$5,$6,$7,$8,$9)`,
          [tx.businessId, line.variant_id, a.lot_id, take, orderId, it.order_item_id, `Return ${o.order_number}${r.reason ? ` — ${r.reason}` : ''}`, `return:${ri.id}:${a.lot_id}`, tx.userId],
        );
        left -= take;
      }
    }
  }
  if (r.refund_now && D(r.refund_amount).greaterThan(0)) {
    await addOrderPayment(tx, orderId, { kind: 'refund', payment_date: r.return_date, amount: r.refund_amount, method: o.payment_method, reference: 'Return refund', idempotency_key: `retref:${ret.id}`, return_id: ret.id });
  }
  const tot = await tx.one<{ shipped: number; returned: number }>(
    `select coalesce((select sum(a.quantity) from order_lot_allocations a join sales_order_items i on i.id = a.order_item_id where i.order_id = $1 and a.status = 'shipped'),0)::int as shipped,
            coalesce((select sum(ri.quantity) from return_items ri join sales_order_items i on i.id = ri.order_item_id where i.order_id = $1),0)::int as returned`,
    [orderId],
  );
  if (tot.returned >= tot.shipped) await tx.exec(`update sales_orders set status = 'returned', delivered_at = coalesce(delivered_at, $2) where id = $1`, [orderId, r.return_date]);
  else if (o.status === 'shipped') await tx.exec(`update sales_orders set status = 'delivered', delivered_at = coalesce(delivered_at, $2) where id = $1`, [orderId, r.return_date]);
  return ret.id;
}

export async function deleteOrder(tx: Tx, id: string) {
  const o = await tx.one<{ status: string }>('select status from sales_orders where id = $1 and business_id = $2', [id, tx.businessId], 'Order not found');
  const pays = await tx.one<{ n: number }>('select count(*)::int as n from order_payments where order_id = $1', [id]);
  if (!['pending', 'cancelled'].includes(o.status) || pays.n > 0) throw new AppError('Only pending or cancelled orders without payments can be deleted. Cancel the order to keep an audit trail.', 'conflict');
  const mv = await tx.one<{ n: number }>(`select count(*)::int as n from inventory_movements where reference_type = 'sales_order' and reference_id = $1`, [id]);
  if (mv.n > 0) throw new AppError('This order has stock movements and must be kept for traceability.', 'conflict');
  await tx.exec('delete from sales_orders where id = $1', [id]);
}

/** Default per-order costs from settings and channel commission, so users only override exceptions. */
export async function orderCostDefaults(tx: Tx) {
  const s = await getSettings(tx);
  const channels = await tx.many('select id, name, kind, commission_pct, commission_fixed from sales_channels where business_id = $1 and is_active order by name', [tx.businessId]);
  return {
    paymentFeePct: s.default_payment_fee_pct,
    paymentFeeFixed: s.default_payment_fee_fixed,
    packaging: s.default_packaging_cost,
    fulfillment: s.default_fulfillment_cost,
    shipping: s.default_shipping_cost,
    channels,
  };
}
