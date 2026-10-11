import { tenant, getAppContext } from '@/lib/app-context';
import { getPurchaseOrder } from '@/lib/services/purchasing';
import { PageHeader } from '@/components/ui/misc';
import { PurchaseOrderForm } from '../../po-form';
import { poFormData } from '../../form-data';

export const metadata = { title: 'Edit purchase order' };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).slice(0, 10) === String(v) ? String(v) : String(v));

export default async function EditPO({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const data = await tenant(async (tx) => ({ ...(await poFormData(tx)), po: await getPurchaseOrder(tx, id) }));
  const { po, items } = data.po;
  const initial = {
    po_number: po.po_number, supplier_id: po.supplier_id, order_date: po.order_date, currency: po.currency, fx_rate: po.fx_rate, status: po.status, deposit_due: po.deposit_due,
    expected_production_date: s(po.expected_production_date), expected_ship_date: s(po.expected_ship_date), expected_arrival_date: s(po.expected_arrival_date), notes: s(po.notes),
    items: items.map((i: any) => ({ variant_id: i.variant_id, quantity: String(i.quantity), unit_price: String(Number(i.unit_price)) })),
  };
  return (
    <>
      <PageHeader eyebrow="Purchase orders" title={`Edit ${po.po_number}`} description="Lines already shipped or received cannot be reduced below those quantities." />
      <PurchaseOrderForm {...data} id={id} baseCurrency={ctx.business.base_currency} initial={initial} />
    </>
  );
}
