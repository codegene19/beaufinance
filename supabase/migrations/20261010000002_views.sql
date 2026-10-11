-- Derived views. security_invoker = true makes them respect the caller's RLS.

create view v_lot_stock with (security_invoker = true) as
select
  l.id as lot_id, l.business_id, l.variant_id, l.lot_code, l.received_date, l.expiry_date,
  l.qty_received, l.qty_damaged, l.qty_rejected, l.qty_missing, l.qty_sellable,
  l.landed_unit_cost, l.landed_cost_total, l.is_opening_stock, l.purchase_order_item_id, l.shipment_item_id,
  coalesce(m.on_hand, 0)::int as on_hand,
  coalesce(a.reserved, 0)::int as reserved,
  (coalesce(m.on_hand, 0) - coalesce(a.reserved, 0))::int as available
from inventory_lots l
left join (select lot_id, sum(quantity) as on_hand from inventory_movements group by lot_id) m on m.lot_id = l.id
left join (select lot_id, sum(quantity) as reserved from order_lot_allocations where status = 'reserved' group by lot_id) a on a.lot_id = l.id;

-- Units already accounted for (received incl. damaged, plus missing) per PO line and shipment line
create view v_po_item_progress with (security_invoker = true) as
select
  i.id as po_item_id, i.business_id, i.purchase_order_id, i.variant_id, i.quantity, i.unit_price, i.line_total,
  coalesce(r.accounted, 0)::int as qty_accounted,
  coalesce(r.received, 0)::int as qty_received,
  coalesce(r.sellable, 0)::int as qty_sellable,
  coalesce(s.shipped, 0)::int as qty_shipped,
  greatest(i.quantity - coalesce(r.accounted, 0), 0)::int as qty_outstanding
from purchase_order_items i
left join (
  select purchase_order_item_id, sum(qty_received + qty_missing) as accounted, sum(qty_received) as received, sum(qty_sellable) as sellable
  from inventory_lots where purchase_order_item_id is not null group by purchase_order_item_id
) r on r.purchase_order_item_id = i.id
left join (select purchase_order_item_id, sum(quantity) as shipped from shipment_items group by purchase_order_item_id) s on s.purchase_order_item_id = i.id;

create view v_po_summary with (security_invoker = true) as
select
  po.id, po.business_id, po.po_number, po.supplier_id, po.order_date, po.currency, po.fx_rate, po.status,
  po.deposit_due, po.expected_arrival_date, po.actual_delivery_date,
  coalesce(it.subtotal, 0)::numeric(18,2) as subtotal,
  round(coalesce(it.subtotal, 0) * po.fx_rate, 4) as subtotal_base,
  coalesce(p.paid, 0)::numeric(18,2) as paid,
  coalesce(p.paid_base, 0)::numeric(18,4) as paid_base,
  case when po.status = 'cancelled' then 0 else greatest(coalesce(it.subtotal, 0) - coalesce(p.paid, 0), 0) end::numeric(18,2) as outstanding,
  case when po.status = 'cancelled' then 0 else round(greatest(coalesce(it.subtotal, 0) - coalesce(p.paid, 0), 0) * po.fx_rate, 4) end as outstanding_base,
  coalesce(it.units, 0)::int as units_ordered,
  coalesce(pr.accounted, 0)::int as units_accounted,
  coalesce(pr.sellable, 0)::int as units_sellable
from purchase_orders po
left join (select purchase_order_id, sum(line_total) as subtotal, sum(quantity) as units from purchase_order_items group by purchase_order_id) it on it.purchase_order_id = po.id
left join (select purchase_order_id, sum(amount) as paid, sum(amount_base) as paid_base from supplier_payments group by purchase_order_id) p on p.purchase_order_id = po.id
left join (select purchase_order_id, sum(qty_accounted) as accounted, sum(qty_sellable) as sellable from v_po_item_progress group by purchase_order_id) pr on pr.purchase_order_id = po.id;

create view v_expense_summary with (security_invoker = true) as
select
  e.*,
  coalesce(p.paid, 0)::numeric(18,2) as paid,
  coalesce(p.paid_base, 0)::numeric(18,4) as paid_base,
  greatest(e.amount - coalesce(p.paid, 0), 0)::numeric(18,2) as outstanding,
  case
    when e.commitment = 'cancelled' then 'cancelled'
    when e.commitment = 'planned' and coalesce(p.paid, 0) = 0 then 'planned'
    when coalesce(p.paid, 0) >= e.amount then 'paid'
    when coalesce(p.paid, 0) > 0 then 'partially_paid'
    else 'unpaid'
  end as payment_state
