import { tenant, getAppContext } from '@/lib/app-context';
import { listSuppliers } from '@/lib/services/suppliers';
import { listCategories } from '@/lib/services/products';
import { PageHeader } from '@/components/ui/misc';
import { ProductForm } from '../product-form';

export const metadata = { title: 'New product' };

export default async function NewProduct() {
  const ctx = await getAppContext();
  const data = await tenant(async (tx) => ({
    suppliers: await listSuppliers(tx),
    currencies: (await tx.many<{ code: string }>('select code from currencies where business_id = $1 order by code', [tx.businessId])).map((c) => c.code),
    categories: await listCategories(tx),
  }));
  return (
    <>
      <PageHeader eyebrow="Products" title="Add product" description="Need a supplier first? You can add one later and link it." />
      <ProductForm suppliers={data.suppliers as any} currencies={data.currencies} categories={data.categories} defaultTaxInclusive={ctx.settings.price_tax_mode === 'tax_inclusive'} />
    </>
  );
}
