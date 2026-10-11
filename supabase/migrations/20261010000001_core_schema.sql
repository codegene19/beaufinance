-- =====================================================================
-- BeauFinance core schema
-- Conventions
--   * Every business-owned row carries business_id (tenant key, RLS).
--   * Money in original currency: numeric(18,2). FX rates: numeric(18,8).
--   * Base-currency amounts are GENERATED from amount * fx_rate so they can
--     never drift from the original value and rate recorded on the transaction.
--   * Quantities are integers (units).
-- =====================================================================
-- gen_random_uuid() is built into PostgreSQL 13+

-- ---------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  logo_url text,
  base_currency char(3) not null default 'EUR',
  is_demo boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create type member_role as enum ('owner', 'manager', 'viewer');

create table business_members (
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index on business_members(user_id);

create or replace function public.is_member(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_members m where m.business_id = bid and m.user_id = auth.uid())
$$;

create or replace function public.can_write(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_members m
                 where m.business_id = bid and m.user_id = auth.uid()
                   and m.role in ('owner', 'manager'))
$$;

create or replace function public.is_owner(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_members m
                 where m.business_id = bid and m.user_id = auth.uid() and m.role = 'owner')
$$;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
create type costing_method as enum ('fifo', 'fefo');
create type negative_stock_policy as enum ('block', 'allow_with_warning');
create type revenue_recognition as enum ('on_delivery', 'on_shipment', 'on_payment');
create type price_tax_mode as enum ('tax_inclusive', 'tax_exclusive');
create type fee_basis as enum ('gross_incl_tax', 'net_excl_tax');

create table business_settings (
  business_id uuid primary key references businesses(id) on delete cascade,
  default_market char(2) not null default 'FR',
  price_tax_mode price_tax_mode not null default 'tax_inclusive',
  fee_basis fee_basis not null default 'gross_incl_tax',
  costing_method costing_method not null default 'fifo',
  negative_stock_policy negative_stock_policy not null default 'block',
  revenue_recognition revenue_recognition not null default 'on_delivery',
  -- Treat cash-on-delivery orders that are never delivered as cancelled (stock restored, no revenue)
  cod_undelivered_restock boolean not null default true,
  import_vat_recoverable boolean not null default true,
  default_payment_fee_pct numeric(7,4) not null default 1.5 check (default_payment_fee_pct between 0 and 100),
  default_payment_fee_fixed numeric(18,2) not null default 0.25 check (default_payment_fee_fixed >= 0),
  default_packaging_cost numeric(18,2) not null default 0.80 check (default_packaging_cost >= 0),
  default_fulfillment_cost numeric(18,2) not null default 1.50 check (default_fulfillment_cost >= 0),
  default_shipping_cost numeric(18,2) not null default 5.50 check (default_shipping_cost >= 0),
  default_target_margin_pct numeric(7,4) not null default 35 check (default_target_margin_pct < 100),
  min_acceptable_margin_pct numeric(7,4) not null default 20 check (min_acceptable_margin_pct < 100),
  premium_margin_uplift_pct numeric(7,4) not null default 15,
  safety_buffer_days integer not null default 14 check (safety_buffer_days >= 0),
  target_coverage_days integer not null default 120 check (target_coverage_days > 0),
  sales_history_days integer not null default 60 check (sales_history_days > 0),
  min_sales_days_for_forecast integer not null default 14 check (min_sales_days_for_forecast > 0),
  default_supplier_lead_days integer not null default 30 check (default_supplier_lead_days >= 0),
  default_shipping_lead_days integer not null default 21 check (default_shipping_lead_days >= 0),
  min_cash_reserve numeric(18,2) not null default 1000 check (min_cash_reserve >= 0),
  startup_cost_spread_units integer check (startup_cost_spread_units is null or startup_cost_spread_units > 0),
  prelaunch_marketing_spread_units integer check (prelaunch_marketing_spread_units is null or prelaunch_marketing_spread_units > 0),
  updated_at timestamptz not null default now()
);

create table currencies (
  business_id uuid not null references businesses(id) on delete cascade,
  code char(3) not null check (code ~ '^[A-Z]{3}$'),
  name text not null,
  primary key (business_id, code)
);

-- Default rates used to PRE-FILL new transactions. Every transaction stores
-- its own fx_rate, so editing a default never rewrites history.
create table exchange_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  currency char(3) not null,
  rate_to_base numeric(18,8) not null check (rate_to_base > 0),
  effective_date date not null default current_date,
  source text,
  created_at timestamptz not null default now(),
  unique (business_id, currency, effective_date)
);

