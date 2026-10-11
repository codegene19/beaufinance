import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pencil, Calculator, RefreshCcw } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { getProduct, listVariants } from '@/lib/services/products';
import { listLots } from '@/lib/services/inventory';
import { deleteProductAction } from '@/app/actions/catalog';
import { PageHeader, KV, SectionTitle } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { ConfirmButton } from '@/components/ui/confirm';
import { Money, fmtDate } from '@/components/app/money';
import { Documents } from './documents';
import { AppError } from '@/lib/errors';

export const metadata = { title: 'Product' };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const data = await tenant(async (tx) => {
    const p = await getProduct(tx, id);
    const variants = (await listVariants(tx)).filter((v) => v.product_id === id);
    const lots = (await listLots(tx)).filter((l) => variants.some((v) => v.id === l.variant_id));
    return { ...p, variantStats: variants, lots };
  }).catch((e) => { if (e instanceof AppError && e.code === 'not_found') notFound(); throw e; });
  const { product, variantStats, lots, documents } = data;
  const deleteAction = deleteProductAction.bind(null, id);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/products" className="hover:underline">Products</Link>}
        title={product.name}
        description={[product.brand, product.category, product.supplier_name && `Supplier: ${product.supplier_name}`].filter(Boolean).join(' · ')}
        actions={
          <>
            <StatusBadge status={product.status} />
            <Button asChild variant="secondary" size="sm"><Link href={`/pricing?variant=${variantStats[0]?.id ?? ''}`}><Calculator /> Pricing</Link></Button>
            <Button asChild variant="secondary" size="sm"><Link href={`/reorder/${variantStats[0]?.id ?? ''}`}><RefreshCcw /> Plan reorder</Link></Button>
            <Button asChild size="sm"><Link href={`/products/${id}/edit`}><Pencil /> Edit</Link></Button>
            <ConfirmButton action={deleteAction} title="Delete product?" description="Products with purchase, stock or sales history cannot be deleted — set them to discontinued instead. This cannot be undone." confirmLabel="Delete" successMessage="Product deleted" redirectTo="/products">Delete</ConfirmButton>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Variants" description="Live stock and current landed cost (weighted over lots on hand)." />
          <Table>
            <THead><tr><Th>Variant</Th><Th>SKU</Th><Th right>Supplier price</Th><Th right>Landed cost</Th><Th right>Selling price</Th><Th right>Available</Th><Th right>Reserved</Th><Th right>In transit</Th></tr></THead>
            <tbody>
              {variantStats.map((v) => (
                <Tr key={v.id}>
                  <Td className="font-medium">{v.variant_name}</Td>
                  <Td muted>{v.sku}</Td>
                  <Td right>{v.supplier_unit_price} {v.purchase_currency}</Td>
                  <Td right>{v.current_landed_cost ? <Money value={v.current_landed_cost} currency={cur} decimals={2} /> : <span className="text-xs text-muted">not received yet</span>}</Td>
                  <Td right>{v.default_selling_price ? <><Money value={v.default_selling_price} currency={cur} /> <span className="text-[10px] text-muted">{v.selling_price_includes_tax ? 'incl. VAT' : 'excl. VAT'}</span></> : '—'}</Td>
                  <Td right>{v.available}</Td>
                  <Td right>{v.reserved}</Td>
                  <Td right>{v.in_transit}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            {product.image_url && <img src={product.image_url} alt={product.name} className="mb-4 max-h-48 w-full rounded-lg object-cover" />}
            <KV className="sm:grid-cols-1" items={[
              ['Country of origin', product.country_of_origin],
              ['Expiry tracking', product.has_expiry ? `Yes${product.shelf_life_days ? ` · ${product.shelf_life_days} days shelf life` : ''}` : 'No'],
              ['Created', fmtDate(product.created_at)],
            ]} />
            {product.description && <p className="mt-4 text-sm text-ink-soft">{product.description}</p>}
            {product.notes && <p className="mt-2 text-sm text-muted">{product.notes}</p>}
            <SectionTitle className="mt-6">Documents</SectionTitle>
            <Documents productId={id} docs={documents as any} />
          </CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Stock lots" description="Each received batch keeps its own landed cost and expiry for FIFO / FEFO costing." action={<Link className="text-sm text-sage-700 hover:underline" href="/inventory?tab=lots">All lots</Link>} />
        {lots.length === 0 ? <CardBody className="text-sm text-muted">No stock received yet.</CardBody> : (
          <Table>
            <THead><tr><Th>Lot</Th><Th>Received</Th><Th>Source</Th><Th>Expiry</Th><Th right>Sellable</Th><Th right>On hand</Th><Th right>Landed / unit</Th></tr></THead>
            <tbody>
              {lots.map((l) => (
                <Tr key={l.lot_id}>
                  <Td className="font-medium">{l.lot_code}</Td>
                  <Td muted>{fmtDate(l.received_date)}</Td>
                  <Td muted>{l.is_opening_stock ? <Badge>Opening stock</Badge> : l.po_number}</Td>
                  <Td>{l.expiry_date ? <span className={l.days_to_expiry !== null && l.days_to_expiry < 90 ? 'text-amber-700' : ''}>{fmtDate(l.expiry_date)}</span> : '—'}</Td>
                  <Td right>{l.qty_sellable}</Td>
                  <Td right>{l.on_hand}</Td>
                  <Td right><Money value={l.landed_unit_cost} currency={cur} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
