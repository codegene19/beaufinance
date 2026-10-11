-- Sales-channel integrations: Shopify, WooCommerce, eBay, TikTok Shop.
create type integration_provider as enum ('shopify', 'woocommerce', 'ebay', 'tiktok');

create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider integration_provider not null,
  name text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'error', 'paused')),
  account_ref text,                -- shop domain / site URL / eBay user / TikTok shop id
  credentials_encrypted text,      -- AES-256-GCM JSON blob, server-side only, never sent to the browser
  credentials_hint jsonb not null default '{}'::jsonb, -- non-secret display info (e.g. last 4 chars)
  channel_id uuid references sales_channels(id) on delete set null,
  settings jsonb not null default '{}'::jsonb,
  sync_cursor timestamptz,         -- external "updated since" watermark
  last_synced_at timestamptz,
  last_error text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, business_id)
);
create index on integration_connections(business_id);

create table external_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  connection_id uuid not null,
  external_id text not null,
  external_number text,
  sales_order_id uuid references sales_orders(id) on delete set null,
  state text not null default 'pending' check (state in ('pending', 'synced', 'needs_review', 'ignored', 'error')),
  issue text,
  payload_hash text,
  external_updated_at timestamptz,
  last_payload jsonb,              -- normalised snapshot (used to retry after fixing a problem)
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (connection_id, business_id) references integration_connections(id, business_id) on delete cascade,
  unique (connection_id, external_id)
);
create index on external_orders(business_id, state);
create unique index external_orders_sales_order on external_orders(sales_order_id) where sales_order_id is not null;

create table external_sku_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  connection_id uuid not null,
  external_sku text not null,
  external_title text,
  variant_id uuid references product_variants(id) on delete set null,
  ignored boolean not null default false, -- e.g. gift cards, shipping protection: never stocked
  updated_at timestamptz not null default now(),
  foreign key (connection_id, business_id) references integration_connections(id, business_id) on delete cascade,
  unique (connection_id, external_sku)
);

create table integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  connection_id uuid not null,
  trigger text not null check (trigger in ('manual', 'cron', 'webhook', 'retry')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched int not null default 0,
  created int not null default 0,
  updated int not null default 0,
  unchanged int not null default 0,
  needs_review int not null default 0,
  ignored int not null default 0,
  errors int not null default 0,
  error text,
  foreign key (connection_id, business_id) references integration_connections(id, business_id) on delete cascade
);
create index on integration_sync_runs(connection_id, started_at desc);

-- Webhook deliveries are at-least-once: dedupe on the provider's delivery id.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  connection_id uuid not null,
  dedupe_key text not null,
  topic text,
  external_order_id text,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'error')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (connection_id, business_id) references integration_connections(id, business_id) on delete cascade,
  unique (connection_id, dedupe_key)
);

alter table sales_orders add column source text not null default 'manual';

do $$
declare t text;
begin
  foreach t in array array['integration_connections','external_orders','external_sku_mappings','integration_sync_runs','webhook_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %1$s_select on %1$I for select using (is_member(business_id))', t);
    execute format('create policy %1$s_insert on %1$I for insert with check (can_write(business_id))', t);
    execute format('create policy %1$s_update on %1$I for update using (can_write(business_id)) with check (can_write(business_id))', t);
    execute format('create policy %1$s_delete on %1$I for delete using (can_write(business_id))', t);
  end loop;
end $$;

-- credentials_encrypted is AES-256-GCM ciphertext; the key exists only in server environment variables.
grant select, insert, update, delete on integration_connections, external_orders, external_sku_mappings, integration_sync_runs, webhook_events to authenticated;

create trigger audit_integration_connections after insert or update or delete on integration_connections for each row execute function public.audit_row();