create table markets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code char(2) not null,
  name text not null,
  currency char(3) not null default 'EUR',
  is_active boolean not null default true,
  unique (business_id, code)
);

create type tax_transaction_type as enum ('sale', 'import', 'purchase', 'shipping');

create table tax_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  market_code char(2) not null,
  transaction_type tax_transaction_type not null default 'sale',
  name text not null,
  rate_pct numeric(7,4) not null check (rate_pct >= 0 and rate_pct < 100),
  is_default boolean not null default false,
  is_recoverable boolean not null default true,
  notes text
);
create unique index tax_rates_one_default on tax_rates(business_id, market_code, transaction_type) where is_default;

create table sales_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  kind text not null default 'website' check (kind in ('website','instagram','tiktok','marketplace','retail','wholesale','other')),
  commission_pct numeric(7,4) not null default 0 check (commission_pct between 0 and 100),
  commission_fixed numeric(18,2) not null default 0 check (commission_fixed >= 0),
  is_active boolean not null default true,
  unique (business_id, name)
);

-- ---------------------------------------------------------------------
-- Suppliers & products
-- ---------------------------------------------------------------------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  country char(2) not null default 'MA',
  contact_name text,
  email text,
  phone text,
  address text,
  currency char(3) not null default 'MAD',
  payment_terms text,
  default_deposit_pct numeric(7,4) not null default 30 check (default_deposit_pct between 0 and 100),
  lead_time_days integer check (lead_time_days >= 0),
  min_order_qty integer check (min_order_qty >= 0),
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, business_id)
);
create index on suppliers(business_id);

create type product_status as enum ('draft', 'active', 'discontinued');

create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  brand text,
  category text,
  supplier_id uuid references suppliers(id) on delete set null,
  country_of_origin char(2) default 'MA',
  image_url text,
  status product_status not null default 'draft',
  has_expiry boolean not null default false,
  shelf_life_days integer check (shelf_life_days > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);
create index on products(business_id);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  sku text not null check (length(trim(sku)) > 0),
  barcode text,
  variant_name text not null default 'Standard', -- size / volume / scent / packaging
  supplier_unit_price numeric(18,4) not null default 0 check (supplier_unit_price >= 0),
  purchase_currency char(3) not null default 'MAD',
  default_selling_price numeric(18,2) check (default_selling_price >= 0),
  selling_price_includes_tax boolean not null default true,
  target_margin_pct numeric(7,4) check (target_margin_pct < 100),
  target_markup_pct numeric(9,4) check (target_markup_pct >= 0),
  length_cm numeric(10,2) check (length_cm >= 0),
  width_cm numeric(10,2) check (width_cm >= 0),
  height_cm numeric(10,2) check (height_cm >= 0),
  weight_kg numeric(10,3) check (weight_kg >= 0),
  min_order_qty integer check (min_order_qty >= 0),
  order_multiple integer check (order_multiple > 0),
  supplier_lead_days integer check (supplier_lead_days >= 0),
  shipping_lead_days integer check (shipping_lead_days >= 0),
  safety_stock_qty integer not null default 0 check (safety_stock_qty >= 0),
  packaging_cost numeric(18,2) check (packaging_cost >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (product_id, business_id) references products(id, business_id) on delete cascade,
  unique (business_id, sku),
  unique (id, business_id)
);
create index on product_variants(product_id);

