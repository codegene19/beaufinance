import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { stockByVariant, listLots, listMovements, inTransit } from '@/lib/services/inventory';
import { inventoryValuation } from '@/lib/services/finance';
import { PageHeader, EmptyState, Stat } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { LinkTabs } from '@/components/ui/tabs';
import { FilterBar } from '@/components/app/filters';
import { Money, fmtDate } from '@/components/app/money';
import { sp } from '@/components/app/period';
import { AdjustDialog, OpeningStockDialog } from './dialogs';
import { humanize } from '@/lib/constants';

export const metadata = { title: 'Inventory & stock lots' };

export default async function Inventory({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const tab = sp(p.tab) ?? 'stock';
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const data = await tenant(async (tx) => ({
    stock: await stockByVariant(tx),
    lots: await listLots(tx, { variantId: sp(p.variant), nearExpiryDays: p.expiring ? Number(p.expiring) : undefined }),
    movements: tab === 'movements' ? await listMovements(tx, { variantId: sp(p.variant), type: sp(p.type), from: sp(p.from), to: sp(p.to), limit: 200 }) : [],
    transit: await inTransit(tx),
    val: await inventoryValuation(tx),
  }));
  const variants = data.stock.map((s) => ({ id: s.variant_id, label: `${s.product_name} — ${s.variant_name} (${s.sku})` }));
  const inStockLots = data.lots.filter((l) => l.on_hand > 0).map((l) => ({ lot_id: l.lot_id, label: `${l.sku} · ${l.lot_code}`, on_hand: l.on_hand }));
  const nearExpiry = data.lots.filter((l) => l.on_hand > 0 && l.days_to_expiry !== null && l.days_to_expiry <= 120).length;
  const base = (t: string) => `/inventory?tab=${t}`;
  return (
    <>
      <PageHeader title="Inventory & stock lots" description={`Batch-level landed costs with ${ctx.settings.costing_method.toUpperCase()} costing. Every movement is auditable.`} actions={<><OpeningStockDialog variants={variants} currency={cur} /><AdjustDialog lots={inStockLots} /></>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stock value (landed)" value={<Money value={data.val.onHandValue} currency={cur} />} sub={`${data.val.units} units on hand`} />
        <Stat label="Reserved for orders" value={<Money value={data.val.reservedValue} currency={cur} />} sub="Confirmed, not yet shipped" href="/sales?status=confirmed" />
        <Stat label="On order / in transit" value={<Money value={data.val.incomingValue} currency={cur} />} sub={`${data.val.incomingUnits} units, not yet sellable`} href={base('transit')} />
        <Stat label="Lots expiring ≤ 120 days" value={nearExpiry} tone={nearExpiry ? 'warning' : 'default'} href="/inventory?tab=lots&expiring=120" />
      </div>
      <LinkTabs active={tab} tabs={[{ key: 'stock', label: 'Stock by product', href: base('stock') }, { key: 'lots', label: 'Lots & expiry', href: base('lots') }, { key: 'movements', label: 'Movement history', href: base('movements') }, { key: 'transit', label: 'In transit', href: base('transit'), count: data.transit.length }]} />
      <Card>
        {tab === 'stock' && (data.stock.length === 0 ? <EmptyState icon={<Boxes />} title="No products yet">Add products, then receive a purchase order or record opening stock.</EmptyState> : (
          <Table>
            <THead><tr><Th>Product</Th><Th right>Received</Th><Th right>Damaged on arrival</Th><Th right>Sold (net)</Th><Th right>Returned</Th><Th right>Written off</Th><Th right>On hand</Th><Th right>Reserved</Th><Th right>Available</Th><Th right>Value</Th><Th>Next expiry</Th></tr></THead>
            <tbody>{data.stock.map((s) => (
              <Tr key={s.variant_id}>
                <Td><Link href={`/inventory?tab=lots&variant=${s.variant_id}`} className="font-medium hover:underline">{s.product_name} — {s.variant_name}</Link><div className="text-xs text-muted">{s.sku}</div></Td>
                <Td right>{s.received}</Td><Td right>{s.damaged_on_arrival}</Td><Td right>{s.units_sold}</Td><Td right>{s.units_returned}</Td><Td right>{s.written_off}</Td>
                <Td right className="font-semibold">{s.on_hand}</Td><Td right>{s.reserved}</Td>
                <Td right className={s.available <= s.safety_stock_qty ? 'font-semibold text-amber-700' : ''}>{s.available}{s.available < 0 && <Badge tone="rose" className="ml-1">negative</Badge>}</Td>
                <Td right><Money value={s.stock_value} currency={cur} /></Td>
                <Td muted>{fmtDate(s.next_expiry)}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        ))}
        {tab === 'lots' && (
          <>
            <FilterBar filters={[{ type: 'select', name: 'variant', label: 'Product', options: variants.map((v) => ({ value: v.id, label: v.label })) }, { type: 'select', name: 'expiring', label: 'Expiry', options: [{ value: '30', label: '≤ 30 days' }, { value: '90', label: '≤ 90 days' }, { value: '180', label: '≤ 180 days' }] }]} />
            {data.lots.length === 0 ? <EmptyState title="No lots">Lots are created when goods are received.</EmptyState> : (
              <Table>
                <THead><tr><Th>Lot</Th><Th>Product</Th><Th>Source</Th><Th>Received</Th><Th>Expiry</Th><Th right>Sellable recv.</Th><Th right>On hand</Th><Th right>Reserved</Th><Th right>Landed / unit</Th></tr></THead>
                <tbody>{data.lots.map((l) => (
                  <Tr key={l.lot_id}>
                    <Td className="font-medium">{l.lot_code}</Td>
                    <Td muted>{l.product_name} <span className="text-xs">({l.sku})</span></Td>
                    <Td muted className="text-xs">{l.is_opening_stock ? 'Opening stock' : <>{l.po_number}{l.shipment_ref ? ` · ${l.shipment_ref}` : ''}</>}</Td>
                    <Td muted>{fmtDate(l.received_date)}</Td>
                    <Td>{l.expiry_date ? <span className={l.days_to_expiry !== null && l.days_to_expiry <= 90 ? 'font-semibold text-amber-700' : ''}>{fmtDate(l.expiry_date)}{l.days_to_expiry !== null && l.days_to_expiry < 0 && <Badge tone="rose" className="ml-1">expired</Badge>}</span> : '—'}</Td>
                    <Td right>{l.qty_sellable}</Td><Td right className="font-semibold">{l.on_hand}</Td><Td right>{l.reserved}</Td>
                    <Td right><Money value={l.landed_unit_cost} currency={cur} decimals={4} /></Td>
                  </Tr>
                ))}</tbody>
              </Table>
            )}
          </>
        )}
        {tab === 'movements' && (
          <>
            <FilterBar filters={[{ type: 'select', name: 'variant', label: 'Product', options: variants.map((v) => ({ value: v.id, label: v.label })) }, { type: 'select', name: 'type', label: 'Type', options: ['receipt', 'sale_shipment', 'sale_reversal', 'customer_return', 'adjustment', 'write_off'].map((t) => ({ value: t, label: humanize(t) })) }, { type: 'date', name: 'from', label: 'From' }, { type: 'date', name: 'to', label: 'To' }]} />
            {data.movements.length === 0 ? <EmptyState title="No movements">Stock movements appear when goods are received, shipped, returned or adjusted.</EmptyState> : (
              <Table>
                <THead><tr><Th>When</Th><Th>Product</Th><Th>Lot</Th><Th>Type</Th><Th right>Qty</Th><Th>Reference / reason</Th></tr></THead>
                <tbody>{data.movements.map((m) => (
                  <Tr key={m.id}>
                    <Td muted className="whitespace-nowrap text-xs">{String(m.created_at).slice(0, 16)}</Td>
                    <Td>{m.product_name} <span className="text-xs text-muted">{m.sku}</span></Td>
                    <Td muted className="text-xs">{m.lot_code}</Td>
                    <Td><Badge tone={m.quantity > 0 ? 'sage' : 'neutral'}>{humanize(m.movement_type)}</Badge></Td>
                    <Td right className={m.quantity < 0 ? 'text-rose-600' : 'text-sage-700'}>{m.quantity > 0 ? '+' : ''}{m.quantity}</Td>
                    <Td muted className="text-xs">{m.order_number ? <Link className="underline" href={`/sales/${m.reference_id}`}>{m.order_number}</Link> : null} {m.reason}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            )}
          </>
        )}
        {tab === 'transit' && (data.transit.length === 0 ? <EmptyState title="Nothing in transit" /> : (
          <Table>
            <THead><tr><Th>Shipment</Th><Th>PO</Th><Th>Product</Th><Th>Status</Th><Th>ETA</Th><Th right>Units</Th><Th right>Already received</Th><Th right>Purchase value</Th></tr></THead>
            <tbody>{data.transit.map((t, i) => (
              <Tr key={i}><Td><Link href={`/shipments/${t.shipment_id}`} className="font-medium hover:underline">{t.reference}</Link></Td><Td muted>{t.po_number}</Td><Td>{t.product_name} <span className="text-xs text-muted">{t.sku}</span></Td><Td><StatusBadge status={t.status} /></Td><Td muted>{fmtDate(t.expected_arrival_date)}</Td><Td right>{t.quantity}</Td><Td right>{t.accounted}</Td><Td right><Money value={t.purchase_value_base} currency={cur} /></Td></Tr>
            ))}</tbody>
          </Table>
        ))}
      </Card>
    </>
  );
}
