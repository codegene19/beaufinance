import { z } from 'zod';

const DEC = /^-?\d+(\.\d+)?$/;
const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

/** Decimal kept as a string to preserve exact precision end-to-end. */
export const decimal = (opts: { min?: number; max?: number; dp?: number; label?: string } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(',', '.'))
    .refine((v) => v !== '', { message: `${opts.label ?? 'Value'} is required` })
    .refine((v) => DEC.test(v), { message: 'Enter a valid number' })
    .refine((v) => opts.min === undefined || Number(v) >= opts.min, { message: `Must be at least ${opts.min}` })
    .refine((v) => opts.max === undefined || Number(v) <= opts.max, { message: `Must be at most ${opts.max}` })
    .refine((v) => opts.dp === undefined || !v.includes('.') || v.split('.')[1].length <= opts.dp, { message: `Use at most ${opts.dp} decimal places` });

export const money = (label?: string) => decimal({ min: 0, dp: 2, label });
export const unitPrice = (label?: string) => decimal({ min: 0, dp: 4, label });
export const positiveMoney = (label?: string) => decimal({ min: 0.01, dp: 2, label });
export const fxRate = decimal({ min: 0.00000001, dp: 8, label: 'Exchange rate' });
export const percent = (max = 100) => decimal({ min: 0, max, dp: 4 });

export const optDecimal = (opts: Parameters<typeof decimal>[0] = {}) => z.preprocess(emptyToNull, decimal(opts).nullable());
export const optString = z.preprocess(emptyToNull, z.string().trim().max(5000).nullable());
export const optDate = z.preprocess(emptyToNull, z.iso.date({ message: 'Use a valid date' }).nullable());
export const reqDate = z.iso.date({ message: 'Date is required' });
export const optUuid = z.preprocess(emptyToNull, z.uuid().nullable());
export const int = (min = 0) => z.coerce.number({ message: 'Enter a whole number' }).int('Enter a whole number').min(min, `Must be at least ${min}`);
export const optInt = (min = 0) => z.preprocess(emptyToNull, int(min).nullable());
export const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');
export const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code');
export const optUrl = z.preprocess(emptyToNull, z.url({ message: 'Enter a full URL (https://…)' }).nullable());
export const idempotencyKey = z.string().min(8).max(100);

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required').max(200),
  country,
  contact_name: optString,
  email: z.preprocess(emptyToNull, z.email('Enter a valid email').nullable()),
  phone: optString,
  address: optString,
  currency,
  payment_terms: optString,
  default_deposit_pct: percent(),
  lead_time_days: optInt(0),
  min_order_qty: optInt(0),
  notes: optString,
});

export const variantSchema = z.object({
  id: optUuid,
  sku: z.string().trim().min(1, 'SKU is required').max(64),
  barcode: optString,
  variant_name: z.string().trim().min(1, 'Variant name is required').max(120),
  supplier_unit_price: unitPrice('Supplier unit price'),
  purchase_currency: currency,
  default_selling_price: optDecimal({ min: 0, dp: 2 }),
  selling_price_includes_tax: z.coerce.boolean(),
  target_margin_pct: optDecimal({ min: -100, max: 99.99 }),
  target_markup_pct: optDecimal({ min: 0 }),
  length_cm: optDecimal({ min: 0 }),
  width_cm: optDecimal({ min: 0 }),
  height_cm: optDecimal({ min: 0 }),
  weight_kg: optDecimal({ min: 0, dp: 3 }),
  min_order_qty: optInt(0),
  order_multiple: optInt(1),
  supplier_lead_days: optInt(0),
  shipping_lead_days: optInt(0),
  safety_stock_qty: int(0),
  packaging_cost: optDecimal({ min: 0, dp: 2 }),
});

export const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(200),
  description: optString,
  brand: optString,
  category: optString,
  supplier_id: optUuid,
  country_of_origin: z.preprocess(emptyToNull, country.nullable()),
  image_url: optUrl,
  status: z.enum(['draft', 'active', 'discontinued']),
  has_expiry: z.coerce.boolean(),
  shelf_life_days: optInt(1),
  notes: optString,
  variants: z.array(variantSchema).min(1, 'Add at least one variant (use "Standard" if the product has none)'),
});

export const poItemSchema = z.object({
  variant_id: z.uuid('Choose a product'),
  quantity: int(1),
  unit_price: unitPrice('Unit price'),
});

