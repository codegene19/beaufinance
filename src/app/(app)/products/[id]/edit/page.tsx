import { tenant, getAppContext } from '@/lib/app-context';
import { listSuppliers } from '@/lib/services/suppliers';
import { getProduct, listCategories } from '@/lib/services/products';
import { PageHeader } from '@/components/ui/misc';
import { ProductForm } from '../../product-form';

export const metadata = { title: 'Edit product' };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const data = await tenant(async (tx) => ({
    p: await getProduct(tx, id),
    suppliers: await listSuppliers(tx),
    currencies: (await tx.many<{ code: string }>('select code from currencies where business_id = $1 order by code', [tx.businessId])).map((c) => c.code),
    categories: await listCategories(tx),
  }));
  const { product, variants } = data.p;
  const initial = {
    name: product.name, description: s(product.description), brand: s(product.brand), category: s(product.category), supplier_id: s(product.supplier_id), country_of_origin: s(product.country_of_origin),
    image_url: s(product.image_url), status: product.status, has_expiry: product.has_expiry, shelf_life_days: s(product.shelf_life_days), notes: s(product.notes),
    variants: variants.map((v: any) => Object.fromEntries(Object.entries(v).map(([k, val]) => [k, typeof val === 'boolean' || k === 'safety_stock_qty' ? val : s(val)]))),
  };
  return (
    <>
      <PageHeader eyebrow="Products" title={`Edit ${product.name}`} />
      <ProductForm id={id} initial={initial} suppliers={data.suppliers as any} currencies={data.currencies} categories={data.categories} defaultTaxInclusive={ctx.settings.price_tax_mode === 'tax_inclusive'} />
    </>
  );
}