create table product_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  url text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------
create type po_status as enum ('draft','ordered','partially_paid','paid','in_production','shipped','received','cancelled');

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  po_number text not null,
  supplier_id uuid not null,
  order_date date not null default current_date,
  currency char(3) not null,
  fx_rate numeric(18,8) not null check (fx_rate > 0), -- accounting rate: 1 unit of currency = fx_rate base
  status po_status not null default 'draft',
  deposit_due numeric(18,2) not null default 0 check (deposit_due >= 0),
  expected_production_date date,
  expected_ship_date date,
  expected_arrival_date date,
  actual_delivery_date date,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (supplier_id, business_id) references suppliers(id, business_id),
  unique (business_id, po_number),
  unique (id, business_id)
);
create index on purchase_orders(business_id, status);

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  purchase_order_id uuid not null,
  variant_id uuid not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  line_total numeric(18,2) generated always as (round(quantity * unit_price, 2)) stored,
  foreign key (purchase_order_id, business_id) references purchase_orders(id, business_id) on delete cascade,
  foreign key (variant_id, business_id) references product_variants(id, business_id),
  unique (purchase_order_id, variant_id),
  unique (id, business_id)
);

create table supplier_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  purchase_order_id uuid not null,
  payment_date date not null,
  amount numeric(18,2) not null check (amount > 0), -- in PO currency
  fx_rate numeric(18,8) not null check (fx_rate > 0), -- actual rate on payment date
  amount_base numeric(18,4) generated always as (round(amount * fx_rate, 4)) stored,
  is_deposit boolean not null default false,
  method text,
  reference text,
  idempotency_key text not null,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (purchase_order_id, business_id) references purchase_orders(id, business_id) on delete restrict,
  unique (business_id, idempotency_key)
);

-- ---------------------------------------------------------------------
-- Shipments
-- ---------------------------------------------------------------------
create type shipment_status as enum ('planned','booked','in_transit','at_customs','cleared','delivered','received','cancelled');
create type allocation_method as enum ('quantity','value','weight','volume','manual');

create table shipments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  reference text not null,
  carrier text,
  mode text check (mode in ('sea','air','road','courier','other')),
  tracking_ref text,
  status shipment_status not null default 'planned',
  dispatch_date date,
  expected_arrival_date date,
  actual_arrival_date date,
  default_allocation_method allocation_method not null default 'value',
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, reference),
  unique (id, business_id)
);

create table shipment_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shipment_id uuid not null,
  purchase_order_item_id uuid not null,
  quantity integer not null check (quantity > 0),
  -- optional overrides of the variant's master data for allocation
  total_weight_kg numeric(12,3) check (total_weight_kg >= 0),
  total_volume_m3 numeric(12,6) check (total_volume_m3 >= 0),
  foreign key (shipment_id, business_id) references shipments(id, business_id) on delete cascade,
  foreign key (purchase_order_item_id, business_id) references purchase_order_items(id, business_id),
  unique (shipment_id, purchase_order_item_id),
  unique (id, business_id)
);

-- ---------------------------------------------------------------------
-- Expenses (single source of truth for every non-inventory cost:
-- import costs, startup, operating, marketing, per-order variable costs)
-- ---------------------------------------------------------------------
create type expense_treatment as enum (
  'product_acquisition',   -- capitalised into landed cost of inventory
  'recoverable_tax',       -- e.g. recoverable import VAT: a receivable, not a cost
  'operating',             -- recurring operating expense
  'startup',               -- one-time startup expense
  'per_order_variable',    -- variable cost per order (fulfilment, packaging bought in bulk...)
  'marketing'              -- marketing / customer acquisition
);
create type expense_commitment as enum ('planned','committed','cancelled');

