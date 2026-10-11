import { Tx } from '../db/tenant';
import { AppError } from '../errors';
import { recomputeLanded, computeShipmentPool } from './landed';

const COLS = ['reference', 'carrier', 'mode', 'tracking_ref', 'status', 'dispatch_date', 'expected_arrival_date', 'actual_arrival_date', 'default_allocation_method', 'notes'] as const;

export async function listShipments(tx: Tx, f: { q?: string; status?: string } = {}) {
  return tx.many(
    `select sh.*,
       (select coalesce(sum(si.quantity),0) from shipment_items si where si.shipment_id = sh.id)::int as units,
       (select string_agg(distinct po.po_number, ', ') from shipment_items si join purchase_order_items pi on pi.id = si.purchase_order_item_id join purchase_orders po on po.id = pi.purchase_order_id where si.shipment_id = sh.id) as po_numbers,
       (select coalesce(sum(e.amount_base),0) from expenses e where e.shipment_id = sh.id and e.treatment = 'product_acquisition' and e.commitment = 'committed') as capitalised_costs_base,
       (select coalesce(sum(e.amount_base),0) from expenses e where e.shipment_id = sh.id and e.treatment = 'recoverable_tax' and e.commitment = 'committed') as recoverable_tax_base,
       (select count(*) from expenses e where e.shipment_id = sh.id and e.commitment <> 'cancelled' and e.fx_rate is null)::int as missing_fx
     from shipments sh
     where sh.business_id = $1 and ($2::text is null or sh.reference ilike '%' || $2 || '%' or sh.tracking_ref ilike '%' || $2 || '%' or sh.carrier ilike '%' || $2 || '%')
       and ($3::text is null or sh.status::text = $3)
     order by coalesce(sh.dispatch_date, sh.created_at::date) desc`,
    [tx.businessId, f.q || null, f.status || null],
  );
}

export async function getShipment(tx: Tx, id: string) {
  const shipment = await tx.one('select * from shipments where id = $1 and business_id = $2', [id, tx.businessId], 'Shipment not found');
  const items = await tx.many(
    `select si.*, pi.variant_id, pi.unit_price, pi.quantity as po_quantity, po.id as purchase_order_id, po.po_number, po.currency, po.fx_rate,
            v.sku, v.variant_name, p.name as product_name, v.weight_kg,
            coalesce((select sum(l.qty_received + l.qty_missing) from inventory_lots l where l.shipment_item_id = si.id),0)::int as qty_accounted
       from shipment_items si join purchase_order_items pi on pi.id = si.purchase_order_item_id join purchase_orders po on po.id = pi.purchase_order_id
       join product_variants v on v.id = pi.variant_id join products p on p.id = v.product_id
      where si.shipment_id = $1 order by po.po_number, p.name`,
    [id],
  );
  const expenses = await tx.many('select * from v_expense_summary where shipment_id = $1 order by date_incurred, created_at', [id]);
  const pool = await computeShipmentPool(tx, id);
  return { shipment, items, expenses, pool };
}

export async function saveShipment(tx: Tx, input: Record<(typeof COLS)[number], any>, id?: string) {
  if (id) {
    const cur = await tx.one<{ status: string }>('select status from shipments where id = $1 and business_id = $2', [id, tx.businessId], 'Shipment not found');
    if (input.status === 'received' && cur.status !== 'received') throw new AppError('Use "Receive goods" to mark a shipment as received; this also updates inventory.', 'invalid_state');
    await tx.exec(`update shipments set ${COLS.map((c, i) => `${c} = $${i + 3}`).join(', ')} where id = $1 and business_id = $2`, [id, tx.businessId, ...COLS.map((c) => input[c])]);
    await recomputeLanded(tx, { shipmentIds: [id] });
    return id;
  }
  if (input.status === 'received') input.status = 'delivered';
  const r = await tx.one<{ id: string }>(`insert into shipments (business_id, ${COLS.join(', ')}) values ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}) returning id`, [tx.businessId, ...COLS.map((c) => input[c])]);
  return r.id;
}

