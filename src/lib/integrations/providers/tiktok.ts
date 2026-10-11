import { requestJson, money } from '../http';
import { hmacHex, safeEqual } from '../crypto';
import { IntegrationError, type ExternalOrder, type FetchPage, type ProviderClient } from '../types';
import { D } from '../../calc/money';

const API = 'https://open-api.tiktokglobalshop.com';
const AUTH = 'https://auth.tiktok-shops.com';

export interface TikTokCredentials {
  app_key: string;
  app_secret: string; // also signs webhooks
  service_id?: string; // used to build the seller authorization link
  access_token?: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  shop_cipher?: string;
  shop_id?: string;
  shop_name?: string;
}

/**
 * TikTok Shop request signature (API 202309+): sorted query params excluding `sign` and
 * `access_token`, concatenated as key+value after the path, then the raw body, wrapped in the
 * app secret, HMAC-SHA256 (hex) keyed with the app secret.
 */
export function tiktokSign(path: string, params: Record<string, string>, body: string, appSecret: string) {
  const base = Object.keys(params).filter((k) => k !== 'sign' && k !== 'access_token').sort().map((k) => `${k}${params[k]}`).join('');
  return hmacHex(appSecret, `${appSecret}${path}${base}${body}${appSecret}`);
}

const DONE = ['DELIVERED', 'COMPLETED'];
const SHIPPED = ['AWAITING_COLLECTION', 'IN_TRANSIT', 'PARTIALLY_SHIPPING', ...DONE];
const ts = (s: number | string | null | undefined) => (s ? new Date(Number(s) * 1000).toISOString() : null);

/** TikTok returns one line item per unit; units of the same SKU are grouped back into lines. */
export function normalizeTikTokOrder(o: any): ExternalOrder {
  const p = o.payment ?? {};
  const grouped = new Map<string, { externalLineId: string; sku: string | null; title: string; quantity: number; unitPrice: string; discount: any }>();
  for (const li of o.line_items ?? []) {
    const k = `${li.sku_id ?? li.seller_sku}:${li.original_price}`;
    const g = grouped.get(k) ?? { externalLineId: String(li.sku_id ?? li.id), sku: li.seller_sku || null, title: li.product_name, quantity: 0, unitPrice: money(li.original_price), discount: D(0) };
    g.quantity += 1;
    g.discount = D(g.discount).plus(D(money(li.seller_discount)));
    grouped.set(k, g);
  }
  const lines = [...grouped.values()].map((l) => ({ ...l, discount: D(l.discount).toFixed(2) }));
  const status: string = o.status;
  const paid = !!o.paid_time && status !== 'UNPAID';
  // Platform-funded discounts are paid to the seller by TikTok, so they are not a seller discount.
  const sellerShipping = D(money(p.original_shipping_fee)).minus(D(money(p.shipping_fee_seller_discount)));
  return {
    externalId: String(o.id),
    orderNumber: String(o.id),
    createdAt: ts(o.create_time)!,
    updatedAt: ts(o.update_time) ?? ts(o.create_time)!,
    currency: p.currency ?? 'EUR',
    pricesIncludeTax: true,
    customer: { name: o.recipient_address?.name ?? null, email: o.buyer_email ?? null, phone: o.recipient_address?.phone_number ?? null, city: o.recipient_address?.district_info?.find?.((d: any) => /city/i.test(d.address_level_name))?.address_name ?? null, country: o.recipient_address?.region_code ?? null },
    lines,
    shippingCharged: sellerShipping.greaterThan(0) ? sellerShipping.toFixed(2) : '0',
    orderDiscount: '0',
    taxTotal: money(p.tax),
    total: D(money(p.total_amount)).plus(D(money(p.platform_discount))).toFixed(2),
    paymentMethod: o.is_cod ? 'cod' : 'marketplace',
    payments: paid ? [{ id: `tt-pay-${o.id}`, amount: D(money(p.total_amount)).plus(D(money(p.platform_discount))).toFixed(2), date: ts(o.paid_time)! }] : [],
    refunds: [], // refunds come from the Return & Refund API (not connected yet); record them on the order
    fulfillment: DONE.includes(status) ? 'delivered' : SHIPPED.includes(status) ? 'shipped' : 'unfulfilled',
    shippedAt: ts(o.collection_time ?? o.shipping_time) ?? (SHIPPED.includes(status) ? ts(o.update_time) : null),
    deliveredAt: DONE.includes(status) ? (ts(o.delivery_time) ?? ts(o.update_time)) : null,
    trackingNumber: o.tracking_number ?? null,
    carrier: o.shipping_provider ?? null,
    cancelled: status === 'CANCELLED',
    cancelledAt: status === 'CANCELLED' ? ts(o.cancel_time ?? o.update_time) : null,
    marketplaceFee: null,
  };
}

