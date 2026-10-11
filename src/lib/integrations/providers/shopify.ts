import { requestJson, money, iso } from '../http';
import { hmacBase64, hmacHex, safeEqual } from '../crypto';
import { IntegrationError, type ExternalOrder, type FetchPage, type ProviderClient } from '../types';
import { D } from '../../calc/money';

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2026-10';
export const SHOPIFY_SCOPES = 'read_orders';

export interface ShopifyCredentials {
  shop: string; // xxx.myshopify.com
  mode: 'oauth' | 'client_credentials' | 'access_token';
  client_id?: string;
  client_secret?: string; // also the webhook signing secret for Dev Dashboard / OAuth apps
  access_token?: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  webhook_secret?: string; // legacy custom apps: "API secret key"
}

export function normalizeShopDomain(input: string) {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const domain = s.includes('.') ? s : `${s}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new IntegrationError('Enter your store’s myshopify.com domain (e.g. maison-argane.myshopify.com).');
  return domain;
}

const MONEY = 'shopMoney { amount currencyCode }';
const orderFields = (withCustomer: boolean) => `
  id legacyResourceId name createdAt updatedAt cancelledAt test taxesIncluded currencyCode
  displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
  ${withCustomer ? 'email phone customer { displayName } shippingAddress { name city countryCodeV2 }' : 'shippingAddress { city countryCodeV2 }'}
  totalDiscountsSet { ${MONEY} } totalShippingPriceSet { ${MONEY} } totalTaxSet { ${MONEY} } totalPriceSet { ${MONEY} }
  lineItems(first: 250) { nodes { id sku name quantity originalUnitPriceSet { ${MONEY} } totalDiscountSet { ${MONEY} } } }
  transactions(first: 100) { id kind status processedAt createdAt amountSet { ${MONEY} } }
  refunds(first: 50) { id createdAt totalRefundedSet { ${MONEY} } refundLineItems(first: 100) { nodes { quantity restockType lineItem { id sku } } } }
  fulfillments(first: 20) { createdAt displayStatus deliveredAt status trackingInfo(first: 1) { number company } }`;

const amt = (m: any) => money(m?.shopMoney?.amount);

/** Pure mapping from a GraphQL Order node to the standard format. */
export function normalizeShopifyOrder(o: any): ExternalOrder {
  const gateways: string[] = (o.paymentGatewayNames ?? []).map((g: string) => g.toLowerCase());
  const paymentMethod: ExternalOrder['paymentMethod'] = gateways.some((g) => g.includes('cash on delivery') || g.includes('cod') || g.includes('cash_on_delivery'))
    ? 'cod'
    : gateways.some((g) => g.includes('paypal'))
      ? 'paypal'
      : gateways.some((g) => g.includes('bank') || g.includes('manual'))
        ? 'bank_transfer'
        : 'card';
  const lines = (o.lineItems?.nodes ?? []).map((l: any) => ({
    externalLineId: l.id,
    sku: l.sku || null,
    title: l.name,
    quantity: Number(l.quantity),
    unitPrice: amt(l.originalUnitPriceSet),
    discount: amt(l.totalDiscountSet),
  }));
  const lineDisc = lines.reduce((a: any, l: any) => a.plus(D(l.discount)), D(0));
  const orderDiscount = D(amt(o.totalDiscountsSet)).minus(lineDisc);
  const fulfillments = (o.fulfillments ?? []).filter((f: any) => !['CANCELLED', 'ERROR', 'FAILURE'].includes(f.status));
  const delivered = fulfillments.find((f: any) => f.deliveredAt || f.displayStatus === 'DELIVERED');
  const fulfilled = ['FULFILLED', 'PARTIALLY_FULFILLED'].includes(o.displayFulfillmentStatus) || fulfillments.length > 0;
  const tracking = fulfillments.find((f: any) => f.trackingInfo?.[0])?.trackingInfo?.[0];
  return {
    externalId: o.id,
    orderNumber: o.name,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    currency: o.currencyCode,
    pricesIncludeTax: !!o.taxesIncluded,
    test: !!o.test,
    customer: { name: o.customer?.displayName ?? o.shippingAddress?.name ?? null, email: o.email ?? null, phone: o.phone ?? null, city: o.shippingAddress?.city ?? null, country: o.shippingAddress?.countryCodeV2 ?? null },
    lines,
    shippingCharged: amt(o.totalShippingPriceSet),
    orderDiscount: orderDiscount.greaterThan(0) ? orderDiscount.toFixed(2) : '0',
    taxTotal: amt(o.totalTaxSet),
    total: amt(o.totalPriceSet),
    paymentMethod,
    payments: (o.transactions ?? [])
      .filter((t: any) => ['SALE', 'CAPTURE'].includes(t.kind) && t.status === 'SUCCESS')
      .map((t: any) => ({ id: t.id, amount: amt(t.amountSet), date: t.processedAt ?? t.createdAt })),
    refunds: (o.refunds ?? []).map((r: any) => ({
      id: r.id,
      amount: amt(r.totalRefundedSet),
      date: r.createdAt,
      restock: (r.refundLineItems?.nodes ?? []).filter((x: any) => x.restockType === 'RETURN').map((x: any) => ({ sku: x.lineItem?.sku ?? null, externalLineId: x.lineItem?.id, quantity: Number(x.quantity) })),
    })),
    fulfillment: delivered ? 'delivered' : fulfilled ? 'shipped' : 'unfulfilled',
    shippedAt: fulfillments[0]?.createdAt ?? null,
    deliveredAt: delivered?.deliveredAt ?? null,
    trackingNumber: tracking?.number ?? null,
    carrier: tracking?.company ?? null,
    cancelled: !!o.cancelledAt,
    cancelledAt: o.cancelledAt ?? null,
    marketplaceFee: null,
  };
}

export class ShopifyClient implements ProviderClient<ShopifyCredentials> {
  private changed = false;
  private withCustomer = true;
  constructor(private creds: ShopifyCredentials) {}
  credentials() { return this.creds; }
  credentialsChanged() { return this.changed; }

  private async token(): Promise<string> {
    const c = this.creds;
    const fresh = c.access_token && (!c.expires_at || c.expires_at - Date.now() > 5 * 60_000);
    if (fresh) return c.access_token!;
    if (c.mode === 'access_token') {
      if (!c.access_token) throw new IntegrationError('No Shopify access token saved.');
      return c.access_token;
    }
    if (!c.client_id || !c.client_secret) throw new IntegrationError('Shopify client ID and secret are required.');
    const body = new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret });
    if (c.mode === 'client_credentials') body.set('grant_type', 'client_credentials');
    else if (c.refresh_token) {
      body.set('grant_type', 'refresh_token');
      body.set('refresh_token', c.refresh_token);
    } else throw new IntegrationError('This Shopify connection is not authorised yet. Click “Install on Shopify”.');
    const r = await requestJson<any>(`https://${c.shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, label: 'Shopify auth' });
    this.creds = { ...c, access_token: r.access_token, refresh_token: r.refresh_token ?? c.refresh_token, expires_at: r.expires_in ? Date.now() + Number(r.expires_in) * 1000 : undefined };
    this.changed = true;
    return r.access_token;
  }

  async graphql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await requestJson<any>(`https://${this.creds.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': await this.token() },
        body: JSON.stringify({ query, variables }),
        label: 'Shopify',
      });
      if (!r.errors?.length) return r.data as T;
      const msg = r.errors.map((e: any) => e.message).join('; ');
      if (r.errors.some((e: any) => e.extensions?.code === 'THROTTLED')) {
        await new Promise((res) => setTimeout(res, process.env.VITEST ? 1 : 1000 * (attempt + 1)));
        continue;
      }
      if (this.withCustomer && /access denied|protected customer|not approved/i.test(msg)) {
        this.withCustomer = false; // app lacks protected-customer-data access: retry without names/emails
        query = query.replace(orderFields(true), orderFields(false));
        continue;
      }
      throw new IntegrationError(`Shopify: ${msg}`);
    }
    throw new IntegrationError('Shopify is rate-limiting requests; try again shortly.', 429, true);
  }

  async test() {
    const d = await this.graphql<any>('{ shop { name myshopifyDomain currencyCode } }');
    return `${d.shop.name} (${d.shop.myshopifyDomain}, ${d.shop.currencyCode})`;
  }

  async listOrders(since: string, pageToken: string | null): Promise<FetchPage> {
    const q = `query($q: String!, $after: String) { orders(first: 50, after: $after, sortKey: UPDATED_AT, query: $q) { pageInfo { hasNextPage endCursor } nodes { ${orderFields(this.withCustomer)} } } }`;
    const d = await this.graphql<any>(q, { q: `updated_at:>='${iso(since)}'`, after: pageToken });
    return { orders: d.orders.nodes.map(normalizeShopifyOrder), nextCursor: d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null };
  }

  async getOrder(id: string) {
    const gid = id.startsWith('gid://') ? id : `gid://shopify/Order/${id}`;
    const d = await this.graphql<any>(`query($id: ID!) { order(id: $id) { ${orderFields(this.withCustomer)} } }`, { id: gid });
    return d.order ? normalizeShopifyOrder(d.order) : null;
  }

  /** Subscribes order webhooks to our endpoint (needs a public HTTPS URL). */
  async registerWebhooks(uri: string) {
    const results: string[] = [];
    for (const topic of ['ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'REFUNDS_CREATE']) {
      const d = await this.graphql<any>(
        `mutation($topic: WebhookSubscriptionTopic!, $uri: String!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri }) { userErrors { message } webhookSubscription { id } } }`,
        { topic, uri },
      );
      const errs = d.webhookSubscriptionCreate.userErrors;
      results.push(errs.length ? `${topic}: ${errs.map((e: any) => e.message).join(', ')}` : `${topic}: subscribed`);
    }
    return results;
  }
}

