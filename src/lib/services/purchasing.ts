import { Tx } from '../db/tenant';
import { AppError } from '../errors';
import { D } from '../calc/money';
import type { PurchaseOrderInput } from '../validation/schemas';
import { recomputeLanded } from './landed';

export async function listPurchaseOrders(tx: Tx, f: { q?: string; status?: string; supplierId?: string; from?: string; to?: string } = {}) {
  return tx.many(
    `select v.*, s.name as supplier_name
       from v_po_summary v join suppliers s on s.id = v.supplier_id
      where v.business_id = $1
        and ($2::text is null or v.po_number ilike '%' || $2 || '%' or s.name ilike '%' || $2 || '%')
        and ($3::text is null or v.status::text = $3)
        and ($4::uuid is null or v.supplier_id = $4)
        and ($5::date is null or v.order_date >= $5) and ($6::date is null or v.order_date <= $6)
      order by v.order_date desc, v.po_number desc`,
    [tx.businessId, f.q || null, f.status || null, f.supplierId || null, f.from || null, f.to || null],
  );
}

export async function getPurchaseOrder(tx: Tx, id: string) {
  const po = await tx.one(
    `select v.*, po.notes, po.expected_production_date, po.expected_ship_date, s.name as supplier_name, s.default_deposit_pct
       from v_po_summary v join purchase_orders po on po.id = v.id join suppliers s on s.id = v.supplier_id where v.id = $1 and v.business_id = $2`,
    [id, tx.businessId],
    'Purchase order not found',
  );
  const items = await tx.many(
    `select pr.*, v.sku, v.variant_name, p.name as product_name, v.weight_kg
       from v_po_item_progress pr join product_variants v on v.id = pr.variant_id join products p on p.id = v.product_id
      where pr.purchase_order_id = $1 order by p.name, v.variant_name`,
    [id],
  );
  const payments = await tx.many('select * from supplier_payments where purchase_order_id = $1 order by payment_date, created_at', [id]);
  const shipments = await tx.many(
    `select distinct sh.id, sh.reference, sh.status, sh.expected_arrival_date, sh.actual_arrival_date from shipments sh
       join shipment_items si on si.shipment_id = sh.id join purchase_order_items pi on pi.id = si.purchase_order_item_id where pi.purchase_order_id = $1`,
    [id],
  );
  const expenses = await tx.many('select * from v_expense_summary where purchase_order_id = $1 order by date_incurred', [id]);
  const receipts = await tx.many('select * from goods_receipts where purchase_order_id = $1 order by received_date', [id]);
  return { po, items, payments, shipments, expenses, receipts };
}

export async function nextPoNumber(tx: Tx) {
  const year = new Date().getFullYear();
  const r = await tx.one<{ n: number }>(`select count(*)::int as n from purchase_orders where business_id = $1 and po_number like $2`, [tx.businessId, `PO-${year}-%`]);
  let n = r.n + 1;
  // skip numbers already taken (e.g. manual entries)
  while (await tx.maybe('select 1 from purchase_orders where business_id = $1 and po_number = $2', [tx.businessId, `PO-${year}-${String(n).padStart(3, '0')}`])) n++;
  return `PO-${year}-${String(n).padStart(3, '0')}`;
}

