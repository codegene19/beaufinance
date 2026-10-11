import { Tx } from '../db/tenant';
import { D } from '../calc/money';
import { listOrders } from './sales';
import { listPurchaseOrders, supplierBalances } from './purchasing';
import { listExpenses } from './expenses';
import { listMovements, listLots, stockByVariant } from './inventory';
import { marketingAnalysis } from './marketing';
import { productProfitability, profitAndLoss, listCashTransactions, pricingInputsFor, bucketKey } from './finance';
import { reorderPlan } from './reorder';
import { priceScenarios, evaluatePrice, toExVat } from '../calc/pricing';
import { categoryLabel, treatmentLabel, cashCategoryLabel } from '../constants';

export type ColType = 'text' | 'money' | 'number' | 'pct' | 'date';
export interface Report { key: string; title: string; description: string; columns: { key: string; label: string; type?: ColType }[]; rows: Record<string, unknown>[] }
export interface ReportFilters { from?: string | null; to?: string | null; variantId?: string | null; supplierId?: string | null; shipmentId?: string | null; channelId?: string | null; campaignId?: string | null }

export const REPORTS = [
  { key: 'product-performance', title: 'Product performance', description: 'Units, net revenue, COGS, advertising and contribution per product.' },
  { key: 'sales', title: 'Sales history', description: 'Every order with status, payment and net amounts.' },
  { key: 'purchase-orders', title: 'Purchase orders', description: 'Committed, paid and outstanding per order.' },
  { key: 'shipment-costs', title: 'Shipment costs', description: 'All import-related costs by shipment and treatment.' },
  { key: 'landed-costs', title: 'Landed cost per product', description: 'Per received lot: landed total, sellable units and unit cost.' },
  { key: 'inventory-movements', title: 'Inventory movements', description: 'Audit trail of stock movements.' },
  { key: 'stock-valuation', title: 'Stock valuation', description: 'Units on hand × batch landed cost.' },
  { key: 'supplier-balances', title: 'Supplier balances', description: 'Committed, paid and outstanding per supplier.' },
  { key: 'expenses', title: 'Expense breakdown', description: 'Every expense with treatment, payment status and base amounts.' },
  { key: 'marketing', title: 'Marketing performance', description: 'Spend, attributed orders, CPA, ROAS and profit after ads.' },
  { key: 'cash-flow', title: 'Cash flow', description: 'All cash movements in and out.' },
  { key: 'pnl-monthly', title: 'Monthly profit & loss', description: 'P&L lines by month.' },
  { key: 'pricing', title: 'Product pricing scenarios', description: 'Break-even, minimum, target and premium prices per product.' },
  { key: 'reorder', title: 'Reorder planning', description: 'Velocity, stockout date, suggested quantity and cash needed.' },
  { key: 'returns', title: 'Returns & refunds', description: 'Returns with refunds and condition.' },
] as const;

const n = (v: unknown) => (v === null || v === undefined ? null : D(String(v)).toDecimalPlaces(2).toNumber());

