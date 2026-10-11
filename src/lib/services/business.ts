import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db';
import { Tx } from '../db/tenant';
import { AppError } from '../errors';
import type { SettingsInput } from '../validation/schemas';

export interface BusinessSettings {
  business_id: string;
  default_market: string;
  price_tax_mode: 'tax_inclusive' | 'tax_exclusive';
  fee_basis: 'gross_incl_tax' | 'net_excl_tax';
  costing_method: 'fifo' | 'fefo';
  negative_stock_policy: 'block' | 'allow_with_warning';
  revenue_recognition: 'on_delivery' | 'on_shipment' | 'on_payment';
  cod_undelivered_restock: boolean;
  import_vat_recoverable: boolean;
  default_payment_fee_pct: string;
  default_payment_fee_fixed: string;
  default_packaging_cost: string;
  default_fulfillment_cost: string;
  default_shipping_cost: string;
  default_target_margin_pct: string;
  min_acceptable_margin_pct: string;
  premium_margin_uplift_pct: string;
  safety_buffer_days: number;
  target_coverage_days: number;
  sales_history_days: number;
  min_sales_days_for_forecast: number;
  default_supplier_lead_days: number;
  default_shipping_lead_days: number;
  min_cash_reserve: string;
  startup_cost_spread_units: number | null;
  prelaunch_marketing_spread_units: number | null;
}

/**
 * Creates a business with sensible, editable defaults for a Morocco -> France cosmetics brand.
 * Runs as the user (RLS applies). Default rates are placeholders the user must review.
 */
export async function createBusiness(q: Queryable, userId: string, input: { name: string; baseCurrency?: string; isDemo?: boolean }) {
  const id = randomUUID();
  const base = input.baseCurrency ?? 'EUR';
  await q.query('insert into businesses (id, name, base_currency, is_demo, created_by) values ($1,$2,$3,$4,$5)', [id, input.name, base, !!input.isDemo, userId]);
  await q.query(`insert into business_members (business_id, user_id, role) values ($1,$2,'owner')`, [id, userId]);
  await q.query('insert into business_settings (business_id) values ($1)', [id]);
  await q.query(
    `insert into currencies (business_id, code, name) values ($1,'EUR','Euro'),($1,'MAD','Moroccan dirham'),($1,'USD','US dollar')
     on conflict do nothing`,
    [id],
  );
  if (!['EUR', 'MAD', 'USD'].includes(base)) await q.query('insert into currencies (business_id, code, name) values ($1,$2,$2)', [id, base]);
  await q.query(`insert into markets (business_id, code, name, currency) values ($1,'FR','France','EUR')`, [id]);
  await q.query(
    `insert into tax_rates (business_id, market_code, transaction_type, name, rate_pct, is_default, is_recoverable, notes) values
     ($1,'FR','sale','Standard VAT (review with your accountant)',20,true,false,'Default placeholder — verify the rate that applies to your products.'),
     ($1,'FR','import','Import VAT (review with your accountant)',20,true,true,'Usually recoverable for VAT-registered businesses.')`,
    [id],
  );
  await q.query(
    `insert into sales_channels (business_id, name, kind, commission_pct, commission_fixed) values
     ($1,'Website','website',0,0),($1,'Instagram','instagram',0,0),($1,'TikTok Shop','tiktok',5,0),
     ($1,'Marketplace','marketplace',15,0),($1,'Retail','retail',0,0),($1,'Wholesale','wholesale',0,0)`,
    [id],
  );
  if (base === 'EUR') {
    await q.query(
      `insert into exchange_rates (business_id, currency, rate_to_base, effective_date, source) values
       ($1,'MAD',0.0920,current_date,'Default placeholder — update with your bank rate'),
       ($1,'USD',0.9200,current_date,'Default placeholder — update with your bank rate')`,
      [id],
    );
  }
  return id;
}

export async function listMemberships(q: Queryable, userId: string) {
  return q.query<{ id: string; name: string; is_demo: boolean; role: string; base_currency: string; logo_url: string | null }>(
    `select b.id, b.name, b.is_demo, m.role, b.base_currency, b.logo_url
       from business_members m join businesses b on b.id = m.business_id
      where m.user_id = $1 order by b.is_demo, b.created_at`,
    [userId],
  );
}

export async function getSettings(tx: Tx): Promise<BusinessSettings> {
  return tx.one<BusinessSettings>('select * from business_settings where business_id = $1', [tx.businessId], 'Business settings missing');
}