from expenses e
left join (select expense_id, sum(amount) as paid, sum(amount_base) as paid_base from expense_payments group by expense_id) p on p.expense_id = e.id;

-- Per-order financial facts in BASE currency, ex VAT.
create view v_order_financials with (security_invoker = true) as
with items as (
  select order_id, sum(quantity * unit_price) as gross_merch, sum(line_discount) as line_disc, sum(quantity) as units
  from sales_order_items group by order_id
), pay as (
  select order_id,
    sum(case when kind = 'payment' then amount else 0 end) as paid,
    sum(case when kind = 'refund' then amount else 0 end) as refunded,
    min(case when kind = 'payment' then payment_date end) as first_payment_date
  from order_payments group by order_id
), cogs as (
  select reference_id as order_id,
    -sum(case when mv.movement_type in ('sale_shipment','sale_reversal') then mv.quantity * l.landed_unit_cost else 0 end) as cogs_shipped,
    sum(case when mv.movement_type = 'customer_return' then mv.quantity * l.landed_unit_cost else 0 end) as cogs_returned,
    -sum(case when mv.movement_type in ('sale_shipment','sale_reversal') then mv.quantity else 0 end) as units_shipped_net,
    sum(case when mv.movement_type = 'customer_return' then mv.quantity else 0 end) as units_restocked
  from inventory_movements mv join inventory_lots l on l.id = mv.lot_id
  where mv.reference_type = 'sales_order' group by reference_id
), rets as (
  select order_id, sum(return_shipping_cost) as return_shipping, max(return_date) as last_return_date from returns group by order_id
)
select
  o.id, o.business_id, o.order_number, o.order_date, o.status, o.payment_status, o.payment_method, o.channel_id, o.campaign_id,
  o.currency, o.fx_rate, o.prices_include_tax, o.tax_rate_pct, o.shipped_at, o.delivered_at, o.cancelled_at,
  coalesce(i.units, 0)::int as units,
  -- ex-VAT amounts in base currency
  round(case when o.prices_include_tax then coalesce(i.gross_merch,0) / (1 + o.tax_rate_pct/100) else coalesce(i.gross_merch,0) end * o.fx_rate, 4) as gross_merch_base,
  round(case when o.prices_include_tax then (coalesce(i.line_disc,0) + o.order_discount) / (1 + o.tax_rate_pct/100) else (coalesce(i.line_disc,0) + o.order_discount) end * o.fx_rate, 4) as discounts_base,
  round(case when o.prices_include_tax then o.shipping_charged / (1 + o.tax_rate_pct/100) else o.shipping_charged end * o.fx_rate, 4) as shipping_revenue_base,
  -- customer-facing total incl. VAT in order currency
  round(case when o.prices_include_tax then coalesce(i.gross_merch,0) - coalesce(i.line_disc,0) - o.order_discount + o.shipping_charged
             else (coalesce(i.gross_merch,0) - coalesce(i.line_disc,0) - o.order_discount + o.shipping_charged) * (1 + o.tax_rate_pct/100) end, 2) as total_incl_tax,
  coalesce(p.paid, 0)::numeric(18,2) as paid,
  coalesce(p.refunded, 0)::numeric(18,2) as refunded,
  round(coalesce(p.refunded, 0) / (1 + o.tax_rate_pct/100) * o.fx_rate, 4) as refunds_base,
  coalesce(c.cogs_shipped, 0)::numeric(18,4) as cogs_shipped_base,
  coalesce(c.cogs_returned, 0)::numeric(18,4) as cogs_returned_base,
  coalesce(c.units_shipped_net, 0)::int as units_shipped_net,
  coalesce(c.units_restocked, 0)::int as units_restocked,
  (o.shipping_cost + o.fulfillment_cost + o.packaging_cost)::numeric(18,2) as fulfilment_costs_base,
  (o.payment_fee + o.platform_fee)::numeric(18,2) as selling_fees_base,
  coalesce(r.return_shipping, 0)::numeric(18,2) as return_shipping_base,
  r.last_return_date,
  p.first_payment_date,
  case
    when o.status = 'cancelled' then null
    when (select revenue_recognition from business_settings s where s.business_id = o.business_id) = 'on_shipment' then o.shipped_at
    when (select revenue_recognition from business_settings s where s.business_id = o.business_id) = 'on_payment' then
      case when o.status in ('pending') then null else p.first_payment_date end
    else o.delivered_at
  end as recognized_date
from sales_orders o
left join items i on i.order_id = o.id
left join pay p on p.order_id = o.id
left join cogs c on c.order_id = o.id
left join rets r on r.order_id = o.id;

grant select on v_lot_stock, v_po_item_progress, v_po_summary, v_expense_summary, v_order_financials to authenticated;