export async function buildReport(tx: Tx, key: string, f: ReportFilters): Promise<Report> {
  const meta = REPORTS.find((r) => r.key === key);
  if (!meta) throw new Error('Unknown report');
  const base = { key, title: meta.title, description: meta.description };
  switch (key) {
    case 'product-performance': {
      const p = await productProfitability(tx, f);
      return { ...base, columns: [{ key: 'sku', label: 'SKU' }, { key: 'product', label: 'Product' }, { key: 'units', label: 'Units sold', type: 'number' }, { key: 'returned', label: 'Units returned', type: 'number' }, { key: 'revenue', label: 'Net revenue', type: 'money' }, { key: 'cogs', label: 'COGS', type: 'money' }, { key: 'variable', label: 'Variable selling costs', type: 'money' }, { key: 'ads', label: 'Allocated advertising', type: 'money' }, { key: 'contribution', label: 'Contribution after ads', type: 'money' }, { key: 'margin', label: 'Margin %', type: 'pct' }, { key: 'class', label: 'Assessment' }],
        rows: p.rows.filter((r) => !f.variantId || r.variant.id === f.variantId).map((r) => ({ sku: r.variant.sku, product: `${r.variant.product_name} — ${r.variant.variant_name}`, units: r.unitsSold, returned: r.unitsReturned, revenue: n(r.netRevenue), cogs: n(r.cogs), variable: n(r.variableCosts), ads: n(r.advertising), contribution: n(r.contributionAfterAds), margin: n(r.marginPct), class: r.classification })) };
    }
    case 'sales': {
      const rows = await listOrders(tx, { from: f.from ?? undefined, to: f.to ?? undefined, channelId: f.channelId ?? undefined, campaignId: f.campaignId ?? undefined, variantId: f.variantId ?? undefined, limit: 100000 });
      return { ...base, columns: [{ key: 'order', label: 'Order' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'customer', label: 'Customer' }, { key: 'channel', label: 'Channel' }, { key: 'campaign', label: 'Campaign' }, { key: 'status', label: 'Status' }, { key: 'payment_status', label: 'Payment' }, { key: 'method', label: 'Method' }, { key: 'units', label: 'Units', type: 'number' }, { key: 'total', label: 'Total incl. VAT (order ccy)', type: 'money' }, { key: 'net', label: 'Net excl. VAT (base)', type: 'money' }, { key: 'recognized', label: 'Recognised on', type: 'date' }],
        rows: rows.map((o) => ({ order: o.order_number, date: o.order_date, customer: o.customer_name, channel: o.channel_name, campaign: o.campaign_name, status: o.status, payment_status: o.payment_status, method: o.payment_method, units: o.units, total: n(o.total_incl_tax), net: n(D(o.gross_merch_base).minus(D(o.discounts_base)).plus(D(o.shipping_revenue_base)).minus(D(o.refunds_base))), recognized: o.recognized_date })) };
    }
    case 'purchase-orders': {
      const rows = await listPurchaseOrders(tx, { supplierId: f.supplierId ?? undefined, from: f.from ?? undefined, to: f.to ?? undefined });
      return { ...base, columns: [{ key: 'po', label: 'PO' }, { key: 'supplier', label: 'Supplier' }, { key: 'date', label: 'Order date', type: 'date' }, { key: 'status', label: 'Status' }, { key: 'currency', label: 'Currency' }, { key: 'fx', label: 'Accounting rate', type: 'number' }, { key: 'subtotal', label: 'Total (PO ccy)', type: 'money' }, { key: 'paid', label: 'Paid (PO ccy)', type: 'money' }, { key: 'outstanding', label: 'Outstanding (PO ccy)', type: 'money' }, { key: 'subtotal_base', label: 'Committed (base)', type: 'money' }, { key: 'paid_base', label: 'Paid (base)', type: 'money' }, { key: 'units', label: 'Units ordered', type: 'number' }, { key: 'sellable', label: 'Units sellable', type: 'number' }],
        rows: rows.map((r) => ({ po: r.po_number, supplier: r.supplier_name, date: r.order_date, status: r.status, currency: r.currency, fx: Number(r.fx_rate), subtotal: n(r.subtotal), paid: n(r.paid), outstanding: n(r.outstanding), subtotal_base: n(r.subtotal_base), paid_base: n(r.paid_base), units: r.units_ordered, sellable: r.units_sellable })) };
    }
    case 'shipment-costs':
    case 'expenses': {
      const rows = (await listExpenses(tx, { from: f.from ?? undefined, to: f.to ?? undefined, shipmentId: f.shipmentId ?? undefined, campaignId: f.campaignId ?? undefined })).filter((e) => key === 'expenses' || e.shipment_id || e.purchase_order_id);
      return { ...base, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'name', label: 'Expense' }, { key: 'category', label: 'Category' }, { key: 'treatment', label: 'Treatment' }, { key: 'link', label: 'Linked to' }, { key: 'commitment', label: 'Commitment' }, { key: 'state', label: 'Payment' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'currency', label: 'Currency' }, { key: 'fx', label: 'Rate', type: 'number' }, { key: 'base', label: 'Amount (base)', type: 'money' }, { key: 'paid', label: 'Paid (base)', type: 'money' }],
        rows: rows.map((e) => ({ date: e.date_incurred, name: e.name, category: categoryLabel(e.category), treatment: treatmentLabel(e.treatment), link: e.shipment_ref ?? e.po_number ?? e.campaign_name ?? 'General', commitment: e.commitment, state: e.payment_state, amount: n(e.amount), currency: e.currency, fx: e.fx_rate ? Number(e.fx_rate) : null, base: n(e.amount_base), paid: n(e.paid_base) })) };
    }
    case 'landed-costs': {
      const lots = await listLots(tx, { variantId: f.variantId ?? undefined });
      const full = await tx.many('select id, landed_cost_total, cost_breakdown from inventory_lots where business_id = $1', [tx.businessId]);
      return { ...base, columns: [{ key: 'lot', label: 'Lot' }, { key: 'sku', label: 'SKU' }, { key: 'product', label: 'Product' }, { key: 'po', label: 'PO' }, { key: 'shipment', label: 'Shipment' }, { key: 'received', label: 'Received', type: 'date' }, { key: 'sellable', label: 'Sellable units', type: 'number' }, { key: 'purchase', label: 'Purchase cost', type: 'money' }, { key: 'import', label: 'Import & other costs', type: 'money' }, { key: 'total', label: 'Landed total', type: 'money' }, { key: 'unit', label: 'Landed / unit', type: 'money' }],
        rows: lots.map((l) => { const x = full.find((y) => y.id === l.lot_id); const purchase = D(x?.cost_breakdown?.purchase ?? x?.cost_breakdown?.opening_stock ?? 0); return { lot: l.lot_code, sku: l.sku, product: l.product_name, po: l.po_number, shipment: l.shipment_ref, received: l.received_date, sellable: l.qty_sellable, purchase: n(purchase), import: n(D(l.landed_cost_total).minus(purchase)), total: n(l.landed_cost_total), unit: D(l.landed_unit_cost).toDecimalPlaces(4).toNumber() }; }) };
    }
    case 'inventory-movements': {
      const rows = await listMovements(tx, { variantId: f.variantId ?? undefined, from: f.from ?? undefined, to: f.to ?? undefined, limit: 100000 });
      return { ...base, columns: [{ key: 'at', label: 'Timestamp' }, { key: 'sku', label: 'SKU' }, { key: 'lot', label: 'Lot' }, { key: 'type', label: 'Type' }, { key: 'qty', label: 'Quantity', type: 'number' }, { key: 'value', label: 'Value at landed cost', type: 'money' }, { key: 'ref', label: 'Reference' }, { key: 'reason', label: 'Reason' }, { key: 'user', label: 'User' }],
        rows: rows.map((m) => ({ at: m.created_at, sku: m.sku, lot: m.lot_code, type: m.movement_type, qty: m.quantity, value: n(D(m.landed_unit_cost).times(m.quantity)), ref: m.order_number ?? m.reference_type, reason: m.reason, user: m.created_by })) };
    }
    case 'stock-valuation': {
      const rows = await stockByVariant(tx);
      return { ...base, columns: [{ key: 'sku', label: 'SKU' }, { key: 'product', label: 'Product' }, { key: 'on_hand', label: 'On hand', type: 'number' }, { key: 'reserved', label: 'Reserved', type: 'number' }, { key: 'available', label: 'Available', type: 'number' }, { key: 'value', label: 'Value (landed)', type: 'money' }, { key: 'avg', label: 'Avg. cost / unit', type: 'money' }, { key: 'expiry', label: 'Next expiry', type: 'date' }],
        rows: rows.map((s) => ({ sku: s.sku, product: `${s.product_name} — ${s.variant_name}`, on_hand: s.on_hand, reserved: s.reserved, available: s.available, value: n(s.stock_value), avg: s.on_hand > 0 ? D(s.stock_value).div(s.on_hand).toDecimalPlaces(4).toNumber() : null, expiry: s.next_expiry })) };
    }
    case 'supplier-balances': {
      const rows = await supplierBalances(tx);
      return { ...base, columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'committed', label: 'Committed (base)', type: 'money' }, { key: 'paid', label: 'Paid (base)', type: 'money' }, { key: 'outstanding', label: 'Outstanding (base)', type: 'money' }, { key: 'open', label: 'Open orders', type: 'number' }],
        rows: rows.filter((r) => !f.supplierId || r.id === f.supplierId).map((r) => ({ supplier: r.name, committed: n(r.committed_base), paid: n(r.paid_base), outstanding: n(r.outstanding_base), open: r.open_orders })) };
    }
    case 'marketing': {
      const m = await marketingAnalysis(tx, f);
      return { ...base, columns: [{ key: 'campaign', label: 'Campaign' }, { key: 'channel', label: 'Channel' }, { key: 'budget', label: 'Planned budget', type: 'money' }, { key: 'spend', label: 'Actual spend', type: 'money' }, { key: 'orders', label: 'Attributed orders', type: 'number' }, { key: 'delivered', label: 'Delivered orders', type: 'number' }, { key: 'revenue', label: 'Attributed net revenue', type: 'money' }, { key: 'cpa', label: 'CPA', type: 'money' }, { key: 'dcpa', label: 'Delivered CPA', type: 'money' }, { key: 'roas', label: 'ROAS', type: 'number' }, { key: 'profit', label: 'Est. profit after ads', type: 'money' }, { key: 'unallocated', label: 'Unallocated spend', type: 'money' }],
        rows: m.campaigns.filter((c) => !f.campaignId || c.id === f.campaignId).map((c) => ({ campaign: c.name, channel: c.channel, budget: n(c.planned_budget), spend: n(c.spend), orders: c.orders, delivered: c.deliveredOrders, revenue: n(c.revenue), cpa: n(c.cpa), dcpa: n(c.deliveredCpa), roas: c.roas ? c.roas.toDecimalPlaces(2).toNumber() : null, profit: n(c.profitAfterAds), unallocated: n(c.unallocated) })) };
    }
    case 'cash-flow': {
      const rows = await listCashTransactions(tx, { from: f.from ?? undefined, to: f.to ?? undefined, limit: 100000 });
      return { ...base, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' }, { key: 'account', label: 'Account' }, { key: 'in', label: 'In (base)', type: 'money' }, { key: 'out', label: 'Out (base)', type: 'money' }, { key: 'amount', label: 'Original amount', type: 'money' }, { key: 'currency', label: 'Currency' }, { key: 'fx', label: 'Rate', type: 'number' }],
        rows: rows.map((c) => ({ date: c.txn_date, category: cashCategoryLabel(c.category), description: c.description, account: c.account, in: c.direction === 'in' ? n(c.amount_base) : null, out: c.direction === 'out' ? n(c.amount_base) : null, amount: n(c.amount), currency: c.currency, fx: Number(c.fx_rate) })) };
    }
    case 'pnl-monthly': {
      const first = await tx.one<{ d: string | null }>(`select least((select min(order_date) from sales_orders where business_id = $1), (select min(date_incurred) from expenses where business_id = $1))::text as d`, [tx.businessId]);
      const start = f.from ?? first.d ?? new Date().toISOString().slice(0, 10);
      const end = f.to ?? new Date().toISOString().slice(0, 10);
      const months: string[] = [];
      for (let d = new Date(`${start.slice(0, 7)}-01T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
      const rows = [];
      for (const m of months) {
        const from = `${m}-01`;
        const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
        const p = await profitAndLoss(tx, { from, to: last });
        rows.push({ month: m, gross: n(p.grossSales), discounts: n(p.discounts), refunds: n(p.refunds), net: n(p.netSales), cogs: n(p.cogs), gp: n(p.grossProfit), fulfil: n(p.fulfilment.plus(p.sellingFees).plus(p.perOrderExpenses).plus(p.failedDeliveries)), ads: n(p.marketing), opex: n(p.operating.plus(p.startup).plus(p.inventoryLosses)), nop: n(p.netOperatingProfit), vat: n(p.tax.vatCollected) });
      }
      void bucketKey;
      return { ...base, columns: [{ key: 'month', label: 'Month' }, { key: 'gross', label: 'Gross sales', type: 'money' }, { key: 'discounts', label: 'Discounts', type: 'money' }, { key: 'refunds', label: 'Refunds', type: 'money' }, { key: 'net', label: 'Net sales', type: 'money' }, { key: 'cogs', label: 'COGS', type: 'money' }, { key: 'gp', label: 'Gross profit', type: 'money' }, { key: 'fulfil', label: 'Fulfilment & payment costs', type: 'money' }, { key: 'ads', label: 'Advertising', type: 'money' }, { key: 'opex', label: 'Operating, startup & losses', type: 'money' }, { key: 'nop', label: 'Net operating profit', type: 'money' }, { key: 'vat', label: 'Output VAT (info)', type: 'money' }], rows };
    }
    case 'pricing': {
      const p = await productProfitability(tx, {});
      const s = p.settings;
      return { ...base, columns: [{ key: 'sku', label: 'SKU' }, { key: 'product', label: 'Product' }, { key: 'landed', label: 'Landed cost', type: 'money' }, { key: 'current', label: 'Current price incl. VAT', type: 'money' }, { key: 'current_margin', label: 'Current margin % (before ads)', type: 'pct' }, { key: 'be', label: 'Break-even incl. VAT', type: 'money' }, { key: 'min', label: `Minimum (${Number(s.min_acceptable_margin_pct)}%) incl. VAT`, type: 'money' }, { key: 'target', label: 'Target incl. VAT', type: 'money' }, { key: 'premium', label: 'Premium incl. VAT', type: 'money' }],
        rows: p.rows.filter((r) => r.variant.current_landed_cost).map((r) => {
          const inp = pricingInputsFor(r.variant, s, p.vatRate);
          const sc = priceScenarios(inp, s.min_acceptable_margin_pct, r.targetMarginPct, s.premium_margin_uplift_pct);
          const v = D(p.vatRate).div(100).plus(1);
          const inc = (x: any) => (x ? x.times(v).toDecimalPlaces(2).toNumber() : null);
          const cur = r.variant.default_selling_price ? evaluatePrice(inp, toExVat(r.variant.default_selling_price, r.variant.selling_price_includes_tax, p.vatRate)) : null;
          return { sku: r.variant.sku, product: `${r.variant.product_name} — ${r.variant.variant_name}`, landed: D(r.variant.current_landed_cost).toDecimalPlaces(4).toNumber(), current: cur ? n(cur.priceInclVat) : null, current_margin: cur ? n(cur.marginPct) : null, be: inc(sc.breakEvenExVat), min: inc(sc.minimum), target: inc(sc.target), premium: inc(sc.premium) };
        }) };
    }
    case 'reorder': {
      const r = await reorderPlan(tx);
      return { ...base, columns: [{ key: 'sku', label: 'SKU' }, { key: 'status', label: 'Status' }, { key: 'velocity', label: 'Avg daily sales', type: 'number' }, { key: 'available', label: 'Available', type: 'number' }, { key: 'incoming', label: 'Incoming', type: 'number' }, { key: 'rop', label: 'Reorder point', type: 'number' }, { key: 'stockout', label: 'Stockout date', type: 'date' }, { key: 'order_by', label: 'Latest order date', type: 'date' }, { key: 'qty', label: 'Suggested qty', type: 'number' }, { key: 'cost', label: 'Projected landed cost', type: 'money' }, { key: 'affordable', label: 'Affordable' }, { key: 'reason', label: 'Reason' }],
        rows: r.results.map((x) => ({ sku: x.variant.sku, status: x.result.status, velocity: x.result.avgDailySales.toDecimalPlaces(2).toNumber(), available: x.result.available, incoming: x.result.incomingTotal, rop: x.result.reorderPoint, stockout: x.result.stockoutDate, order_by: x.result.latestOrderDate, qty: x.result.suggestedQty, cost: n(x.result.cost.totalLanded), affordable: x.result.cash.affordable === null ? 'unknown' : x.result.cash.affordable ? 'yes' : 'no', reason: x.result.reasons.join(' ') })) };
    }
    case 'returns': {
      const rows = await tx.many(
        `select r.return_date, o.order_number, r.reason, r.refund_amount, o.currency, r.return_shipping_cost, string_agg(v.sku || ' x' || ri.quantity || ' (' || ri.condition || ')', ', ') as items
           from returns r join sales_orders o on o.id = r.order_id left join return_items ri on ri.return_id = r.id left join sales_order_items si on si.id = ri.order_item_id left join product_variants v on v.id = si.variant_id
          where r.business_id = $1 and ($2::date is null or r.return_date >= $2) and ($3::date is null or r.return_date <= $3) group by r.id, o.order_number, o.currency order by r.return_date desc`,
        [tx.businessId, f.from ?? null, f.to ?? null],
      );
      const refunds = await tx.many(`select p.payment_date, o.order_number, p.amount, o.currency, p.return_id from order_payments p join sales_orders o on o.id = p.order_id where p.business_id = $1 and p.kind = 'refund' and p.return_id is null and ($2::date is null or p.payment_date >= $2) and ($3::date is null or p.payment_date <= $3)`, [tx.businessId, f.from ?? null, f.to ?? null]);
      return { ...base, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'order', label: 'Order' }, { key: 'type', label: 'Type' }, { key: 'items', label: 'Items' }, { key: 'reason', label: 'Reason' }, { key: 'refund', label: 'Refund (order ccy)', type: 'money' }, { key: 'ship', label: 'Return shipping (base)', type: 'money' }],
        rows: [...rows.map((r) => ({ date: r.return_date, order: r.order_number, type: 'Return', items: r.items, reason: r.reason, refund: n(r.refund_amount), ship: n(r.return_shipping_cost) })), ...refunds.map((r) => ({ date: r.payment_date, order: r.order_number, type: 'Refund without return', items: '', reason: '', refund: n(r.amount), ship: null }))] };
    }
  }
  throw new Error('Unknown report');
}