export async function savePurchaseOrder(tx: Tx, input: PurchaseOrderInput, id?: string) {
  let poId = id;
  if (id) {
    const cur = await tx.one<{ status: string; currency: string }>('select status, currency from purchase_orders where id = $1 and business_id = $2', [id, tx.businessId], 'Purchase order not found');
    if (cur.status === 'cancelled') throw new AppError('A cancelled purchase order cannot be edited.', 'invalid_state');
    const pays = await tx.one<{ n: number }>('select count(*)::int as n from supplier_payments where purchase_order_id = $1', [id]);
    if (pays.n > 0 && cur.currency !== input.currency) throw new AppError('The currency cannot be changed after payments have been recorded.', 'invalid_state');
    await tx.exec(
      `update purchase_orders set po_number=$3, supplier_id=$4, order_date=$5, currency=$6, fx_rate=$7, deposit_due=$8, expected_production_date=$9,
              expected_ship_date=$10, expected_arrival_date=$11, notes=$12 where id = $1 and business_id = $2`,
      [id, tx.businessId, input.po_number, input.supplier_id, input.order_date, input.currency, input.fx_rate, input.deposit_due, input.expected_production_date, input.expected_ship_date, input.expected_arrival_date, input.notes],
    );
  } else {
    const r = await tx.one<{ id: string }>(
      `insert into purchase_orders (business_id, po_number, supplier_id, order_date, currency, fx_rate, status, deposit_due, expected_production_date, expected_ship_date, expected_arrival_date, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [tx.businessId, input.po_number, input.supplier_id, input.order_date, input.currency, input.fx_rate, input.status === 'received' ? 'ordered' : input.status, input.deposit_due, input.expected_production_date, input.expected_ship_date, input.expected_arrival_date, input.notes],
    );
    poId = r.id;
  }
  const existing = await tx.many<{ id: string; variant_id: string; qty_accounted: number; qty_shipped: number }>('select po_item_id as id, variant_id, qty_accounted, qty_shipped from v_po_item_progress where purchase_order_id = $1', [poId]);
  for (const e of existing) {
    const next = input.items.find((i) => i.variant_id === e.variant_id);
    if (!next) {
      if (e.qty_accounted > 0 || e.qty_shipped > 0) throw new AppError('A line that has been shipped or received cannot be removed.', 'invalid_state');
      await tx.exec('delete from purchase_order_items where id = $1', [e.id]);
    } else if (next.quantity < Math.max(e.qty_accounted, e.qty_shipped)) {
      throw new AppError(`Quantity cannot be lower than what has already been shipped or received (${Math.max(e.qty_accounted, e.qty_shipped)}).`, 'invalid_state');
    }
  }
  for (const it of input.items) {
    const ex = existing.find((e) => e.variant_id === it.variant_id);
    if (ex) await tx.exec('update purchase_order_items set quantity = $2, unit_price = $3 where id = $1', [ex.id, it.quantity, it.unit_price]);
    else
      await tx.exec('insert into purchase_order_items (business_id, purchase_order_id, variant_id, quantity, unit_price) values ($1,$2,$3,$4,$5)', [tx.businessId, poId, it.variant_id, it.quantity, it.unit_price]);
  }
  await recomputeLanded(tx, { poIds: [poId!] });
  await syncPaymentStatus(tx, poId!);
  return poId!;
}

const MANUAL_STATUSES = ['draft', 'ordered', 'partially_paid', 'paid', 'in_production', 'shipped', 'cancelled'];

export async function setPurchaseOrderStatus(tx: Tx, id: string, status: string) {
  const po = await tx.one<{ status: string }>('select status from purchase_orders where id = $1 and business_id = $2 for update', [id, tx.businessId], 'Purchase order not found');
  if (!MANUAL_STATUSES.includes(status)) throw new AppError('"Received" is set automatically when all goods are recorded as received.', 'invalid_state');
  if (po.status === 'cancelled') throw new AppError('This purchase order is cancelled.', 'invalid_state');
  if (status === 'cancelled') {
    const r = await tx.one<{ acc: number; shipped: number }>('select coalesce(sum(qty_accounted),0)::int as acc, coalesce(sum(qty_shipped),0)::int as shipped from v_po_item_progress where purchase_order_id = $1', [id]);
    if (r.acc > 0) throw new AppError('Goods have already been received against this order; it cannot be cancelled.', 'invalid_state');
    if (r.shipped > 0) throw new AppError('Remove this order from its shipments before cancelling it.', 'invalid_state');
  }
  await tx.exec('update purchase_orders set status = $2 where id = $1', [id, status]);
}

/** Keep payment-driven statuses in sync without overriding logistics statuses. */
export async function syncPaymentStatus(tx: Tx, id: string) {
  const v = await tx.one<{ status: string; subtotal: string; paid: string }>('select status, subtotal, paid from v_po_summary where id = $1', [id]);
  if (!['ordered', 'partially_paid', 'paid'].includes(v.status)) return;
  const paid = D(v.paid);
  const next = paid.greaterThanOrEqualTo(D(v.subtotal)) && paid.greaterThan(0) ? 'paid' : paid.greaterThan(0) ? 'partially_paid' : 'ordered';
  if (next !== v.status) await tx.exec('update purchase_orders set status = $2 where id = $1', [id, next]);
}

export async function addSupplierPayment(
  tx: Tx,
  poId: string,
  p: { payment_date: string; amount: string; fx_rate: string; is_deposit: boolean; method: string | null; reference: string | null; idempotency_key: string },
) {
  const po = await tx.one<{ status: string; currency: string; po_number: string; outstanding: string; supplier_name: string }>(
    `select v.status, v.currency, v.po_number, v.outstanding, s.name as supplier_name from v_po_summary v join suppliers s on s.id = v.supplier_id where v.id = $1 and v.business_id = $2`,
    [poId, tx.businessId],
    'Purchase order not found',
  );
  await tx.exec('select id from purchase_orders where id = $1 for update', [poId]);
  if (po.status === 'cancelled') throw new AppError('Payments cannot be recorded on a cancelled purchase order.', 'invalid_state');
  if (D(p.amount).greaterThan(D(po.outstanding)))
    throw new AppError(`This payment exceeds the outstanding balance (${po.outstanding} ${po.currency}). Record supplier credits or extra charges as an expense instead.`, 'validation');
  const pay = await tx.one<{ id: string }>(
    `insert into supplier_payments (business_id, purchase_order_id, payment_date, amount, fx_rate, is_deposit, method, reference, idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [tx.businessId, poId, p.payment_date, p.amount, p.fx_rate, p.is_deposit, p.method, p.reference, `sp:${p.idempotency_key}`],
  );
  await tx.exec(
    `insert into cash_transactions (business_id, txn_date, direction, category, amount, currency, fx_rate, description, source_type, source_id, created_by)
     values ($1,$2,'out','supplier_payment',$3,$4,$5,$6,'supplier_payment',$7,$8)`,
    [tx.businessId, p.payment_date, p.amount, po.currency, p.fx_rate, `${p.is_deposit ? 'Deposit' : 'Payment'} ${po.po_number} — ${po.supplier_name}`, pay.id, tx.userId],
  );
  if (po.status === 'draft') await tx.exec(`update purchase_orders set status = 'ordered' where id = $1`, [poId]);
  await syncPaymentStatus(tx, poId);
  return pay.id;
}

export async function deleteSupplierPayment(tx: Tx, paymentId: string) {
  const p = await tx.one<{ purchase_order_id: string }>('select purchase_order_id from supplier_payments where id = $1 and business_id = $2', [paymentId, tx.businessId], 'Payment not found');
  await tx.exec(`delete from cash_transactions where source_type = 'supplier_payment' and source_id = $1`, [paymentId]);
  await tx.exec('delete from supplier_payments where id = $1', [paymentId]);
  await syncPaymentStatus(tx, p.purchase_order_id);
}

export async function deletePurchaseOrder(tx: Tx, id: string) {
  const r = await tx.one<{ n: number }>(
    `select ((select count(*) from supplier_payments where purchase_order_id = $1) + (select count(*) from goods_receipts where purchase_order_id = $1)
           + (select count(*) from expenses where purchase_order_id = $1)
           + (select count(*) from shipment_items si join purchase_order_items pi on pi.id = si.purchase_order_item_id where pi.purchase_order_id = $1))::int as n`,
    [id],
  );
  if (r.n > 0) throw new AppError('This purchase order has payments, costs, shipments or receipts. Cancel it instead of deleting.', 'conflict');
  await tx.exec('delete from purchase_orders where id = $1 and business_id = $2', [id, tx.businessId]);
}

/** Open supplier liabilities (committed but unpaid). */
export async function supplierBalances(tx: Tx) {
  return tx.many(
    `select s.id, s.name, s.currency,
            coalesce(sum(v.subtotal_base) filter (where v.status <> 'cancelled'), 0) as committed_base,
            coalesce(sum(v.paid_base), 0) as paid_base,
            coalesce(sum(v.outstanding_base), 0) as outstanding_base,
            count(v.id) filter (where v.outstanding > 0)::int as open_orders
       from suppliers s left join v_po_summary v on v.supplier_id = s.id
      where s.business_id = $1 group by s.id order by outstanding_base desc, s.name`,
    [tx.businessId],
  );
}