create table expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  category text not null,
  amount numeric(18,2) not null check (amount >= 0),
  currency char(3) not null,
  fx_rate numeric(18,8) check (fx_rate > 0), -- null => missing rate, excluded from base totals with a warning
  amount_base numeric(18,4) generated always as (round(amount * fx_rate, 4)) stored,
  date_incurred date not null,
  due_date date,
  commitment expense_commitment not null default 'committed',
  treatment expense_treatment not null,
  payee text,
  supplier_id uuid references suppliers(id) on delete set null,
  -- link targets (an expense belongs to at most ONE allocation pool: prevents double allocation)
  purchase_order_id uuid references purchase_orders(id) on delete restrict,
  shipment_id uuid references shipments(id) on delete restrict,
  variant_id uuid references product_variants(id) on delete restrict, -- restricts allocation to this variant
  campaign_id uuid,
  allocation_method allocation_method,
  attachment_url text,
  recurring_interval text check (recurring_interval in ('monthly','quarterly','yearly')),
  notes text,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  check (not (purchase_order_id is not null and shipment_id is not null)),
  check (treatment <> 'product_acquisition' or purchase_order_id is not null or shipment_id is not null),
  check (treatment <> 'marketing' or shipment_id is null and purchase_order_id is null)
);
create index on expenses(business_id, date_incurred);
create index on expenses(shipment_id);
create index on expenses(purchase_order_id);
create index on expenses(campaign_id);

create table expense_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  expense_id uuid not null,
  payment_date date not null,
  amount numeric(18,2) not null check (amount > 0), -- expense currency
  fx_rate numeric(18,8) not null check (fx_rate > 0),
  amount_base numeric(18,4) generated always as (round(amount * fx_rate, 4)) stored,
  method text,
  reference text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  foreign key (expense_id, business_id) references expenses(id, business_id) on delete restrict,
  unique (business_id, idempotency_key)
);

-- Manual allocation lines for an acquisition expense (method = manual)
create table expense_manual_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  expense_id uuid not null,
  variant_id uuid not null,
  share_pct numeric(9,6) not null check (share_pct > 0 and share_pct <= 100),
  foreign key (expense_id, business_id) references expenses(id, business_id) on delete cascade,
  foreign key (variant_id, business_id) references product_variants(id, business_id),
  unique (expense_id, variant_id)
);

-- Computed allocations of acquisition expenses to shipment / PO lines.
-- Rebuilt atomically by the landed-cost service; unique key prevents duplicates.
create table cost_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  expense_id uuid not null references expenses(id) on delete cascade,
  purchase_order_item_id uuid not null references purchase_order_items(id) on delete cascade,
  shipment_item_id uuid references shipment_items(id) on delete cascade,
  method allocation_method not null,
  basis_value numeric(20,6) not null,
  amount_base numeric(18,4) not null,
  computed_at timestamptz not null default now(),
  unique (expense_id, purchase_order_item_id, shipment_item_id)
);
create unique index cost_allocations_unique_nulls on cost_allocations(expense_id, purchase_order_item_id) where shipment_item_id is null;

-- ---------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------
create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id),
  shipment_id uuid references shipments(id),
  received_date date not null,
  notes text,
  idempotency_key text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create table inventory_lots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  variant_id uuid not null,
  goods_receipt_id uuid references goods_receipts(id) on delete restrict,
  purchase_order_item_id uuid references purchase_order_items(id),
  shipment_item_id uuid references shipment_items(id),
  lot_code text not null,
  received_date date not null,
  expiry_date date,
  qty_received integer not null check (qty_received >= 0),   -- physically counted, incl. damaged
  qty_damaged integer not null default 0 check (qty_damaged >= 0),
  qty_rejected integer not null default 0 check (qty_rejected >= 0),
  qty_missing integer not null default 0 check (qty_missing >= 0), -- expected but not delivered
  qty_sellable integer generated always as (qty_received - qty_damaged - qty_rejected) stored,
  -- Cost snapshot (base currency); refreshed whenever acquisition costs change
  landed_cost_total numeric(18,4) not null default 0,
  landed_unit_cost numeric(18,6) not null default 0,
  cost_breakdown jsonb not null default '{}'::jsonb,
  is_opening_stock boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (variant_id, business_id) references product_variants(id, business_id),
  check (qty_damaged + qty_rejected <= qty_received),
  unique (business_id, lot_code),
  unique (id, business_id)
);
create index on inventory_lots(variant_id);

