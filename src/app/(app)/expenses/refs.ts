import type { Tx } from '@/lib/db/tenant';
import { allDefaultFxRates } from '@/lib/services/business';

export async function expenseRefs(tx: Tx) {
  const pos = await tx.many<{ id: string; label: string }>(`select id, po_number || ' (' || status || ')' as label from purchase_orders where business_id = $1 and status <> 'cancelled' order by order_date desc`, [tx.businessId]);
  const shipments = await tx.many<{ id: string; label: string }>(`select id, reference || ' (' || status || ')' as label from shipments where business_id = $1 and status <> 'cancelled' order by created_at desc`, [tx.businessId]);
  const campaigns = await tx.many<{ id: string; label: string }>(`select id, name as label from campaigns where business_id = $1 order by created_at desc`, [tx.businessId]);
  const variants = await tx.many<{ id: string; label: string }>(`select v.id, p.name || ' — ' || v.variant_name || ' (' || v.sku || ')' as label from product_variants v join products p on p.id = v.product_id where v.business_id = $1 order by 2`, [tx.businessId]);
  const suppliers = await tx.many<{ id: string; label: string }>(`select id, name as label from suppliers where business_id = $1 and not is_archived order by name`, [tx.businessId]);
  const currencies = (await tx.many<{ code: string }>('select code from currencies where business_id = $1 order by code', [tx.businessId])).map((c) => c.code);
  return { refs: { pos, shipments, campaigns, variants, suppliers, currencies }, rates: await allDefaultFxRates(tx) };
}