export async function updateSettings(tx: Tx, s: SettingsInput) {
  await tx.exec('update businesses set name = $2, logo_url = $3, base_currency = $4 where id = $1', [tx.businessId, s.business_name, s.logo_url, s.base_currency]);
  const cols = [
    'default_market', 'price_tax_mode', 'fee_basis', 'costing_method', 'negative_stock_policy', 'revenue_recognition', 'cod_undelivered_restock',
    'import_vat_recoverable', 'default_payment_fee_pct', 'default_payment_fee_fixed', 'default_packaging_cost', 'default_fulfillment_cost',
    'default_shipping_cost', 'default_target_margin_pct', 'min_acceptable_margin_pct', 'premium_margin_uplift_pct', 'safety_buffer_days',
    'target_coverage_days', 'sales_history_days', 'min_sales_days_for_forecast', 'default_supplier_lead_days', 'default_shipping_lead_days',
    'min_cash_reserve', 'startup_cost_spread_units', 'prelaunch_marketing_spread_units',
  ] as const;
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  await tx.exec(`update business_settings set ${sets}, updated_at = now() where business_id = $1`, [tx.businessId, ...cols.map((c) => (s as any)[c])]);
  await tx.exec('insert into currencies (business_id, code, name) values ($1,$2,$2) on conflict do nothing', [tx.businessId, s.base_currency]);
}

export async function getBusiness(tx: Tx) {
  return tx.one<{ id: string; name: string; base_currency: string; is_demo: boolean; logo_url: string | null }>('select id, name, base_currency, is_demo, logo_url from businesses where id = $1', [tx.businessId]);
}

/**
 * Default exchange rate (1 unit of `currency` in base currency) on a date, used only to PRE-FILL a
 * transaction. Returns null when no rate is recorded — callers must ask the user, never guess.
 */
export async function defaultFxRate(tx: Tx, currency: string, onDate?: string | null): Promise<string | null> {
  const b = await getBusiness(tx);
  if (currency === b.base_currency) return '1';
  const r = await tx.maybe<{ rate_to_base: string }>(
    `select rate_to_base from exchange_rates where business_id = $1 and currency = $2 and effective_date <= coalesce($3::date, current_date)
     order by effective_date desc limit 1`,
    [tx.businessId, currency, onDate ?? null],
  );
  if (r) return r.rate_to_base;
  const any = await tx.maybe<{ rate_to_base: string }>(`select rate_to_base from exchange_rates where business_id = $1 and currency = $2 order by effective_date asc limit 1`, [tx.businessId, currency]);
  return any?.rate_to_base ?? null;
}

export async function allDefaultFxRates(tx: Tx): Promise<Record<string, string>> {
  const b = await getBusiness(tx);
  const rows = await tx.many<{ currency: string; rate_to_base: string }>(
    `select distinct on (currency) currency, rate_to_base from exchange_rates where business_id = $1 and effective_date <= current_date order by currency, effective_date desc`,
    [tx.businessId],
  );
  const out: Record<string, string> = { [b.base_currency]: '1' };
  for (const r of rows) out[r.currency] = r.rate_to_base;
  return out;
}

export async function requireWriter(tx: Tx) {
  const m = await tx.one<{ role: string }>('select role from business_members where business_id = $1 and user_id = $2', [tx.businessId, tx.userId]);
  if (m.role === 'viewer') throw new AppError('Your role is read-only for this business.', 'forbidden');
}

export async function listReferenceData(tx: Tx) {
  const [currencies, markets, taxRates, channels, rates, members] = await seq([
    () => tx.many('select code, name from currencies where business_id = $1 order by code', [tx.businessId]),
    () => tx.many('select * from markets where business_id = $1 order by code', [tx.businessId]),
    () => tx.many('select * from tax_rates where business_id = $1 order by market_code, transaction_type, rate_pct desc', [tx.businessId]),
    () => tx.many('select * from sales_channels where business_id = $1 order by name', [tx.businessId]),
    () => tx.many('select * from exchange_rates where business_id = $1 order by currency, effective_date desc', [tx.businessId]),
    () => tx.many('select * from business_member_list($1)', [tx.businessId]),
  ]);
  return { currencies, markets, taxRates, channels, rates, members };
}

export async function defaultSaleTaxRate(tx: Tx, market?: string): Promise<string> {
  const s = await getSettings(tx);
  const r = await tx.maybe<{ rate_pct: string }>(
    `select rate_pct from tax_rates where business_id = $1 and market_code = $2 and transaction_type = 'sale' order by is_default desc limit 1`,
    [tx.businessId, market ?? s.default_market],
  );
  return r?.rate_pct ?? '0';
}

/** Run query thunks sequentially (a transaction uses a single connection). */
export async function seq<T extends readonly (() => Promise<any>)[]>(fns: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: any[] = [];
  for (const f of fns) out.push(await f());
  return out as any;
}