create type movement_type as enum (
  'receipt',           -- sellable units into stock
  'sale_shipment',     -- units leave on order shipment
  'sale_reversal',     -- shipped order returned to sender / undelivered
  'customer_return',   -- returned resellable units
  'adjustment',        -- manual count correction (+/-)
  'write_off'          -- damaged / expired / lost
);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  variant_id uuid not null,
  lot_id uuid not null,
  movement_type movement_type not null,
  quantity integer not null check (quantity <> 0), -- signed
  reference_type text not null,
  reference_id uuid,
  order_item_id uuid,
  reason text,
  idempotency_key text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (lot_id, business_id) references inventory_lots(id, business_id) on delete restrict,
  unique (business_id, idempotency_key)
);
create index on inventory_movements(variant_id, created_at);
create index on inventory_movements(lot_id);

-- ---------------------------------------------------------------------
-- Marketing
-- ---------------------------------------------------------------------
create type campaign_allocation as enum ('attributed_orders','delivered_orders','revenue_share','manual');

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('meta','instagram','tiktok','google','influencer','email','other')),
  start_date date,
  end_date date,
  planned_budget numeric(18,2) not null default 0 check (planned_budget >= 0),
  is_prelaunch boolean not null default false,
  allocation_method campaign_allocation not null default 'delivered_orders',
  sessions integer check (sessions >= 0), -- optional, for conversion rate
  notes text,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  check (end_date is null or start_date is null or end_date >= start_date)
);
alter table expenses add constraint expenses_campaign_fk foreign key (campaign_id) references campaigns(id) on delete restrict;

create table campaign_products (
  business_id uuid not null,
  campaign_id uuid not null,
  variant_id uuid not null,
  manual_share_pct numeric(9,6) check (manual_share_pct > 0 and manual_share_pct <= 100),
  primary key (campaign_id, variant_id),
  foreign key (campaign_id, business_id) references campaigns(id, business_id) on delete cascade,
  foreign key (variant_id, business_id) references product_variants(id, business_id)
);

-- ---------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text,
  city text,
  country char(2),
  created_at timestamptz not null default now()
);

create type order_status as enum ('pending','confirmed','processing','shipped','delivered','cancelled','returned');
create type payment_status as enum ('unpaid','partially_paid','paid','partially_refunded','refunded');

create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_number text not null,
  order_date date not null,
  customer_id uuid references customers(id) on delete set null,
  channel_id uuid references sales_channels(id),
  campaign_id uuid references campaigns(id) on delete set null,
  market_code char(2) not null default 'FR',
  currency char(3) not null default 'EUR',
  fx_rate numeric(18,8) not null default 1 check (fx_rate > 0),
  prices_include_tax boolean not null default true,
  tax_rate_pct numeric(7,4) not null default 0 check (tax_rate_pct >= 0 and tax_rate_pct < 100),
  shipping_charged numeric(18,2) not null default 0 check (shipping_charged >= 0), -- same tax basis as prices
  order_discount numeric(18,2) not null default 0 check (order_discount >= 0),    -- same tax basis as prices
  payment_method text not null default 'card' check (payment_method in ('card','paypal','cod','bank_transfer','cash','marketplace','other')),
  status order_status not null default 'pending',
  payment_status payment_status not null default 'unpaid',
  delivery_provider text,
  tracking_ref text,
  shipping_cost numeric(18,2) not null default 0 check (shipping_cost >= 0),       -- paid by business, base currency
  fulfillment_cost numeric(18,2) not null default 0 check (fulfillment_cost >= 0), -- base currency
  packaging_cost numeric(18,2) not null default 0 check (packaging_cost >= 0),     -- base currency
  payment_fee numeric(18,2) not null default 0 check (payment_fee >= 0),           -- base currency
  platform_fee numeric(18,2) not null default 0 check (platform_fee >= 0),         -- base currency
  confirmed_at timestamptz,
  shipped_at date,
  delivered_at date,
  cancelled_at date,
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, order_number),
  unique (id, business_id)
);
create index on sales_orders(business_id, order_date);
create index on sales_orders(campaign_id);

