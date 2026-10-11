import { addDays, formatISO } from 'date-fns';
import { Tx } from '../db/tenant';
import { AppError } from '../errors';
import type { ReceiptInput } from '../validation/schemas';
import { recomputeLanded } from './landed';
import { getSettings } from './business';

export async function receiveGoods(tx: Tx, input: ReceiptInput) {
  const po = await tx.one<{ id: string; po_number: string; status: string }>('select id, po_number, status from purchase_orders where id = $1 and business_id = $2 for update', [input.purchase_order_id, tx.businessId], 'Purchase order not found');
  if (['cancelled', 'draft'].includes(po.status)) throw new AppError('Goods can only be received on an ordered purchase order.', 'invalid_state');
  const receipt = await tx.one<{ id: string }>(
    `insert into goods_receipts (business_id, purchase_order_id, shipment_id, received_date, notes, idempotency_key, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [tx.businessId, po.id, input.shipment_id, input.received_date, input.notes, `gr:${input.idempotency_key}`, tx.userId],
  );
  const warnings: string[] = [];
  let lotNo = (await tx.one<{ n: number }>('select count(*)::int as n from inventory_lots where business_id = $1', [tx.businessId])).n;
  for (const line of input.lines) {
    if (line.qty_received + line.qty_missing === 0) continue;
    const pr = await tx.one<{ variant_id: string; quantity: number; qty_accounted: number; purchase_order_id: string }>(
      'select variant_id, quantity, qty_accounted, purchase_order_id from v_po_item_progress where po_item_id = $1',
      [line.purchase_order_item_id],
      'Purchase order line not found',
    );
    if (pr.purchase_order_id !== po.id) throw new AppError('A receipt line does not belong to this purchase order.');
    const units = line.qty_received + line.qty_missing;
    if (pr.qty_accounted + units > pr.quantity) throw new AppError(`Receiving ${units} units would exceed the ${pr.quantity} ordered (${pr.qty_accounted} already accounted for). Record extra units as an adjustment.`, 'validation');
    if (line.shipment_item_id) {
      const si = await tx.one<{ quantity: number; acc: number; shipment_id: string }>(
        `select si.quantity, si.shipment_id, coalesce((select sum(qty_received + qty_missing) from inventory_lots l where l.shipment_item_id = si.id),0)::int as acc from shipment_items si where si.id = $1 and si.purchase_order_item_id = $2`,
        [line.shipment_item_id, line.purchase_order_item_id],
        'Shipment line not found',
      );
      if (si.acc + units > si.quantity) throw new AppError(`Receiving ${units} units would exceed the ${si.quantity} units on this shipment line.`, 'validation');
    }
    const variant = await tx.one<{ has_expiry: boolean; shelf_life_days: number | null; sku: string }>(
      'select p.has_expiry, p.shelf_life_days, v.sku from product_variants v join products p on p.id = v.product_id where v.id = $1',
      [pr.variant_id],
    );
    let expiry = line.expiry_date;
    if (!expiry && variant.has_expiry && variant.shelf_life_days) {
      expiry = formatISO(addDays(new Date(input.received_date), variant.shelf_life_days), { representation: 'date' });
      warnings.push(`Expiry for ${variant.sku} estimated from shelf life (${expiry}). Update it with the batch's printed date.`);
    }
    lotNo++;
    const lotCode = line.lot_code || `${variant.sku}-${input.received_date.replace(/-/g, '')}-${lotNo}`;
    const lot = await tx.one<{ id: string; qty_sellable: number }>(
      `insert into inventory_lots (business_id, variant_id, goods_receipt_id, purchase_order_item_id, shipment_item_id, lot_code, received_date, expiry_date, qty_received, qty_damaged, qty_rejected, qty_missing)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, qty_sellable`,
      [tx.businessId, pr.variant_id, receipt.id, line.purchase_order_item_id, line.shipment_item_id, lotCode, input.received_date, expiry, line.qty_received, line.qty_damaged, line.qty_rejected, line.qty_missing],
    );
    if (lot.qty_sellable > 0) {
      await tx.exec(
        `insert into inventory_movements (business_id, variant_id, lot_id, movement_type, quantity, reference_type, reference_id, reason, idempotency_key, created_by)
         values ($1,$2,$3,'receipt',$4,'goods_receipt',$5,$6,$7,$8)`,
        [tx.businessId, pr.variant_id, lot.id, lot.qty_sellable, receipt.id, `Received on ${po.po_number}`, `receipt:${lot.id}`, tx.userId],
      );
    }
    if (line.qty_damaged + line.qty_rejected + line.qty_missing > 0) warnings.push(`${variant.sku}: ${line.qty_damaged} damaged, ${line.qty_rejected} rejected, ${line.qty_missing} missing — their cost is absorbed by the sellable units. Consider a supplier claim.`);
  }
  // Status updates
  const prog = await tx.one<{ ordered: number; acc: number }>('select coalesce(sum(quantity),0)::int as ordered, coalesce(sum(qty_accounted),0)::int as acc from v_po_item_progress where purchase_order_id = $1', [po.id]);
  if (prog.acc >= prog.ordered) await tx.exec(`update purchase_orders set status = 'received', actual_delivery_date = $2 where id = $1`, [po.id, input.received_date]);
  else if (!po.status.includes('shipped')) await tx.exec(`update purchase_orders set actual_delivery_date = coalesce(actual_delivery_date, $2) where id = $1`, [po.id, input.received_date]);
  if (input.shipment_id) {
    const s = await tx.one<{ q: number; acc: number }>(
      `select coalesce(sum(si.quantity),0)::int as q, coalesce(sum((select sum(qty_received + qty_missing) from inventory_lots l where l.shipment_item_id = si.id)),0)::int as acc from shipment_items si where si.shipment_id = $1`,
      [input.shipment_id],
    );
    await tx.exec(`update shipments set status = case when $2 then 'received'::shipment_status else 'delivered'::shipment_status end, actual_arrival_date = coalesce(actual_arrival_date, $3) where id = $1`, [input.shipment_id, s.acc >= s.q, input.received_date]);
  }
  const { issues } = await recomputeLanded(tx, { poIds: [po.id], shipmentIds: input.shipment_id ? [input.shipment_id] : [] });
  for (const i of issues) warnings.push(`${i.pool}: ${i.name} — ${i.message}`);
  return { receiptId: receipt.id, warnings };
}

