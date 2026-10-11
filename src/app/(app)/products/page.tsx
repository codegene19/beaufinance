import Link from 'next/link';
import { Package, Plus } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { listProducts, listCategories } from '@/lib/services/products';
import { PageHeader, EmptyState } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/badge';
import { FilterBar } from '@/components/app/filters';
import { Money } from '@/components/app/money';
import { sp } from '@/components/app/period';

export const metadata = { title: 'Products' };

export default async function Products({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const ctx = await getAppContext();
  const [rows, categories] = await tenant(async (tx) => [await listProducts(tx, { q: sp(p.q), status: sp(p.status), category: sp(p.category) }), await listCategories(tx)] as const);
  const filtered = !!(p.q || p.status || p.category);
  return (
    <>
      <PageHeader title="Products" description="Your catalogue, variants and SKUs. Profitability is always computed from actual landed costs." actions={<Button asChild><Link href="/products/new"><Plus /> Add product</Link></Button>} />
      <Card>
        <FilterBar filters={[{ type: 'search', name: 'q', placeholder: 'Search name, brand, SKU or barcode' }, { type: 'select', name: 'status', label: 'Status', options: ['draft', 'active', 'discontinued'].map((s) => ({ value: s, label: s })) }, { type: 'select', name: 'category', label: 'Category', options: categories.map((c) => ({ value: c, label: c })) }]} />
        {rows.length === 0 ? (
          filtered ? <EmptyState title="No products match these filters" /> : (
            <EmptyState icon={<Package />} title="Register your first product" action={<Button asChild><Link href="/products/new"><Plus /> Add product</Link></Button>}>
              Start with the product you are importing first. Add its supplier price in MAD — landed cost, margins and reorder points build on it.
            </EmptyState>
          )
        ) : (
          <Table>
            <THead><tr><Th>Product</Th><Th>SKUs</Th><Th>Supplier</Th><Th>Status</Th><Th right>On hand</Th><Th right>From price</Th></tr></THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/products/${r.id}`} className="font-medium text-ink hover:text-sage-700 hover:underline">{r.name}</Link>
                    <div className="text-xs text-muted">{[r.brand, r.category].filter(Boolean).join(' · ') || '—'}</div>
                  </Td>
                  <Td muted className="max-w-48 truncate">{r.skus}</Td>
                  <Td muted>{r.supplier_name ?? '—'}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td right>{r.on_hand}</Td>
                  <Td right><Money value={r.min_price} currency={ctx.business.base_currency} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