export const purchaseOrderSchema = z
  .object({
    po_number: z.string().trim().min(1, 'PO number is required').max(50),
    supplier_id: z.uuid('Choose a supplier'),
    order_date: reqDate,
    currency,
    fx_rate: fxRate,
    status: z.enum(['draft', 'ordered', 'partially_paid', 'paid', 'in_production', 'shipped', 'received', 'cancelled']).default('draft'),
    deposit_due: money(),
    expected_production_date: optDate,
    expected_ship_date: optDate,
    expected_arrival_date: optDate,
    notes: optString,
    items: z.array(poItemSchema).min(1, 'Add at least one product line'),
  })
  .superRefine((v, ctx) => {
    const ids = v.items.map((i) => i.variant_id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Each product can only appear once per purchase order' });
  });

export const paymentSchema = z.object({
  payment_date: reqDate,
  amount: positiveMoney('Amount'),
  fx_rate: fxRate,
  is_deposit: z.coerce.boolean().default(false),
  method: optString,
  reference: optString,
  idempotency_key: idempotencyKey,
});

export const shipmentSchema = z.object({
  reference: z.string().trim().min(1, 'Reference is required').max(80),
  carrier: optString,
  mode: z.preprocess(emptyToNull, z.enum(['sea', 'air', 'road', 'courier', 'other']).nullable()),
  tracking_ref: optString,
  status: z.enum(['planned', 'booked', 'in_transit', 'at_customs', 'cleared', 'delivered', 'received', 'cancelled']),
  dispatch_date: optDate,
  expected_arrival_date: optDate,
  actual_arrival_date: optDate,
  default_allocation_method: z.enum(['quantity', 'value', 'weight', 'volume', 'manual']),
  notes: optString,
});

export const shipmentItemsSchema = z.object({
  items: z.array(
    z.object({
      purchase_order_item_id: z.uuid(),
      quantity: int(1),
      total_weight_kg: optDecimal({ min: 0, dp: 3 }),
      total_volume_m3: optDecimal({ min: 0, dp: 6 }),
    }),
  ),
});

export const expenseSchema = z
  .object({
    name: z.string().trim().min(1, 'Expense name is required').max(200),
    description: optString,
    category: z.string().min(1, 'Choose a category'),
    amount: money('Amount'),
    currency,
    fx_rate: optDecimal({ min: 0.00000001, dp: 8 }),
    date_incurred: reqDate,
    due_date: optDate,
    commitment: z.enum(['planned', 'committed', 'cancelled']),
    treatment: z.enum(['product_acquisition', 'recoverable_tax', 'operating', 'startup', 'per_order_variable', 'marketing']),
    payee: optString,
    supplier_id: optUuid,
    link_type: z.enum(['general', 'purchase_order', 'shipment', 'campaign']).default('general'),
    purchase_order_id: optUuid,
    shipment_id: optUuid,
    variant_id: optUuid,
    campaign_id: optUuid,
    allocation_method: z.preprocess(emptyToNull, z.enum(['quantity', 'value', 'weight', 'volume', 'manual']).nullable()),
    manual_shares: z.array(z.object({ variant_id: z.uuid(), share_pct: decimal({ min: 0.0001, max: 100 }) })).default([]),
    attachment_url: optUrl,
    recurring_interval: z.preprocess(emptyToNull, z.enum(['monthly', 'quarterly', 'yearly']).nullable()),
    notes: optString,
  })
  .superRefine((v, ctx) => {
    if (v.treatment === 'product_acquisition' && !v.purchase_order_id && !v.shipment_id)
      ctx.addIssue({ code: 'custom', path: ['link_type'], message: 'A product acquisition cost must be linked to a purchase order or a shipment so it can be allocated to products.' });
    if (v.purchase_order_id && v.shipment_id) ctx.addIssue({ code: 'custom', path: ['link_type'], message: 'Link the cost to either a purchase order or a shipment, not both (prevents double allocation).' });
    if (v.treatment === 'marketing' && (v.purchase_order_id || v.shipment_id))
      ctx.addIssue({ code: 'custom', path: ['treatment'], message: 'Marketing costs cannot be capitalised into a shipment or purchase order.' });
    if (v.allocation_method === 'manual') {
      const total = v.manual_shares.reduce((a, s) => a + Number(s.share_pct), 0);
      if (Math.abs(total - 100) > 0.01) ctx.addIssue({ code: 'custom', path: ['manual_shares'], message: `Manual shares must add up to 100% (currently ${total.toFixed(2)}%).` });
    }
    if (v.commitment !== 'planned' && v.fx_rate === null) ctx.addIssue({ code: 'custom', path: ['fx_rate'], message: 'An exchange rate is required for committed costs.' });
  });

export const receiptLineSchema = z.object({
  purchase_order_item_id: z.uuid(),
  shipment_item_id: optUuid,
  qty_received: int(0),
  qty_damaged: int(0),
  qty_rejected: int(0),
  qty_missing: int(0),
  expiry_date: optDate,
  lot_code: optString,
});

export const receiptSchema = z.object({
  purchase_order_id: z.uuid(),
  shipment_id: optUuid,
  received_date: reqDate,
  notes: optString,
  idempotency_key: idempotencyKey,
  lines: z
    .array(receiptLineSchema)
    .min(1)
    .superRefine((lines, ctx) => {
      lines.forEach((l, i) => {
        if (l.qty_damaged + l.qty_rejected > l.qty_received) ctx.addIssue({ code: 'custom', path: [i, 'qty_damaged'], message: 'Damaged + rejected cannot exceed units received' });
      });
      if (lines.every((l) => l.qty_received + l.qty_missing === 0)) ctx.addIssue({ code: 'custom', path: [], message: 'Enter at least one received or missing quantity' });
    }),
});

export const adjustmentSchema = z.object({
  lot_id: z.uuid(),
  quantity: z.coerce.number().int().refine((v) => v !== 0, 'Quantity cannot be zero'),
  movement_type: z.enum(['adjustment', 'write_off']),
  reason: z.string().trim().min(3, 'Explain the reason for this adjustment'),
  idempotency_key: idempotencyKey,
});

export const openingStockSchema = z.object({
  variant_id: z.uuid(),
  quantity: int(1),
  unit_cost: unitPrice('Landed unit cost'),
  received_date: reqDate,
  expiry_date: optDate,
  lot_code: optString,
  idempotency_key: idempotencyKey,
});

export const orderItemSchema = z.object({
  variant_id: z.uuid('Choose a product'),
  quantity: int(1),
  unit_price: money('Unit price'),
  line_discount: money().default('0'),
});

export const salesOrderSchema = z.object({
  order_number: z.string().trim().min(1, 'Order number is required').max(50),
  order_date: reqDate,
  customer_name: optString,
  customer_email: z.preprocess(emptyToNull, z.email('Enter a valid email').nullable()),
  customer_phone: optString,
  customer_city: optString,
  channel_id: optUuid,
  campaign_id: optUuid,
  market_code: country,
  currency,
  fx_rate: fxRate,
  prices_include_tax: z.coerce.boolean(),
  tax_rate_pct: percent(99.99),
  shipping_charged: money(),
  order_discount: money(),
  payment_method: z.enum(['card', 'paypal', 'cod', 'bank_transfer', 'cash', 'marketplace', 'other']),
  delivery_provider: optString,
  tracking_ref: optString,
  shipping_cost: money(),
  fulfillment_cost: money(),
  packaging_cost: money(),
  payment_fee: money(),
  platform_fee: money(),
  initial_status: z.enum(['pending', 'confirmed']).default('confirmed'),
  notes: optString,
  items: z.array(orderItemSchema).min(1, 'Add at least one product'),
  allow_negative_stock: z.coerce.boolean().default(false),
});

export const orderTransitionSchema = z.object({
  to: z.enum(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled']),
  date: reqDate,
  tracking_ref: optString,
  restock: z.coerce.boolean().optional(),
  collect_payment: z.coerce.boolean().optional(),
  allow_negative_stock: z.coerce.boolean().default(false),
});

export const orderPaymentSchema = z.object({
  kind: z.enum(['payment', 'refund']),
  payment_date: reqDate,
  amount: positiveMoney('Amount'),
  method: optString,
  reference: optString,
  idempotency_key: idempotencyKey,
});

export const returnSchema = z.object({
  return_date: reqDate,
  reason: optString,
  items: z.array(z.object({ order_item_id: z.uuid(), quantity: int(0), condition: z.enum(['resellable', 'damaged']) })).refine((a) => a.some((i) => i.quantity > 0), 'Select at least one returned unit'),
  refund_amount: money('Refund amount'),
  return_shipping_cost: money(),
  refund_now: z.coerce.boolean(),
  idempotency_key: idempotencyKey,
});

export const campaignSchema = z
  .object({
    name: z.string().trim().min(1, 'Campaign name is required').max(200),
    channel: z.enum(['meta', 'instagram', 'tiktok', 'google', 'influencer', 'email', 'other']),
    start_date: optDate,
    end_date: optDate,
    planned_budget: money(),
    is_prelaunch: z.coerce.boolean(),
    allocation_method: z.enum(['attributed_orders', 'delivered_orders', 'revenue_share', 'manual']),
    sessions: optInt(0),
    notes: optString,
    products: z.array(z.object({ variant_id: z.uuid(), manual_share_pct: optDecimal({ min: 0.0001, max: 100 }) })).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.start_date && v.end_date && v.end_date < v.start_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'End date must be after the start date' });
    if (v.allocation_method === 'manual') {
      const total = v.products.reduce((a, p) => a + Number(p.manual_share_pct ?? 0), 0);
      if (Math.abs(total - 100) > 0.01) ctx.addIssue({ code: 'custom', path: ['products'], message: `Manual shares must add up to 100% (currently ${total.toFixed(2)}%).` });
    }
  });

