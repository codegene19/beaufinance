import type { Tx } from '@/lib/db/tenant';
export const variantOptions = (tx: Tx) => tx.many<{ id: string; label: string }>(`select v.id, p.name || ' — ' || v.variant_name || ' (' || v.sku || ')' as label from product_variants v join products p on p.id = v.product_id where v.business_id = $1 order by 2`, [tx.businessId]);
