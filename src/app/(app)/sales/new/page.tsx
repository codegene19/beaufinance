import { formatISO } from 'date-fns';
import { tenant, getAppContext } from '@/lib/app-context';
import { listVariants } from '@/lib/services/products';
import { nextOrderNumber, orderCostDefaults } from '@/lib/services/sales';
import { defaultSaleTaxRate } from '@/lib/services/business';
import { PageHeader } from '@/components/ui/misc';
import { OrderForm } from '../order-form';

export const metadata = { title: 'Record sale' };

export default async function NewOrder() {
  const ctx = await getAppContext();
  const data = await tenant(async (tx) => ({
    variants: (await listVariants(tx, { activeOnly: true })).map((v) => ({ id: v.id, label: `${v.product_name} — ${v.variant_name} (${v.sku})`, price: v.default_selling_price, incl: v.selling_price_includes_tax, available: v.available })),
    number: await nextOrderNumber(tx),
    defaults: await orderCostDefaults(tx),
    vat: await defaultSaleTaxRate(tx),
    campaigns: await tx.many<{ id: string; name: string }>(`select id, name from campaigns where business_id = $1 and not is_prelaunch order by created_at desc`, [tx.businessId]),
  }));
  const s = ctx.settings;
  const initial = {
    order_number: data.number, order_date: formatISO(new Date(), { representation: 'date' }), customer_name: '', customer_email: '', customer_phone: '', customer_city: '',
    channel_id: ((data.defaults.channels as any[]).find((c) => c.kind === 'website') ?? (data.defaults.channels as any[])[0])?.id ?? '', campaign_id: '', market_code: s.default_market, currency: ctx.business.base_currency, fx_rate: '1',
    prices_include_tax: s.price_tax_mode === 'tax_inclusive', tax_rate_pct: String(Number(data.vat)), shipping_charged: '0', order_discount: '0', payment_method: 'card',
    delivery_provider: '', tracking_ref: '', shipping_cost: s.default_shipping_cost, fulfillment_cost: s.default_fulfillment_cost, packaging_cost: s.default_packaging_cost, payment_fee: '0', platform_fee: '0',
    initial_status: 'confirmed', notes: '', items: [{ variant_id: '', quantity: 1, unit_price: '', line_discount: '0' }], allow_negative_stock: false,
  };
  return (
    <>
      <PageHeader eyebrow="Sales" title="Record sale" description="Revenue is recognised only when the order completes (per your recognition rule) — not when it is placed." />
      <OrderForm initial={initial} variants={data.variants} channels={data.defaults.channels as any} campaigns={data.campaigns} defaults={{ paymentFeePct: data.defaults.paymentFeePct, paymentFeeFixed: data.defaults.paymentFeeFixed }} allowNegative={s.negative_stock_policy === 'allow_with_warning'} baseCurrency={ctx.business.base_currency} />
    </>
  );
}
