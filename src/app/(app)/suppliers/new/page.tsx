import { tenant } from '@/lib/app-context';
import { PageHeader } from '@/components/ui/misc';
import { SupplierForm } from '../supplier-form';

export const metadata = { title: 'New supplier' };
export default async function NewSupplier() {
  const currencies = await tenant(async (tx) => (await tx.many<{ code: string }>('select code from currencies where business_id = $1 order by code', [tx.businessId])).map((c) => c.code));
  return (<><PageHeader eyebrow="Suppliers" title="Add supplier" /><SupplierForm currencies={currencies} /></>);
}