/** Existing stock bought before using the app, with a known landed unit cost. */
export async function addOpeningStock(tx: Tx, i: { variant_id: string; quantity: number; unit_cost: string; received_date: string; expiry_date: string | null; lot_code: string | null; idempotency_key: string }) {
  const v = await tx.one<{ sku: string }>('select sku from product_variants where id = $1 and business_id = $2', [i.variant_id, tx.businessId], 'Product not found');
  const code = i.lot_code || `${v.sku}-OPEN-${i.received_date.replace(/-/g, '')}`;
  const lot = await tx.one<{ id: string }>(
    `insert into inventory_lots (business_id, variant_id, lot_code, received_date, expiry_date, qty_received, landed_cost_total, landed_unit_cost, cost_breakdown, is_opening_stock)
     values ($1,$2,$3,$4,$5,$6::int, round($7::numeric * $6::int, 4), $7::numeric, jsonb_build_object('opening_stock', round($7::numeric * $6::int, 4), 'accounted_units', $6::int, 'sellable_units', $6::int), true) returning id`,
    [tx.businessId, i.variant_id, code, i.received_date, i.expiry_date, i.quantity, i.unit_cost],
  );
  await tx.exec(
    `insert into inventory_movements (business_id, variant_id, lot_id, movement_type, quantity, reference_type, reference_id, reason, idempotency_key, created_by)
     values ($1,$2,$3,'receipt',$4,'opening_stock',$3,'Opening stock',$5,$6)`,
    [tx.businessId, i.variant_id, lot.id, i.quantity, `open:${i.idempotency_key}`, tx.userId],
  );
  return lot.id;
}

