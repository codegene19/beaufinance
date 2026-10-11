export type Provider = 'shopify' | 'woocommerce' | 'ebay' | 'tiktok';

/** Provider-independent order snapshot. Money in the order's currency, as strings (exact decimals). */
export interface ExternalOrder {
  externalId: string;
  orderNumber: string; // human number shown on the platform, e.g. "#1001"
  createdAt: string; // ISO date-time
  updatedAt: string;
  currency: string;
  pricesIncludeTax: boolean; // whether unitPrice / shipping / discounts below include tax
  test?: boolean;
  customer: { name?: string | null; email?: string | null; phone?: string | null; city?: string | null; country?: string | null };
  lines: { externalLineId: string; sku: string | null; title: string; quantity: number; unitPrice: string; discount: string }[];
  shippingCharged: string;
  orderDiscount: string; // discounts not allocated to lines
  taxTotal: string;
  total: string; // what the customer pays, incl. tax
  paymentMethod: 'card' | 'paypal' | 'cod' | 'bank_transfer' | 'cash' | 'marketplace' | 'other';
  payments: { id: string; amount: string; date: string }[]; // captured money
  refunds: { id: string; amount: string; date: string; restock: { sku: string | null; externalLineId?: string; quantity: number }[] }[];
  fulfillment: 'unfulfilled' | 'shipped' | 'delivered';
  shippedAt: string | null;
  deliveredAt: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  cancelled: boolean;
  cancelledAt: string | null;
  marketplaceFee: string | null; // actual fee when the platform reports it (eBay)
  raw?: unknown;
}

export interface ConnectionSettings {
  import_since?: string; // ISO date: first import starts here
  order_prefix?: string;
  fulfilled_means_delivered?: boolean; // platform cannot report delivery: treat fulfilled/completed as delivered
  import_unpaid?: boolean; // create unpaid orders as "pending"
  skip_test_orders?: boolean;
  prices_include_tax?: 'auto' | 'yes' | 'no';
}

export interface ConnectionRecord {
  id: string;
  business_id: string;
  provider: Provider;
  name: string;
  status: string;
  account_ref: string | null;
  channel_id: string | null;
  settings: ConnectionSettings;
  sync_cursor: string | null;
  created_by: string;
}

export interface FetchPage {
  orders: ExternalOrder[];
  nextCursor: string | null; // provider page token; null when done
}

/** Every provider implements this. Credentials are the decrypted JSON blob. */
export interface ProviderClient<C = any> {
  /** Lightweight call proving the credentials work; returns a display label (shop name). */
  test(): Promise<string>;
  /** Orders updated since `since` (ISO), page by page. */
  listOrders(since: string, pageToken: string | null): Promise<FetchPage>;
  getOrder(externalId: string): Promise<ExternalOrder | null>;
  /** Credentials may be refreshed (tokens); caller persists them when changed. */
  credentials(): C;
  credentialsChanged(): boolean;
}

export class IntegrationError extends Error {
  constructor(message: string, public readonly status?: number, public readonly retryable = false) {
    super(message);
    this.name = 'IntegrationError';
  }
}
