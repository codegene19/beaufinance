import { requestJson, money } from '../http';
import { hmacBase64, safeEqual } from '../crypto';
import { IntegrationError, type ExternalOrder, type FetchPage, type ProviderClient } from '../types';
import { D } from '../../calc/money';

export interface WooCredentials {
  base_url: string; // https://shop.example.com
  consumer_key: string;
  consumer_secret: string;
  webhook_secret?: string;
  query_auth?: boolean; // some hosts strip the Authorization header
}

export function normalizeWooUrl(input: string) {
  let u: URL;
  try {
    u = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new IntegrationError('Enter your store URL, e.g. https://shop.example.com');
  }
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new IntegrationError('WooCommerce must be reached over HTTPS so your API keys are never sent in clear text.');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

const wooPayment = (m: string): ExternalOrder['paymentMethod'] => (m === 'cod' ? 'cod' : m.includes('paypal') ? 'paypal' : m === 'bacs' ? 'bank_transfer' : m === 'cheque' ? 'other' : 'card');
const gmt = (d: string | null | undefined) => (d ? `${d.replace(/Z$/, '')}Z` : null);

/**
 * WooCommerce stores line subtotals/totals EXCLUDING tax, so the order is imported with
 * tax-exclusive prices: unit price = subtotal / qty, line discount = subtotal − total.
 */
export function normalizeWooOrder(o: any, refunds: any[] = [], opts: { fulfilledMeansDelivered?: boolean } = {}): ExternalOrder {
  const lines = (o.line_items ?? []).map((l: any) => {
    const qty = Number(l.quantity);
    const subtotal = D(money(l.subtotal));
    return { externalLineId: String(l.id), sku: l.sku || null, title: l.name, quantity: qty, unitPrice: qty ? subtotal.div(qty).toDecimalPlaces(4).toString() : '0', discount: subtotal.minus(D(money(l.total))).toFixed(2) };
  });
  const status: string = o.status;
  const completed = status === 'completed' || (status === 'refunded' && !!o.date_completed_gmt);
  const paidAt = gmt(o.date_paid_gmt);
  // Paid when Woo recorded a payment date (COD orders get one when marked completed)
  const paid = !!paidAt && !['pending', 'failed', 'cancelled'].includes(status);
  return {
    externalId: String(o.id),
    orderNumber: String(o.number ?? o.id),
    createdAt: gmt(o.date_created_gmt)!,
    updatedAt: gmt(o.date_modified_gmt) ?? gmt(o.date_created_gmt)!,
    currency: o.currency,
    pricesIncludeTax: false,
    customer: { name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ') || null, email: o.billing?.email || null, phone: o.billing?.phone || null, city: o.shipping?.city || o.billing?.city || null, country: o.shipping?.country || o.billing?.country || null },
    lines,
    shippingCharged: money(o.shipping_total),
    orderDiscount: '0', // Woo allocates coupons to line totals
    taxTotal: money(o.total_tax),
    total: money(o.total),
    paymentMethod: wooPayment(o.payment_method ?? ''),
    payments: paid ? [{ id: `woo-payment-${o.id}`, amount: money(o.total), date: paidAt ?? gmt(o.date_completed_gmt) ?? gmt(o.date_modified_gmt)! }] : [],
    refunds: refunds.map((r: any) => ({
      id: String(r.id),
      amount: D(money(r.amount)).abs().toFixed(2),
      date: gmt(r.date_created_gmt)!,
      restock: (r.line_items ?? []).filter((x: any) => Number(x.quantity) !== 0).map((x: any) => ({ sku: x.sku || null, quantity: Math.abs(Number(x.quantity)) })),
    })),
    fulfillment: completed ? (opts.fulfilledMeansDelivered === false ? 'shipped' : 'delivered') : 'unfulfilled',
    shippedAt: gmt(o.date_completed_gmt),
    deliveredAt: completed && opts.fulfilledMeansDelivered !== false ? gmt(o.date_completed_gmt) : null,
    trackingNumber: null,
    carrier: o.shipping_lines?.[0]?.method_title ?? null,
    cancelled: ['cancelled', 'failed'].includes(status),
    cancelledAt: ['cancelled', 'failed'].includes(status) ? gmt(o.date_modified_gmt) : null,
    marketplaceFee: null,
  };
}

export class WooClient implements ProviderClient<WooCredentials> {
  constructor(private creds: WooCredentials, private opts: { fulfilledMeansDelivered?: boolean } = {}) {}
  credentials() { return this.creds; }
  credentialsChanged() { return false; }

  private url(path: string, params: Record<string, string | number> = {}) {
    const u = new URL(`${this.creds.base_url}/wp-json/wc/v3${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    if (this.creds.query_auth) {
      u.searchParams.set('consumer_key', this.creds.consumer_key);
      u.searchParams.set('consumer_secret', this.creds.consumer_secret);
    }
    return u.toString();
  }
  private headers(): Record<string, string> {
    return this.creds.query_auth ? { accept: 'application/json' } : { accept: 'application/json', authorization: `Basic ${Buffer.from(`${this.creds.consumer_key}:${this.creds.consumer_secret}`).toString('base64')}` };
  }
  get<T = any>(path: string, params: Record<string, string | number> = {}) {
    return requestJson<T>(this.url(path, params), { headers: this.headers(), label: 'WooCommerce' });
  }

  async test() {
    const orders = await this.get<any[]>('/orders', { per_page: 1 });
    return `${new URL(this.creds.base_url).host} (${Array.isArray(orders) ? 'orders readable' : 'connected'})`;
  }

  private async withRefunds(o: any) {
    const refunds = o.refunds?.length ? await this.get<any[]>(`/orders/${o.id}/refunds`) : [];
    return normalizeWooOrder(o, refunds, this.opts);
  }

  async listOrders(since: string, pageToken: string | null): Promise<FetchPage> {
    const page = Number(pageToken ?? 1);
    const rows = await this.get<any[]>('/orders', { modified_after: since.replace(/\.\d+Z$/, ''), dates_are_gmt: 'true', per_page: 50, page, orderby: 'modified', order: 'asc' });
    const orders = [];
    for (const o of rows) orders.push(await this.withRefunds(o));
    return { orders, nextCursor: rows.length === 50 ? String(page + 1) : null };
  }

  async getOrder(id: string) {
    try {
      return await this.withRefunds(await this.get(`/orders/${id}`));
    } catch (e: any) {
      if (e?.status === 404) return null;
      throw e;
    }
  }

  /** Creates order webhooks pointing at our endpoint, signed with our generated secret. */
  async registerWebhooks(deliveryUrl: string, secret: string) {
    const out: string[] = [];
    for (const topic of ['order.created', 'order.updated']) {
      const u = this.url('/webhooks');
      await requestJson(u, { method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json' }, body: JSON.stringify({ name: `BeauFinance ${topic}`, topic, delivery_url: deliveryUrl, secret, status: 'active' }), label: 'WooCommerce' });
      out.push(`${topic}: subscribed`);
    }
    return out;
  }
}

export function verifyWooWebhook(rawBody: string, headers: Headers, c: WooCredentials) {
  return !!c.webhook_secret && safeEqual(hmacBase64(c.webhook_secret, rawBody), headers.get('x-wc-webhook-signature'));
}

export function wooWebhookRef(body: any, headers: Headers) {
  return { topic: headers.get('x-wc-webhook-topic') ?? '', dedupe: headers.get('x-wc-webhook-delivery-id') ? `${headers.get('x-wc-webhook-delivery-id')}:${body?.date_modified_gmt ?? ''}` : null, orderId: body?.id ? String(body.id) : null };
}
