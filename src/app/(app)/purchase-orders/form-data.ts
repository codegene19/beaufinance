import type { Tx } from '@/lib/db/tenant';
import { listSuppliers } from '@/lib/services/suppliers';
import { listVariants } from '@/lib/services/products';
import { allDefaultFxRates } from '@/lib/services/business';

export async function poFormData(tx: Tx) {
  const suppliers = await listSuppliers(tx);
  const variants = (await listVariants(tx)).map((v) => ({ id: v.id, label: `${v.product_name} — ${v.variant_name} (${v.sku})`, supplier_id: v.supplier_id, price: v.supplier_unit_price, currency: v.purchase_currency }));
  const rates = await allDefaultFxRates(tx);
  const currencies = (await tx.many<{ code: string }>('select code from currencies where business_id = $1 order by code', [tx.businessId])).map((c) => c.code);
  return { suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, currency: s.currency, default_deposit_pct: s.default_deposit_pct })), variants, rates, currencies };
}