create table sales_order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  variant_id uuid not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0), -- per order's tax basis
  line_discount numeric(18,2) not null default 0 check (line_discount >= 0),
  foreign key (order_id, business_id) references sales_orders(id, business_id) on delete cascade,
  foreign key (variant_id, business_id) references product_variants(id, business_id),
  check (line_discount <= quantity * unit_price),
  unique (id, business_id)
);
create index on sales_order_items(order_id);
create index on sales_order_items(variant_id);

-- Which lots fulfil which order line (FIFO/FEFO); traceability sale -> lot -> PO -> costs
create type allocation_status as enum ('reserved','shipped','released','reversed');
create table order_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_item_id uuid not null,
  lot_id uuid not null,
  quantity integer not null check (quantity > 0),
  status allocation_status not null default 'reserved',
  created_at timestamptz not null default now(),
  foreign key (order_item_id, business_id) references sales_order_items(id, business_id) on delete cascade,
  foreign key (lot_id, business_id) references inventory_lots(id, business_id)
);
create index on order_lot_allocations(lot_id, status);
create index on order_lot_allocations(order_item_id);

create table order_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  kind text not null check (kind in ('payment','refund')),
  payment_date date not null,
  amount numeric(18,2) not null check (amount > 0), -- order currency, incl. tax as collected
  fx_rate numeric(18,8) not null default 1 check (fx_rate > 0),
  amount_base numeric(18,4) generated always as (round(amount * fx_rate, 4)) stored,
  method text,
  reference text,
  return_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  foreign key (order_id, business_id) references sales_orders(id, business_id) on delete restrict,
  unique (business_id, idempotency_key)
);

create table returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  return_date date not null,
  reason text,
  refund_amount numeric(18,2) not null default 0 check (refund_amount >= 0), -- order currency incl. tax
  return_shipping_cost numeric(18,2) not null default 0 check (return_shipping_cost >= 0), -- base, paid by business
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  foreign key (order_id, business_id) references sales_orders(id, business_id) on delete restrict,
  unique (business_id, idempotency_key)
);
alter table order_payments add constraint order_payments_return_fk foreign key (return_id) references returns(id) on delete set null;

create table return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  return_id uuid not null references returns(id) on delete cascade,
  order_item_id uuid not null,
  quantity integer not null check (quantity > 0),
  condition text not null check (condition in ('resellable','damaged')),
  foreign key (order_item_id, business_id) references sales_order_items(id, business_id)
);

-- ---------------------------------------------------------------------
-- Cash
-- ---------------------------------------------------------------------
create type cash_category as enum (
  'opening_balance','owner_contribution','owner_withdrawal','loan_in','loan_repayment',
  'customer_receipt','customer_refund','supplier_payment','expense_payment',
  'tax_payment','tax_refund','other_in','other_out'
);

create table cash_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  txn_date date not null,
  direction text not null check (direction in ('in','out')),
  category cash_category not null,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null,
  fx_rate numeric(18,8) not null check (fx_rate > 0),
  amount_base numeric(18,4) generated always as (round(amount * fx_rate, 4)) stored,
  account text not null default 'bank',
  description text,
  source_type text, -- supplier_payment | expense_payment | order_payment | manual
  source_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((category in ('opening_balance','owner_contribution','loan_in','customer_receipt','tax_refund','other_in')) = (direction = 'in'))
);
create unique index cash_transactions_source_unique on cash_transactions(business_id, source_type, source_id) where source_id is not null;
create index on cash_transactions(business_id, txn_date);