export async function adjustStock(tx: Tx, a: { lot_id: string; quantity: number; movement_type: 'adjustment' | 'write_off'; reason: string; idempotency_key: string }) {
  const lot = await tx.one<{ variant_id: string; on_hand: number; reserved: number }>('select variant_id, on_hand, reserved from v_lot_stock where lot_id = $1 and business_id = $2', [a.lot_id, tx.businessId], 'Lot not found');
  await tx.exec('select id from inventory_lots where id = $1 for update', [a.lot_id]);
  const qty = a.movement_type === 'write_off' ? -Math.abs(a.quantity) : a.quantity;
  if (lot.on_hand + qty < 0) throw new AppError(`This lot only has ${lot.on_hand} units on hand.`, 'insufficient_stock');
  if (lot.on_hand + qty < lot.reserved) throw new AppError(`${lot.reserved} units of this lot are reserved for open orders. Cancel or reallocate those orders first.`, 'insufficient_stock');
  await tx.exec(
    `insert into inventory_movements (business_id, variant_id, lot_id, movement_type, quantity, reference_type, reason, idempotency_key, created_by)
     values ($1,$2,$3,$4,$5,'manual',$6,$7,$8)`,
    [tx.businessId, lot.variant_id, a.lot_id, a.movement_type, qty, a.reason, `adj:${a.idempotency_key}`, tx.userId],
  );
}

/**
 * Reserves stock for an order line by FIFO (oldest receipt first) or FEFO (earliest expiry first,
 * skipping expired lots). Never silently goes negative: with policy "block" it throws; with
 * "allow_with_warning" the shortfall is reserved on the newest lot and a warning is returned.
 */
export async function reserveForItem(tx: Tx, item: { id: string; variant_id: string; quantity: number; sku: string }, opts: { allowNegative: boolean; asOf: string }) {
  const s = await getSettings(tx);
  const order = s.costing_method === 'fefo' ? 'l.expiry_date asc nulls last, l.received_date asc, l.created_at asc' : 'l.received_date asc, l.created_at asc';
  const lots = await tx.many<{ lot_id: string; available: number; expiry_date: string | null }>(
    `select ls.lot_id, ls.available, ls.expiry_date from v_lot_stock ls join inventory_lots l on l.id = ls.lot_id
      where ls.variant_id = $1 and ls.available > 0 and (l.expiry_date is null or l.expiry_date >= $2::date) order by ${order} for update of l`,
    [item.variant_id, opts.asOf],
  );
  let remaining = item.quantity;
  const warnings: string[] = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.available, remaining);
    await tx.exec(`insert into order_lot_allocations (business_id, order_item_id, lot_id, quantity) values ($1,$2,$3,$4)`, [tx.businessId, item.id, lot.lot_id, take]);
    remaining -= take;
  }
  if (remaining > 0) {
    const allowed = s.negative_stock_policy === 'allow_with_warning' && opts.allowNegative;
    if (!allowed) {
      throw new AppError(
        `Not enough available stock for ${item.sku}: ${item.quantity - remaining} available, ${item.quantity} requested.` +
          (s.negative_stock_policy === 'allow_with_warning' ? ' Tick "allow negative stock" to override.' : ' Negative stock is blocked in Settings.'),
        'insufficient_stock',
      );
    }
    const newest = await tx.maybe<{ id: string }>('select id from inventory_lots where variant_id = $1 order by received_date desc, created_at desc limit 1', [item.variant_id]);
    if (!newest) throw new AppError(`${item.sku} has never been received, so it has no cost basis. Receive stock or record opening stock first.`, 'insufficient_stock');
    await tx.exec(`insert into order_lot_allocations (business_id, order_item_id, lot_id, quantity) values ($1,$2,$3,$4)`, [tx.businessId, item.id, newest.id, remaining]);
    warnings.push(`${item.sku}: ${remaining} unit(s) reserved beyond available stock (negative stock). Investigate and correct with a stock count.`);
  }
  return warnings;
}