/** Candidate PO lines that still have unshipped quantity. */
export async function shippableLines(tx: Tx, shipmentId?: string) {
  return tx.many(
    `select pr.po_item_id, pr.quantity, pr.qty_shipped, pr.qty_accounted, (pr.quantity - pr.qty_shipped)::int as qty_unshipped,
            po.po_number, po.id as purchase_order_id, v.sku, v.variant_name, p.name as product_name, v.weight_kg,
            (select si.quantity from shipment_items si where si.shipment_id = $2 and si.purchase_order_item_id = pr.po_item_id) as in_this_shipment
       from v_po_item_progress pr join purchase_orders po on po.id = pr.purchase_order_id
       join product_variants v on v.id = pr.variant_id join products p on p.id = v.product_id
      where pr.business_id = $1 and po.status not in ('cancelled','draft')
        and (pr.quantity > pr.qty_shipped or exists (select 1 from shipment_items si where si.shipment_id = $2 and si.purchase_order_item_id = pr.po_item_id))
      order by po.po_number, p.name`,
    [tx.businessId, shipmentId ?? null],
  );
}

export async function setShipmentItems(tx: Tx, shipmentId: string, items: { purchase_order_item_id: string; quantity: number; total_weight_kg: string | null; total_volume_m3: string | null }[]) {
  const sh = await tx.one<{ status: string }>('select status from shipments where id = $1 and business_id = $2 for update', [shipmentId, tx.businessId], 'Shipment not found');
  if (sh.status === 'cancelled') throw new AppError('This shipment is cancelled.', 'invalid_state');
  const current = await tx.many<{ id: string; purchase_order_item_id: string; quantity: number; accounted: number }>(
    `select si.id, si.purchase_order_item_id, si.quantity, coalesce((select sum(qty_received + qty_missing) from inventory_lots l where l.shipment_item_id = si.id),0)::int as accounted
       from shipment_items si where si.shipment_id = $1`,
    [shipmentId],
  );
  const affectedPos = new Set<string>();
  for (const c of current) {
    const next = items.find((i) => i.purchase_order_item_id === c.purchase_order_item_id);
    if ((!next || next.quantity < c.accounted) && c.accounted > 0) throw new AppError('Units already received from this shipment cannot be removed.', 'invalid_state');
    if (!next || next.quantity === 0) await tx.exec('delete from shipment_items where id = $1', [c.id]);
  }
  for (const it of items.filter((i) => i.quantity > 0)) {
    const pr = await tx.one<{ quantity: number; qty_shipped: number; purchase_order_id: string }>('select quantity, qty_shipped, purchase_order_id from v_po_item_progress where po_item_id = $1 and business_id = $2', [it.purchase_order_item_id, tx.businessId], 'Purchase order line not found');
    const already = current.find((c) => c.purchase_order_item_id === it.purchase_order_item_id)?.quantity ?? 0;
    if (pr.qty_shipped - already + it.quantity > pr.quantity) throw new AppError(`You are shipping more units than were ordered on a purchase order line (${pr.quantity} ordered, ${pr.qty_shipped - already} already in other shipments).`, 'validation');
    affectedPos.add(pr.purchase_order_id);
    await tx.exec(
      `insert into shipment_items (business_id, shipment_id, purchase_order_item_id, quantity, total_weight_kg, total_volume_m3) values ($1,$2,$3,$4,$5,$6)
       on conflict (shipment_id, purchase_order_item_id) do update set quantity = excluded.quantity, total_weight_kg = excluded.total_weight_kg, total_volume_m3 = excluded.total_volume_m3`,
      [tx.businessId, shipmentId, it.purchase_order_item_id, it.quantity, it.total_weight_kg, it.total_volume_m3],
    );
  }
  await recomputeLanded(tx, { shipmentIds: [shipmentId], poIds: [...affectedPos] });
}

export async function deleteShipment(tx: Tx, id: string) {
  const r = await tx.one<{ n: number }>(
    `select ((select count(*) from inventory_lots l join shipment_items si on si.id = l.shipment_item_id where si.shipment_id = $1) + (select count(*) from expenses where shipment_id = $1))::int as n`,
    [id],
  );
  if (r.n > 0) throw new AppError('This shipment has costs or received goods. Cancel it or remove its costs first.', 'conflict');
  const pos = await tx.many<{ id: string }>('select distinct pi.purchase_order_id as id from shipment_items si join purchase_order_items pi on pi.id = si.purchase_order_item_id where si.shipment_id = $1', [id]);
  await tx.exec('delete from shipments where id = $1 and business_id = $2', [id, tx.businessId]);
  if (pos.length) await recomputeLanded(tx, { poIds: pos.map((p) => p.id) });
}