export const cashTxnSchema = z.object({
  txn_date: reqDate,
  category: z.enum(['opening_balance', 'owner_contribution', 'owner_withdrawal', 'loan_in', 'loan_repayment', 'tax_payment', 'tax_refund', 'other_in', 'other_out']),
  amount: positiveMoney('Amount'),
  currency,
  fx_rate: fxRate,
  account: z.string().trim().min(1).max(50).default('bank'),
  description: optString,
});

export const settingsSchema = z.object({
  business_name: z.string().trim().min(1).max(200),
  logo_url: optUrl,
  base_currency: currency,
  default_market: country,
  price_tax_mode: z.enum(['tax_inclusive', 'tax_exclusive']),
  fee_basis: z.enum(['gross_incl_tax', 'net_excl_tax']),
  costing_method: z.enum(['fifo', 'fefo']),
  negative_stock_policy: z.enum(['block', 'allow_with_warning']),
  revenue_recognition: z.enum(['on_delivery', 'on_shipment', 'on_payment']),
  cod_undelivered_restock: z.coerce.boolean(),
  import_vat_recoverable: z.coerce.boolean(),
  default_payment_fee_pct: percent(),
  default_payment_fee_fixed: money(),
  default_packaging_cost: money(),
  default_fulfillment_cost: money(),
  default_shipping_cost: money(),
  default_target_margin_pct: decimal({ min: 0, max: 99 }),
  min_acceptable_margin_pct: decimal({ min: -50, max: 99 }),
  premium_margin_uplift_pct: decimal({ min: 0, max: 50 }),
  safety_buffer_days: int(0),
  target_coverage_days: int(1),
  sales_history_days: int(1),
  min_sales_days_for_forecast: int(1),
  default_supplier_lead_days: int(0),
  default_shipping_lead_days: int(0),
  min_cash_reserve: money(),
  startup_cost_spread_units: optInt(1),
  prelaunch_marketing_spread_units: optInt(1),
});

export const exchangeRateSchema = z.object({ currency, rate_to_base: fxRate, effective_date: reqDate, source: optString });
export const taxRateSchema = z.object({
  market_code: country,
  transaction_type: z.enum(['sale', 'import', 'purchase', 'shipping']),
  name: z.string().trim().min(1).max(100),
  rate_pct: percent(99.99),
  is_default: z.coerce.boolean(),
  is_recoverable: z.coerce.boolean(),
  notes: optString,
});
export const channelSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['website', 'instagram', 'tiktok', 'marketplace', 'retail', 'wholesale', 'other']),
  commission_pct: percent(),
  commission_fixed: money(),
  is_active: z.coerce.boolean().default(true),
});
export const marketSchema = z.object({ code: country, name: z.string().trim().min(1).max(100), currency, is_active: z.coerce.boolean().default(true) });

export type SupplierInput = z.infer<typeof supplierSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type SalesOrderInput = z.infer<typeof salesOrderSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;
export type CampaignInput = z.infer<typeof campaignSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
