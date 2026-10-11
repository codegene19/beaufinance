import { requestJson, money } from '../http';
import { IntegrationError, type ExternalOrder, type FetchPage, type ProviderClient } from '../types';
import { D } from '../../calc/money';

export const EBAY_SCOPES = ['https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly'];

export interface EbayCredentials {
  environment: 'production' | 'sandbox';
  client_id: string;
  client_secret: string;
  ru_name: string; // eBay "RuName" (redirect URL name) configured to point at our callback
  refresh_token?: string;
  access_token?: string;
  expires_at?: number;
  refresh_expires_at?: number;
  username?: string;
}

const hosts = (env: EbayCredentials['environment']) =>
  env === 'sandbox' ? { api: 'https://api.sandbox.ebay.com', auth: 'https://auth.sandbox.ebay.com' } : { api: 'https://api.ebay.com', auth: 'https://auth.ebay.com' };

const val = (m: any) => money(m?.value);

/** eBay order → standard format. Item prices on EU sites include VAT; configurable per connection. */
export function normalizeEbayOrder(o: any, opts: { pricesIncludeTax?: boolean; fulfilledMeansDelivered?: boolean } = {}): ExternalOrder {
  const ps = o.pricingSummary ?? {};
  const lines = (o.lineItems ?? []).map((l: any) => {
    const qty = Number(l.quantity);
    const cost = D(val(l.lineItemCost));
    const discounted = l.discountedLineItemCost ? D(val(l.discountedLineItemCost)) : cost;
    return { externalLineId: String(l.lineItemId), sku: l.sku || null, title: l.title, quantity: qty, unitPrice: qty ? cost.div(qty).toDecimalPlaces(4).toString() : '0', discount: cost.minus(discounted).toFixed(2) };
  });
  const fulfilled = o.orderFulfillmentStatus === 'FULFILLED' || o.orderFulfillmentStatus === 'IN_PROGRESS';
  const shipTo = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const cancelled = ['CANCELED', 'CANCELLED'].includes(o.cancelStatus?.cancelState);
  const payments = (o.paymentSummary?.payments ?? [])
    .filter((p: any) => ['PAID', 'SUCCEEDED', 'COMPLETED'].includes(p.paymentStatus ?? 'PAID'))
    .map((p: any, i: number) => ({ id: p.paymentReferenceId ?? `${o.orderId}-pay-${i}`, amount: val(p.amount), date: p.paymentDate ?? o.creationDate }));
  return {
    externalId: o.orderId,
    orderNumber: o.orderId,
    createdAt: o.creationDate,
    updatedAt: o.lastModifiedDate ?? o.creationDate,
    currency: ps.total?.currency ?? 'EUR',
    pricesIncludeTax: opts.pricesIncludeTax ?? true,
    customer: { name: shipTo?.fullName ?? o.buyer?.username ?? null, email: shipTo?.email ?? null, phone: shipTo?.primaryPhone?.phoneNumber ?? null, city: shipTo?.contactAddress?.city ?? null, country: shipTo?.contactAddress?.countryCode ?? null },
    lines,
    shippingCharged: val(ps.deliveryCost),
    orderDiscount: D(val(ps.priceDiscount)).abs().minus(lines.reduce((a: any, l: any) => a.plus(D(l.discount)), D(0))).clampedTo(0, Infinity).toFixed(2),
    taxTotal: val(ps.tax),
    total: val(ps.total),
    paymentMethod: 'marketplace',
    payments: o.orderPaymentStatus === 'PENDING' || o.orderPaymentStatus === 'FAILED' ? [] : payments,
    refunds: (o.paymentSummary?.refunds ?? []).filter((r: any) => r.refundStatus !== 'FAILED').map((r: any, i: number) => ({ id: r.refundId ?? `${o.orderId}-refund-${i}`, amount: val(r.amount), date: r.refundDate ?? o.lastModifiedDate, restock: [] })),
    fulfillment: fulfilled ? (opts.fulfilledMeansDelivered === false ? 'shipped' : 'delivered') : 'unfulfilled',
    shippedAt: fulfilled ? o.lastModifiedDate : null,
    deliveredAt: fulfilled && opts.fulfilledMeansDelivered !== false ? o.lastModifiedDate : null,
    trackingNumber: null,
    carrier: null,
    cancelled,
    cancelledAt: cancelled ? (o.cancelStatus?.cancelledDate ?? o.lastModifiedDate) : null,
    marketplaceFee: o.totalMarketplaceFee ? val(o.totalMarketplaceFee) : null,
  };
}

export class EbayClient implements ProviderClient<EbayCredentials> {
  private changed = false;
  constructor(private creds: EbayCredentials, private opts: { pricesIncludeTax?: boolean; fulfilledMeansDelivered?: boolean } = {}) {}
  credentials() { return this.creds; }
  credentialsChanged() { return this.changed; }

  private async token() {
    const c = this.creds;
    if (c.access_token && c.expires_at && c.expires_at - Date.now() > 5 * 60_000) return c.access_token;
    if (!c.refresh_token) throw new IntegrationError('eBay is not connected yet. Click “Connect eBay account”.');
    const r = await requestJson<any>(`${hosts(c.environment).api}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh_token, scope: EBAY_SCOPES.join(' ') }),
      label: 'eBay auth',
    });
    this.creds = { ...c, access_token: r.access_token, expires_at: Date.now() + Number(r.expires_in) * 1000 };
    this.changed = true;
    return r.access_token as string;
  }

  private async get(path: string) {
    return requestJson<any>(`${hosts(this.creds.environment).api}${path}`, { headers: { authorization: `Bearer ${await this.token()}`, accept: 'application/json' }, label: 'eBay' });
  }

  async test() {
    const r = await this.get('/sell/fulfillment/v1/order?limit=1');
    return `eBay ${this.creds.environment} (${r.total ?? 0} orders visible)`;
  }

  async listOrders(since: string, pageToken: string | null): Promise<FetchPage> {
    const offset = Number(pageToken ?? 0);
    const filter = encodeURIComponent(`lastmodifieddate:[${new Date(since).toISOString()}..]`);
    const r = await this.get(`/sell/fulfillment/v1/order?filter=${filter}&limit=100&offset=${offset}`);
    const orders = (r.orders ?? []).map((o: any) => normalizeEbayOrder(o, this.opts));
    return { orders, nextCursor: offset + orders.length < Number(r.total ?? 0) && orders.length ? String(offset + orders.length) : null };
  }

  async getOrder(id: string) {
    try {
      return normalizeEbayOrder(await this.get(`/sell/fulfillment/v1/order/${encodeURIComponent(id)}`), this.opts);
    } catch (e: any) {
      if (e?.status === 404) return null;
      throw e;
    }
  }
}

export function ebayAuthorizeUrl(c: EbayCredentials, state: string) {
  const u = new URL(`${hosts(c.environment).auth}/oauth2/authorize`);
  u.searchParams.set('client_id', c.client_id);
  u.searchParams.set('redirect_uri', c.ru_name);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', EBAY_SCOPES.join(' '));
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeEbayCode(c: EbayCredentials, code: string): Promise<EbayCredentials> {
  const r = await requestJson<any>(`${hosts(c.environment).api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: c.ru_name }),
    label: 'eBay auth',
  });
  return { ...c, access_token: r.access_token, expires_at: Date.now() + Number(r.expires_in) * 1000, refresh_token: r.refresh_token, refresh_expires_at: r.refresh_token_expires_in ? Date.now() + Number(r.refresh_token_expires_in) * 1000 : undefined };
}