export class TikTokClient implements ProviderClient<TikTokCredentials> {
  private changed = false;
  constructor(private creds: TikTokCredentials) {}
  credentials() { return this.creds; }
  credentialsChanged() { return this.changed; }

  private async token() {
    const c = this.creds;
    if (c.access_token && c.expires_at && c.expires_at - Date.now() > 10 * 60_000) return c.access_token;
    if (!c.refresh_token) throw new IntegrationError('TikTok Shop is not authorised yet. Click “Authorize shop”.');
    const u = new URL(`${AUTH}/api/v2/token/refresh`);
    for (const [k, v] of Object.entries({ app_key: c.app_key, app_secret: c.app_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' })) u.searchParams.set(k, v);
    const r = await requestJson<any>(u.toString(), { label: 'TikTok auth' });
    if (r.code !== 0) throw new IntegrationError(`TikTok auth: ${r.message}`);
    this.creds = { ...c, access_token: r.data.access_token, refresh_token: r.data.refresh_token, expires_at: Number(r.data.access_token_expire_in) * 1000 };
    this.changed = true;
    return r.data.access_token as string;
  }

  async call<T = any>(method: 'GET' | 'POST', path: string, query: Record<string, string> = {}, body?: unknown, withCipher = true): Promise<T> {
    const params: Record<string, string> = { app_key: this.creds.app_key, timestamp: String(Math.floor(Date.now() / 1000)), ...query };
    if (withCipher && this.creds.shop_cipher) params.shop_cipher = this.creds.shop_cipher;
    const raw = body === undefined ? '' : JSON.stringify(body);
    params.sign = tiktokSign(path, params, raw, this.creds.app_secret);
    const r = await requestJson<any>(`${API}${path}?${new URLSearchParams(params)}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-tts-access-token': await this.token() },
      body: raw || undefined,
      label: 'TikTok Shop',
    });
    if (r.code !== 0) throw new IntegrationError(`TikTok Shop: ${r.message} (code ${r.code})`);
    return r.data as T;
  }

  /** After authorization: pick the authorised shop and keep its cipher. */
  async loadShop() {
    const d = await this.call<any>('GET', '/authorization/202309/shops', {}, undefined, false);
    const shop = d.shops?.[0];
    if (!shop) throw new IntegrationError('No TikTok shop is authorised for this app.');
    this.creds = { ...this.creds, shop_cipher: shop.cipher, shop_id: String(shop.id), shop_name: shop.name };
    this.changed = true;
    return shop.name as string;
  }

  async test() {
    if (!this.creds.shop_cipher) return this.loadShop();
    return this.creds.shop_name ?? 'TikTok Shop';
  }

  async listOrders(since: string, pageToken: string | null): Promise<FetchPage> {
    const q: Record<string, string> = { page_size: '50', sort_field: 'update_time', sort_order: 'ASC' };
    if (pageToken) q.page_token = pageToken;
    const d = await this.call<any>('POST', '/order/202309/orders/search', q, { update_time_ge: Math.floor(new Date(since).getTime() / 1000) });
    return { orders: (d.orders ?? []).map(normalizeTikTokOrder), nextCursor: d.next_page_token || null };
  }

  async getOrder(id: string) {
    const d = await this.call<any>('GET', '/order/202309/orders', { ids: id });
    return d.orders?.[0] ? normalizeTikTokOrder(d.orders[0]) : null;
  }
}

export function tiktokAuthorizeUrl(c: TikTokCredentials, state: string) {
  const u = new URL('https://services.tiktokshop.com/open/authorize');
  u.searchParams.set('service_id', c.service_id ?? '');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeTikTokCode(c: TikTokCredentials, code: string): Promise<TikTokCredentials> {
  const u = new URL(`${AUTH}/api/v2/token/get`);
  for (const [k, v] of Object.entries({ app_key: c.app_key, app_secret: c.app_secret, auth_code: code, grant_type: 'authorized_code' })) u.searchParams.set(k, v);
  const r = await requestJson<any>(u.toString(), { label: 'TikTok auth' });
  if (r.code !== 0) throw new IntegrationError(`TikTok auth: ${r.message}`);
  return { ...c, access_token: r.data.access_token, refresh_token: r.data.refresh_token, expires_at: Number(r.data.access_token_expire_in) * 1000 };
}

export function verifyTikTokWebhook(rawBody: string, headers: Headers, c: TikTokCredentials) {
  return safeEqual(hmacHex(c.app_secret, `${c.app_key}${rawBody}`), headers.get('authorization'));
}

export function tiktokWebhookRef(body: any) {
  return { topic: String(body?.type ?? ''), dedupe: body?.tts_notification_id ?? null, orderId: body?.data?.order_id ? String(body.data.order_id) : null };
}