export function shopifyAuthorizeUrl(c: ShopifyCredentials, redirectUri: string, state: string) {
  const u = new URL(`https://${c.shop}/admin/oauth/authorize`);
  u.searchParams.set('client_id', c.client_id ?? '');
  u.searchParams.set('scope', SHOPIFY_SCOPES);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

/** Verifies the `hmac` query parameter Shopify adds to OAuth redirects. */
export function verifyShopifyOAuthQuery(params: URLSearchParams, clientSecret: string) {
  const entries = [...params.entries()].filter(([k]) => k !== 'hmac' && k !== 'signature').sort(([a], [b]) => a.localeCompare(b));
  const message = entries.map(([k, v]) => `${k}=${v}`).join('&');
  return safeEqual(hmacHex(clientSecret, message), params.get('hmac'));
}

export async function exchangeShopifyCode(c: ShopifyCredentials, code: string): Promise<ShopifyCredentials> {
  const r = await requestJson<any>(`https://${c.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, code }),
    label: 'Shopify auth',
  });
  return { ...c, access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_in ? Date.now() + Number(r.expires_in) * 1000 : undefined };
}

export function verifyShopifyWebhook(rawBody: string, headers: Headers, c: ShopifyCredentials) {
  const secret = c.webhook_secret || c.client_secret;
  return !!secret && safeEqual(hmacBase64(secret, rawBody), headers.get('x-shopify-hmac-sha256'));
}

export function shopifyWebhookRef(body: any, headers: Headers) {
  const topic = headers.get('x-shopify-topic') ?? '';
  const orderId = topic.startsWith('refunds/') ? body.order_id : body.admin_graphql_api_id ?? body.id;
  return { topic, dedupe: headers.get('x-shopify-webhook-id') ?? headers.get('x-shopify-event-id'), orderId: orderId ? String(orderId) : null };
}
