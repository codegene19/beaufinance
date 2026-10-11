import { tenant } from '@/lib/app-context';
import { getPurchaseOrder } from '@/lib/services/purchasing';
import { PageHeader } from '@/components/ui/misc';
import { ReceiveForm } from './receive-form';

export const metadata = { title: 'Receive goods' };

export default async function Receive({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await tenant(async (tx) => {
    const d = await getPurchaseOrder(tx, id);
    const sl = await tx.many<{ shipment_id: string; shipment_item_id: string; po_item_id: string; outstanding: number; reference: string; status: string }>(
      `select si.shipment_id, si.id as shipment_item_id, si.purchase_order_item_id as po_item_id, sh.reference, sh.status::text,
              (si.quantity - coalesce((select sum(qty_received + qty_missing) from inventory_lots l where l.shipment_item_id = si.id),0))::int as outstanding
         from shipment_items si join shipments sh on sh.id = si.shipment_id join purchase_order_items pi on pi.id = si.purchase_order_item_id
        where pi.purchase_order_id = $1 and sh.status <> 'cancelled'`,
      [id],
    );
    const exp = await tx.many<{ id: string; has_expiry: boolean }>('select v.id, p.has_expiry from product_variants v join products p on p.id = v.product_id where v.business_id = $1', [tx.businessId]);
    return { ...d, sl, exp };
  });
  const lines = data.items
    .filter((i: any) => i.qty_outstanding > 0)
    .map((i: any) => ({
      po_item_id: i.po_item_id, label: `${i.product_name} — ${i.variant_name}`, sku: i.sku, outstanding: i.qty_outstanding,
      has_expiry: !!data.exp.find((e) => e.id === i.variant_id)?.has_expiry,
      shipment_lines: data.sl.filter((s) => s.po_item_id === i.po_item_id).map((s) => ({ shipment_id: s.shipment_id, shipment_item_id: s.shipment_item_id, outstanding: s.outstanding })),
    }));
  const shipments = Array.from(new Map(data.sl.filter((s) => s.outstanding > 0).map((s) => [s.shipment_id, { id: s.shipment_id, reference: s.reference }])).values());
  return (
    <>
      <PageHeader eyebrow={data.po.po_number} title="Receive goods" description="Count what physically arrived. Inventory only increases when goods are received — never while in transit." />
      <ReceiveForm poId={id} lines={lines} shipments={shipments} />
    </>
  );
}
