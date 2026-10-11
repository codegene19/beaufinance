import { Tx } from '../db/tenant';
import { AppError } from '../errors';
import type { SupplierInput } from '../validation/schemas';

const COLS = ['name', 'country', 'contact_name', 'email', 'phone', 'address', 'currency', 'payment_terms', 'default_deposit_pct', 'lead_time_days', 'min_order_qty', 'notes'] as const;

export async function listSuppliers(tx: Tx, opts: { q?: string; includeArchived?: boolean } = {}) {
  return tx.many(
    `select s.*,
       coalesce((select count(*) from products p where p.supplier_id = s.id), 0)::int as product_count,
       coalesce((select sum(outstanding_base) from v_po_summary v where v.supplier_id = s.id), 0) as outstanding_base,
       coalesce((select sum(subtotal_base) from v_po_summary v where v.supplier_id = s.id and v.status <> 'cancelled'), 0) as committed_base,
       coalesce((select sum(paid_base) from v_po_summary v where v.supplier_id = s.id), 0) as paid_base
     from suppliers s
     where s.business_id = $1 and ($2::text is null or s.name ilike '%' || $2 || '%' or s.contact_name ilike '%' || $2 || '%')
       and ($3 or not s.is_archived)
     order by s.name`,
    [tx.businessId, opts.q || null, !!opts.includeArchived],
  );
}

export async function getSupplier(tx: Tx, id: string) {
  return tx.one('select * from suppliers where id = $1 and business_id = $2', [id, tx.businessId], 'Supplier not found');
}

export async function createSupplier(tx: Tx, input: SupplierInput) {
  const r = await tx.one<{ id: string }>(
    `insert into suppliers (business_id, ${COLS.join(', ')}) values ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
    [tx.businessId, ...COLS.map((c) => input[c])],
  );
  return r.id;
}

export async function updateSupplier(tx: Tx, id: string, input: SupplierInput) {
  await getSupplier(tx, id);
  await tx.exec(`update suppliers set ${COLS.map((c, i) => `${c} = $${i + 3}`).join(', ')} where id = $1 and business_id = $2`, [id, tx.businessId, ...COLS.map((c) => input[c])]);
}

export async function archiveSupplier(tx: Tx, id: string, archived: boolean) {
  await tx.exec('update suppliers set is_archived = $3 where id = $1 and business_id = $2', [id, tx.businessId, archived]);
}

export async function deleteSupplier(tx: Tx, id: string) {
  const used = await tx.one<{ n: number }>('select count(*)::int as n from purchase_orders where supplier_id = $1', [id]);
  if (used.n > 0) throw new AppError('This supplier has purchase orders. Archive it instead of deleting to keep your history intact.', 'conflict');
  await tx.exec('update products set supplier_id = null where supplier_id = $1 and business_id = $2', [id, tx.businessId]);
  await tx.exec('delete from suppliers where id = $1 and business_id = $2', [id, tx.businessId]);
}