-- ---------------------------------------------------------------------
-- Planning artefacts
-- ---------------------------------------------------------------------
create table price_simulations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  name text not null,
  inputs jsonb not null,
  results jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table reorder_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete cascade,
  status text not null,
  data jsonb not null,
  computed_at timestamptz not null default now()
);

create table purchase_scenarios (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  name text not null,
  inputs jsonb not null,
  results jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Audit log (written by trigger; immutable to app users)
-- ---------------------------------------------------------------------
create table audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid,
  user_id uuid,
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index on audit_logs(business_id, created_at desc);

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into audit_logs (business_id, user_id, table_name, record_id, action, old_data, new_data)
  values (
    nullif(rec->>'business_id','')::uuid,
    auth.uid(),
    tg_table_name,
    coalesce(rec->>'id', rec->>'business_id'),
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'business_settings','suppliers','products','product_variants','purchase_orders','purchase_order_items',
    'supplier_payments','shipments','shipment_items','expenses','expense_payments','goods_receipts',
    'inventory_lots','inventory_movements','campaigns','sales_orders','sales_order_items','order_payments',
    'returns','cash_transactions','exchange_rates','tax_rates','sales_channels','business_members'
  ] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table businesses enable row level security;
create policy businesses_select on businesses for select using (is_member(id) or created_by = auth.uid());
create policy businesses_insert on businesses for insert with check (created_by = auth.uid());
create policy businesses_update on businesses for update using (is_owner(id)) with check (is_owner(id));
create policy businesses_delete on businesses for delete using (is_owner(id));

alter table business_members enable row level security;
create policy members_select on business_members for select using (is_member(business_id));
-- the creator may add themselves as owner of a business they just created; owners manage others
create policy members_insert on business_members for insert with check (
  is_owner(business_id)
  or (user_id = auth.uid() and role = 'owner'
      and exists (select 1 from businesses b where b.id = business_id and b.created_by = auth.uid())
      and not exists (select 1 from business_members m where m.business_id = business_members.business_id))
);
create policy members_update on business_members for update using (is_owner(business_id)) with check (is_owner(business_id));
create policy members_delete on business_members for delete using (is_owner(business_id));

alter table audit_logs enable row level security;
create policy audit_select on audit_logs for select using (is_member(business_id));

do $$
declare t text;
begin
  foreach t in array array[
    'business_settings','currencies','exchange_rates','markets','tax_rates','sales_channels',
    'suppliers','products','product_variants','product_documents','purchase_orders','purchase_order_items',
    'supplier_payments','shipments','shipment_items','expenses','expense_payments','expense_manual_allocations',
    'cost_allocations','goods_receipts','inventory_lots','inventory_movements','campaigns','campaign_products',
    'customers','sales_orders','sales_order_items','order_lot_allocations','order_payments','returns','return_items',
    'cash_transactions','price_simulations','reorder_snapshots','purchase_scenarios'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %1$s_select on %1$I for select using (is_member(business_id))', t);
    execute format('create policy %1$s_insert on %1$I for insert with check (can_write(business_id))', t);
    execute format('create policy %1$s_update on %1$I for update using (can_write(business_id)) with check (can_write(business_id))', t);
    execute format('create policy %1$s_delete on %1$I for delete using (can_write(business_id))', t);
  end loop;
end $$;

-- Ledger tables are append-only for app users: corrections are new rows.
drop policy inventory_movements_update on inventory_movements;
drop policy inventory_movements_delete on inventory_movements;
drop policy cash_transactions_update on cash_transactions;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke insert, update, delete on audit_logs from authenticated;
grant execute on function public.is_member(uuid), public.can_write(uuid), public.is_owner(uuid) to authenticated;
