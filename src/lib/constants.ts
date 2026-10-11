export const EXPENSE_CATEGORIES = [
  // acquisition / import
  { value: 'freight', label: 'International freight', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'insurance', label: 'Shipping insurance', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'customs_duty', label: 'Customs duties', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'import_vat', label: 'Import VAT', group: 'Import & logistics', treatment: 'recoverable_tax' },
  { value: 'customs_clearance', label: 'Customs clearance', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'broker', label: 'Customs broker fees', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'port_handling', label: 'Port / airport / handling fees', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'local_transport', label: 'Local transportation', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'packaging_labeling', label: 'Packaging & labeling', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'quality_check', label: 'Quality checks', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'inspection', label: 'Inspection fees', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'bank_fee', label: 'Bank transfer fees', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'fx_charge', label: 'Currency conversion charges', group: 'Import & logistics', treatment: 'product_acquisition' },
  { value: 'other_import', label: 'Other import-related', group: 'Import & logistics', treatment: 'product_acquisition' },
  // business
  { value: 'product_development', label: 'Product development', group: 'Launch & brand', treatment: 'startup' },
  { value: 'samples', label: 'Samples', group: 'Launch & brand', treatment: 'startup' },
  { value: 'branding', label: 'Branding', group: 'Launch & brand', treatment: 'startup' },
  { value: 'logo_design', label: 'Logo design', group: 'Launch & brand', treatment: 'startup' },
  { value: 'website_setup', label: 'Website setup', group: 'Launch & brand', treatment: 'startup' },
  { value: 'packaging_design', label: 'Packaging design', group: 'Launch & brand', treatment: 'startup' },
  { value: 'photography', label: 'Photography', group: 'Launch & brand', treatment: 'startup' },
  { value: 'influencer_marketing', label: 'Influencer marketing', group: 'Marketing', treatment: 'marketing' },
  { value: 'paid_advertising', label: 'Paid advertising', group: 'Marketing', treatment: 'marketing' },
  { value: 'marketing_other', label: 'Other marketing', group: 'Marketing', treatment: 'marketing' },
  { value: 'fulfilment', label: 'Fulfilment & shipping supplies', group: 'Operations', treatment: 'per_order_variable' },
  { value: 'transport', label: 'Transport', group: 'Operations', treatment: 'operating' },
  { value: 'subscriptions', label: 'Subscriptions & software', group: 'Operations', treatment: 'operating' },
  { value: 'legal_admin', label: 'Legal & administrative', group: 'Operations', treatment: 'operating' },
  { value: 'accounting', label: 'Accounting', group: 'Operations', treatment: 'operating' },
  { value: 'rent', label: 'Rent & storage', group: 'Operations', treatment: 'operating' },
  { value: 'miscellaneous', label: 'Miscellaneous', group: 'Operations', treatment: 'operating' },
] as const;

export const categoryLabel = (v: string) => EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? v;

export const EXPENSE_TREATMENTS = [
  { value: 'product_acquisition', label: 'Product acquisition cost', help: 'Capitalised into the landed cost of a purchase order or shipment; becomes COGS only when units are sold.' },
  { value: 'recoverable_tax', label: 'Recoverable tax', help: 'E.g. recoverable import VAT. Tracked as a receivable from the tax authority — not a product cost.' },
  { value: 'operating', label: 'Recurring operating expense', help: 'Fixed costs of running the business (software, accounting, rent).' },
  { value: 'startup', label: 'One-time startup expense', help: 'Visible in total business profitability; not added to unit costs.' },
  { value: 'per_order_variable', label: 'Per-order variable cost', help: 'Costs that scale with orders (shipping supplies bought in bulk, etc.).' },
  { value: 'marketing', label: 'Marketing acquisition cost', help: 'Advertising and promotion. Link to a campaign to measure CPA and ROAS.' },
] as const;

export const treatmentLabel = (v: string) => EXPENSE_TREATMENTS.find((t) => t.value === v)?.label ?? v;

export const ALLOCATION_METHODS = [
  { value: 'value', label: 'By product value' },
  { value: 'quantity', label: 'By quantity' },
  { value: 'weight', label: 'By weight' },
  { value: 'volume', label: 'By volume' },
  { value: 'manual', label: 'Manual shares' },
] as const;

export const PO_STATUSES = ['draft', 'ordered', 'partially_paid', 'paid', 'in_production', 'shipped', 'received', 'cancelled'] as const;
export const SHIPMENT_STATUSES = ['planned', 'booked', 'in_transit', 'at_customs', 'cleared', 'delivered', 'received', 'cancelled'] as const;
export const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'] as const;
export const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded'] as const;
export const PAYMENT_METHODS = [
  { value: 'card', label: 'Card' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'cod', label: 'Cash on delivery' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'marketplace', label: 'Marketplace payout' },
  { value: 'other', label: 'Other' },
] as const;
export const CAMPAIGN_CHANNELS = [
  { value: 'meta', label: 'Meta Ads' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'google', label: 'Google Ads' },
  { value: 'influencer', label: 'Influencer' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
] as const;
export const CAMPAIGN_ALLOCATIONS = [
  { value: 'delivered_orders', label: 'Units in attributed delivered orders' },
  { value: 'attributed_orders', label: 'Units in all attributed orders' },
  { value: 'revenue_share', label: 'Share of attributed revenue' },
  { value: 'manual', label: 'Manual shares per product' },
] as const;
export const CASH_CATEGORIES = [
  { value: 'opening_balance', label: 'Opening balance', direction: 'in' },
  { value: 'owner_contribution', label: 'Owner contribution', direction: 'in' },
  { value: 'owner_withdrawal', label: 'Owner withdrawal', direction: 'out' },
  { value: 'loan_in', label: 'Loan received', direction: 'in' },
  { value: 'loan_repayment', label: 'Loan repayment', direction: 'out' },
  { value: 'customer_receipt', label: 'Customer receipt', direction: 'in' },
  { value: 'customer_refund', label: 'Customer refund', direction: 'out' },
  { value: 'supplier_payment', label: 'Supplier payment', direction: 'out' },
  { value: 'expense_payment', label: 'Expense payment', direction: 'out' },
  { value: 'tax_payment', label: 'Tax payment', direction: 'out' },
  { value: 'tax_refund', label: 'Tax refund', direction: 'in' },
  { value: 'other_in', label: 'Other income', direction: 'in' },
  { value: 'other_out', label: 'Other payment', direction: 'out' },
] as const;
export const cashCategoryLabel = (v: string) => CASH_CATEGORIES.find((c) => c.value === v)?.label ?? v;

export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');