export async function stockByVariant(tx: Tx) {
  return tx.many(
    `select v.id as variant_id, v.sku, v.variant_name, p.name as product_name, v.safety_stock_qty, p.has_expiry,
            coalesce(sum(ls.qty_received),0)::int as received, coalesce(sum(ls.qty_damaged + ls.qty_rejected),0)::int as damaged_on_arrival,
            coalesce(sum(ls.on_hand),0)::int as on_hand, coalesce(sum(ls.reserved),0)::int as reserved, coalesce(sum(ls.available),0)::int as available,
            coalesce(sum(greatest(ls.on_hand,0) * ls.landed_unit_cost),0) as stock_value,
            min(ls.expiry_date) filter (where ls.on_hand > 0) as next_expiry,
            coalesce((select -sum(quantity) from inventory_movements m where m.variant_id = v.id and m.movement_type in ('sale_shipment','sale_reversal')),0)::int as units_sold,
            coalesce((select sum(ri.quantity) from return_items ri join sales_order_items si on si.id = ri.order_item_id where si.variant_id = v.id),0)::int as units_returned,
            coalesce((select -sum(quantity) from inventory_movements m where m.variant_id = v.id and m.movement_type = 'write_off'),0)::int as written_off,
            coalesce((select sum(quantity) from inventory_movements m where m.variant_id = v.id and m.movement_type = 'adjustment'),0)::int as adjusted
       from product_variants v join products p on p.id = v.product_id
       left join v_lot_stock ls on ls.variant_id = v.id
      where v.business_id = $1 group by v.id, p.name, p.has_expiry order by p.name, v.variant_name`,
    [tx.businessId],
  );
}

export async function listLots(tx: Tx, f: { variantId?: string; nearExpiryDays?: number; onlyInStock?: boolean } = {}) {
  return tx.many(
    `select ls.*, v.sku, v.variant_name, p.name as product_name, po.po_number, sh.reference as shipment_ref,
            case when ls.expiry_date is not null then (ls.expiry_date - current_date) end as days_to_expiry
       from v_lot_stock ls join product_variants v on v.id = ls.variant_id join products p on p.id = v.product_id
       left join purchase_order_items pi on pi.id = ls.purchase_order_item_id left join purchase_orders po on po.id = pi.purchase_order_id
       left join shipment_items si on si.id = ls.shipment_item_id left join shipments sh on sh.id = si.shipment_id
      where ls.business_id = $1 and ($2::uuid is null or ls.variant_id = $2)
        and ($3::int is null or (ls.expiry_date is not null and ls.expiry_date <= current_date + $3 and ls.on_hand > 0))
        and (not $4 or ls.on_hand <> 0)
      order by p.name, ls.received_date`,
    [tx.businessId, f.variantId || null, f.nearExpiryDays ?? null, !!f.onlyInStock],
  );
}

export async function listMovements(tx: Tx, f: { variantId?: string; type?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) {
  return tx.many(
    `select m.*, v.sku, p.name as product_name, l.lot_code, l.landed_unit_cost, o.order_number
       from inventory_movements m join product_variants v on v.id = m.variant_id join products p on p.id = v.product_id join inventory_lots l on l.id = m.lot_id
       left join sales_orders o on m.reference_type = 'sales_order' and o.id = m.reference_id
      where m.business_id = $1 and ($2::uuid is null or m.variant_id = $2) and ($3::text is null or m.movement_type::text = $3)
        and ($4::date is null or m.created_at::date >= $4) and ($5::date is null or m.created_at::date <= $5)
      order by m.created_at desc limit $6 offset $7`,
    [tx.businessId, f.variantId || null, f.type || null, f.from || null, f.to || null, f.limit ?? 100, f.offset ?? 0],
  );
}

/** Goods ordered or shipped but not yet received — never part of sellable stock. */
export async function inTransit(tx: Tx) {
  return tx.many(
    `select sh.id as shipment_id, sh.reference, sh.status, sh.expected_arrival_date, po.po_number, v.sku, p.name as product_name,
            si.quantity, coalesce((select sum(qty_received + qty_missing) from inventory_lots l where l.shipment_item_id = si.id),0)::int as accounted,
            round(si.quantity * pi.unit_price * po.fx_rate, 2) as purchase_value_base
       from shipment_items si join shipments sh on sh.id = si.shipment_id join purchase_order_items pi on pi.id = si.purchase_order_item_id
       join purchase_orders po on po.id = pi.purchase_order_id join product_variants v on v.id = pi.variant_id join products p on p.id = v.product_id
      where si.business_id = $1 and sh.status not in ('received','cancelled')
      order by sh.expected_arrival_date nulls last`,
    [tx.businessId],
  );
}
