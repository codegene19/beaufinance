import { formatISO } from 'date-fns';
import { tenant, getAppContext } from '@/lib/app-context';
import { nextPoNumber } from '@/lib/services/purchasing';
import { PageHeader } from '@/components/ui/misc';
import { PurchaseOrderForm } from '../po-form';
import { poFormData } from '../form-data';

export const metadata = { title: 'New purchase order' };

export default async function NewPO({ searchParams }: { searchParams: Promise<{ supplier?: string; variant?: string; qty?: string; price?: string; fx?: string }> }) {
  const sp = await searchParams;
  const ctx = await getAppContext();
  const data = await tenant(async (tx) => ({ ...(await poFormData(tx)), number: await nextPoNumber(tx) }));
  const sup = data.suppliers.find((s) => s.id === sp.supplier) ?? (sp.variant ? data.suppliers.find((s) => s.id === data.variants.find((v) => v.id === sp.variant)?.supplier_id) : undefined);
  const cur = sup?.currency ?? 'MAD';
  const v = data.variants.find((x) => x.id === sp.variant);
  const initial = {
    po_number: data.number, supplier_id: sup?.id ?? '', order_date: formatISO(new Date(), { representation: 'date' }), currency: cur, fx_rate: sp.fx ?? data.rates[cur] ?? '', status: 'draft', deposit_due: '0',
    expected_production_date: '', expected_ship_date: '', expected_arrival_date: '', notes: '',
    items: [{ variant_id: v?.id ?? '', quantity: sp.qty ?? '', unit_price: sp.price ?? v?.price ?? '' }],
  };
  return (
    <>
      <PageHeader eyebrow="Purchase orders" title="New purchase order" description={sp.variant ? 'Pre-filled from your reorder scenario — review before saving.' : 'Bulk order to your supplier, with multiple products.'} />
      <PurchaseOrderForm {...data} baseCurrency={ctx.business.base_currency} initial={initial} />
    </>
  );
}
