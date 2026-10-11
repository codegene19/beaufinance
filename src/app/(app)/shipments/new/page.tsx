import { PageHeader } from '@/components/ui/misc';
import { ShipmentForm } from '../shipment-form';
import { tenant } from '@/lib/app-context';

export const metadata = { title: 'New shipment' };

export default async function NewShipment({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  const { po } = await searchParams;
  const n = await tenant((tx) => tx.one<{ n: number }>('select count(*)::int as n from shipments where business_id = $1', [tx.businessId]));
  const initial = { reference: `SHP-${new Date().getFullYear()}-${String(n.n + 1).padStart(3, '0')}`, carrier: '', mode: 'air', tracking_ref: '', status: 'planned', dispatch_date: '', expected_arrival_date: '', actual_arrival_date: '', default_allocation_method: 'value', notes: '' };
  return (<><PageHeader eyebrow="Shipments" title="New shipment" description="Next you will choose which purchase-order lines travel in it." /><ShipmentForm initial={initial} nextUrl={po ? `?po=${po}` : undefined} /></>);
}
