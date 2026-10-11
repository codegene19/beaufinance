import { Tx } from '../db/tenant';
import { salesOrderSchema } from '../validation/schemas';
import { createOrder, transitionOrder, addOrderPayment } from './sales';
import { getSettings, defaultSaleTaxRate } from './business';
import { AppError } from '../errors';

export interface ImportRow { [k: string]: string | undefined }

/** Groups CSV rows (one per order line) into orders. Column names are case-insensitive. */
export function groupOrders(rows: ImportRow[]) {
  const norm = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, '_'), (v ?? '').trim()])));
  const map = new Map<string, Record<string, string>[]>();
  for (const r of norm) {
    if (!r.order_number) continue;
    (map.get(r.order_number) ?? map.set(r.order_number, []).get(r.order_number)!).push(r);
  }
  return [...map.entries()].map(([order_number, lines]) => ({ order_number, lines }));
}

/** Imports one order inside the caller's transaction. Existing order numbers are skipped (idempotent). */
export async function importOrder(tx: Tx, g: { order_number: string; lines: Record<string, string>[] }) {
  const exists = await tx.maybe('select 1 from sales_orders where business_id = $1 and order_number = $2', [tx.businessId, g.order_number]);
  if (exists) return 'skipped' as const;
  const s = await getSettings(tx);
  const h = g.lines[0];
  const skus = await tx.many<{ id: string; sku: string }>('select id, sku from product_variants where business_id = $1', [tx.businessId]);
  const channel = h.channel ? await tx.maybe<{ id: string; commission_pct: string }>('select id, commission_pct from sales_channels where business_id = $1 and lower(name) = lower($2)', [tx.businessId, h.channel]) : null;
  const items = g.lines.map((l) => {
    const v = skus.find((x) => x.sku.toLowerCase() === (l.sku ?? '').toLowerCase());
    if (!v) throw new AppError(`Unknown SKU "${l.sku}"`);
    return { variant_id: v.id, quantity: l.quantity || '1', unit_price: l.unit_price ?? '', line_discount: l.line_discount || '0' };
  });
  const parsed = salesOrderSchema.safeParse({
    order_number: g.order_number, order_date: h.order_date, customer_name: h.customer_name, customer_email: h.customer_email, customer_phone: h.customer_phone, customer_city: h.customer_city,
    channel_id: channel?.id ?? '', campaign_id: '', market_code: h.market || s.default_market, currency: h.currency || 'EUR', fx_rate: h.fx_rate || '1',
    prices_include_tax: h.prices_include_tax ? ['1', 'true', 'yes'].includes(h.prices_include_tax.toLowerCase()) : s.price_tax_mode === 'tax_inclusive',
    tax_rate_pct: h.tax_rate || (await defaultSaleTaxRate(tx)), shipping_charged: h.shipping_charged || '0', order_discount: h.order_discount || '0',
    payment_method: h.payment_method || 'card', delivery_provider: h.delivery_provider, tracking_ref: h.tracking_ref,
    shipping_cost: h.shipping_cost || s.default_shipping_cost, fulfillment_cost: h.fulfillment_cost || s.default_fulfillment_cost, packaging_cost: h.packaging_cost || s.default_packaging_cost,
    payment_fee: h.payment_fee || '0', platform_fee: h.platform_fee || '0', initial_status: (h.status || 'confirmed') === 'pending' ? 'pending' : 'confirmed', notes: 'Imported from CSV', items,
  });
  if (!parsed.success) throw new AppError(`${parsed.error.issues[0].path.join('.')}: ${parsed.error.issues[0].message}`);
  const o = await createOrder(tx, parsed.data);
  const status = (h.status || 'confirmed').toLowerCase();
  const date = h.order_date;
  if (['shipped', 'delivered'].includes(status)) await transitionOrder(tx, o.id, { to: 'shipped', date: h.shipped_date || date });
  if (status === 'delivered') await transitionOrder(tx, o.id, { to: 'delivered', date: h.delivered_date || date });
  if (status === 'cancelled') await transitionOrder(tx, o.id, { to: 'cancelled', date });
  if (['1', 'true', 'yes', 'paid'].includes((h.paid ?? '').toLowerCase())) {
    const f = await tx.one<{ total_incl_tax: string }>('select total_incl_tax from v_order_financials where id = $1', [o.id]);
    if (Number(f.total_incl_tax) > 0) await addOrderPayment(tx, o.id, { kind: 'payment', payment_date: h.paid_date || date, amount: f.total_incl_tax, method: parsed.data.payment_method, reference: 'CSV import', idempotency_key: `import:${o.id}` });
  }
  return 'imported' as const;
}

export const IMPORT_TEMPLATE = 'order_number,order_date,sku,quantity,unit_price,line_discount,channel,payment_method,status,paid,shipping_charged,shipping_cost,payment_fee,platform_fee,tax_rate,prices_include_tax,customer_name,customer_email,customer_city,tracking_ref\nSO-5001,2026-10-01,ARG-50,2,29.90,0,Website,card,delivered,yes,0,5.50,1.15,0,20,yes,Camille D.,camille@example.com,Lyon,6A123\nSO-5001,2026-10-01,RHA-200,1,16.90,0,Website,card,delivered,yes,0,5.50,1.15,0,20,yes,Camille D.,camille@example.com,Lyon,6A123\n';
