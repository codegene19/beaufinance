import { beforeAll, describe, expect, it } from 'vitest';
import { D } from '@/lib/calc/money';
import { setupTestDb, createUser, createTestBusiness, as, key } from './helpers/db';
import { createSupplier } from '@/lib/services/suppliers';
import { saveProduct, listVariants } from '@/lib/services/products';
import { savePurchaseOrder, addSupplierPayment, getPurchaseOrder } from '@/lib/services/purchasing';
import { saveShipment, setShipmentItems } from '@/lib/services/shipments';
import { saveExpense, addExpensePayment, expenseTotals } from '@/lib/services/expenses';
import { receiveGoods, stockByVariant, adjustStock, listLots } from '@/lib/services/inventory';
import { createOrder, transitionOrder, addOrderPayment, createReturn, getOrder } from '@/lib/services/sales';
import { saveCampaign, marketingAnalysis } from '@/lib/services/marketing';
import { profitAndLoss, productProfitability, cashPosition, addCashTransaction, liabilities } from '@/lib/services/finance';
import { reorderPlan } from '@/lib/services/reorder';
import { listProducts } from '@/lib/services/products';
import { withUser } from '@/lib/db/tenant';
import { expenseSchema, productSchema, purchaseOrderSchema, salesOrderSchema } from '@/lib/validation/schemas';

let user: string;
let biz: string;
const ids: Record<string, string> = {};
const run = <T>(fn: Parameters<typeof as<T>>[2]) => as(user, biz, fn);

const product = (name: string, sku: string, price: string, weight: string, sell: string) =>
  productSchema.parse({
    name, status: 'active', has_expiry: true, shelf_life_days: 730, supplier_id: ids.supplier, country_of_origin: 'MA',
    variants: [{ sku, variant_name: 'Standard', supplier_unit_price: price, purchase_currency: 'MAD', default_selling_price: sell, selling_price_includes_tax: true,
      weight_kg: weight, safety_stock_qty: 10, min_order_qty: 100, order_multiple: 50, supplier_lead_days: 30, shipping_lead_days: 21 }],
  });

const expense = (o: Record<string, unknown>) =>
  expenseSchema.parse({ currency: 'EUR', fx_rate: '1', date_incurred: '2026-09-01', commitment: 'committed', manual_shares: [], ...o });

const order = (o: Record<string, unknown>) =>
  salesOrderSchema.parse({
    order_date: '2026-09-20', market_code: 'FR', currency: 'EUR', fx_rate: '1', prices_include_tax: true, tax_rate_pct: '20', shipping_charged: '0', order_discount: '0',
    payment_method: 'card', shipping_cost: '5.50', fulfillment_cost: '0', packaging_cost: '0', payment_fee: '0', platform_fee: '0', initial_status: 'confirmed', ...o,
  });

beforeAll(async () => {
  await setupTestDb();
  user = await createUser('owner@test.local');
  biz = await createTestBusiness(user);
});

describe('full lifecycle with exact expected results', () => {
  it('1. creates a supplier and products', async () => {
    ids.supplier = await run((tx) => createSupplier(tx, { name: 'Atlas Naturals', country: 'MA', currency: 'MAD', default_deposit_pct: '30', contact_name: null, email: null, phone: null, address: null, payment_terms: '30% deposit', lead_time_days: 30, min_order_qty: 100, notes: null }));
    ids.argan = await run((tx) => saveProduct(tx, product('Argan Oil 50ml', 'ARG-50', '60', '0.15', '24.00')));
    ids.clay = await run((tx) => saveProduct(tx, product('Rhassoul Clay 200g', 'RHA-200', '30', '0.25', '15.00')));
    const vs = await run((tx) => listVariants(tx));
    ids.vArgan = vs.find((v) => v.sku === 'ARG-50')!.id;
    ids.vClay = vs.find((v) => v.sku === 'RHA-200')!.id;
    expect(vs).toHaveLength(2);
  });

  it('2-3. creates a multi-product PO and records multiple partial payments', async () => {
    ids.po = await run((tx) =>
      savePurchaseOrder(tx, purchaseOrderSchema.parse({ po_number: 'PO-T-1', supplier_id: ids.supplier, order_date: '2026-08-01', currency: 'MAD', fx_rate: '0.092', status: 'ordered', deposit_due: '3600',
        items: [{ variant_id: ids.vArgan, quantity: 100, unit_price: '60' }, { variant_id: ids.vClay, quantity: 200, unit_price: '30' }] })),
    );
    await run((tx) => addSupplierPayment(tx, ids.po, { payment_date: '2026-08-02', amount: '3600', fx_rate: '0.093', is_deposit: true, method: 'wire', reference: 'DEP', idempotency_key: 'pay-dep-1' }));
    await run((tx) => addSupplierPayment(tx, ids.po, { payment_date: '2026-08-20', amount: '4000', fx_rate: '0.091', is_deposit: false, method: 'wire', reference: 'P2', idempotency_key: 'pay-2-xx' }));
    // duplicate submission is rejected
    await expect(run((tx) => addSupplierPayment(tx, ids.po, { payment_date: '2026-08-20', amount: '4000', fx_rate: '0.091', is_deposit: false, method: 'wire', reference: 'P2', idempotency_key: 'pay-2-xx' }))).rejects.toThrow();
    // overpayment is rejected
    await expect(run((tx) => addSupplierPayment(tx, ids.po, { payment_date: '2026-08-21', amount: '5000', fx_rate: '0.091', is_deposit: false, method: null, reference: null, idempotency_key: key() }))).rejects.toThrow(/outstanding/);
    const { po, payments } = await run((tx) => getPurchaseOrder(tx, ids.po));
    expect(payments).toHaveLength(2);
    expect(po.subtotal).toBe('12000.00');
    expect(D(po.subtotal_base).toFixed(2)).toBe('1104.00'); // committed at accounting rate
    expect(D(po.paid_base).toFixed(2)).toBe('698.80'); // 334.80 + 364.00 actual cash
    expect(po.outstanding).toBe('4400.00');
    expect(po.status).toBe('partially_paid');
  });

  it('4. records shipping, customs and import costs before arrival', async () => {
    ids.ship = await run((tx) => saveShipment(tx, { reference: 'SH-T-1', carrier: 'DHL', mode: 'air', tracking_ref: 'X1', status: 'in_transit', dispatch_date: '2026-09-01', expected_arrival_date: '2026-09-10', actual_arrival_date: null, default_allocation_method: 'value', notes: null }));
    const lines = await run((tx) => tx.many<{ id: string; variant_id: string }>('select id, variant_id from purchase_order_items where purchase_order_id = $1', [ids.po]));
    await run((tx) => setShipmentItems(tx, ids.ship, lines.map((l) => ({ purchase_order_item_id: l.id, quantity: l.variant_id === ids.vArgan ? 100 : 200, total_weight_kg: null, total_volume_m3: null }))));
    const sh = { link_type: 'shipment', shipment_id: ids.ship, treatment: 'product_acquisition' };
    const fr = await run((tx) => saveExpense(tx, expense({ ...sh, name: 'Air freight', category: 'freight', amount: '650', allocation_method: 'weight' })));
    ids.freight = fr.id;
    await run((tx) => saveExpense(tx, expense({ ...sh, name: 'Customs duty', category: 'customs_duty', amount: '110.40', allocation_method: 'value' })));
    await run((tx) => saveExpense(tx, expense({ ...sh, name: 'Broker', category: 'broker', amount: '60', allocation_method: 'quantity' })));
    await run((tx) => saveExpense(tx, expense({ link_type: 'shipment', shipment_id: ids.ship, treatment: 'recoverable_tax', name: 'Import VAT', category: 'import_vat', amount: '242.88' })));
    await run((tx) => saveExpense(tx, expense({ ...sh, name: 'Local transport (estimate)', category: 'local_transport', amount: '50', commitment: 'planned', allocation_method: 'quantity' })));
    // stock does not increase before receipt
    const stock = await run((tx) => stockByVariant(tx));
    expect(stock.every((s) => s.on_hand === 0)).toBe(true);
    const vs = await run((tx) => listVariants(tx));
    expect(vs.find((v) => v.id === ids.vArgan)!.in_transit).toBe(100);
  });

  it('5. allocates acquisition costs and computes landed cost per sellable unit', async () => {
    const lines = await run((tx) => tx.many<{ id: string; variant_id: string }>('select id, variant_id from purchase_order_items where purchase_order_id = $1', [ids.po]));
    const sItems = await run((tx) => tx.many<{ id: string; purchase_order_item_id: string }>('select id, purchase_order_item_id from shipment_items where shipment_id = $1', [ids.ship]));
    const li = (v: string) => lines.find((l) => l.variant_id === v)!.id;
    const si = (v: string) => sItems.find((s) => s.purchase_order_item_id === li(v))!.id;
    const r = await run((tx) =>
      receiveGoods(tx, { purchase_order_id: ids.po, shipment_id: ids.ship, received_date: '2026-09-10', notes: null, idempotency_key: 'receipt-1',
        lines: [
          { purchase_order_item_id: li(ids.vArgan), shipment_item_id: si(ids.vArgan), qty_received: 100, qty_damaged: 4, qty_rejected: 0, qty_missing: 0, expiry_date: '2028-06-30', lot_code: null },
          { purchase_order_item_id: li(ids.vClay), shipment_item_id: si(ids.vClay), qty_received: 190, qty_damaged: 0, qty_rejected: 0, qty_missing: 10, expiry_date: null, lot_code: null },
        ] }),
    );
    expect(r.warnings.length).toBeGreaterThan(0);
    const lots = await run((tx) => listLots(tx));
    const a = lots.find((l) => l.variant_id === ids.vArgan)!;
    const c = lots.find((l) => l.variant_id === ids.vClay)!;
    // Argan: 552 purchase + 150 freight (15/65kg) + 55.20 duty + 20 broker = 777.20 over 96 sellable
    expect(D(a.landed_cost_total).toFixed(2)).toBe('777.20');
    expect(D(a.landed_unit_cost).toFixed(6)).toBe('8.095833');
    // Clay: 552 + 500 + 55.20 + 40 = 1147.20 over 190 sellable (10 missing absorbed)
    expect(D(c.landed_cost_total).toFixed(2)).toBe('1147.20');
    expect(D(c.landed_unit_cost).toFixed(6)).toBe('6.037895');
    expect(a.on_hand).toBe(96);
    expect(c.on_hand).toBe(190);
    // recoverable VAT and planned costs are NOT in landed cost; allocations reconcile to the source costs
    const alloc = await run((tx) => tx.one<{ s: string }>('select sum(amount_base) as s from cost_allocations where business_id = $1', [biz]));
    expect(D(alloc.s).toFixed(2)).toBe('820.40');
    const po = await run((tx) => getPurchaseOrder(tx, ids.po));
    expect(po.po.status).toBe('received');
    // receiving the same receipt twice is prevented
    await expect(run((tx) => receiveGoods(tx, { purchase_order_id: ids.po, shipment_id: ids.ship, received_date: '2026-09-10', notes: null, idempotency_key: 'receipt-1', lines: [{ purchase_order_item_id: li(ids.vArgan), shipment_item_id: null, qty_received: 1, qty_damaged: 0, qty_rejected: 0, qty_missing: 0, expiry_date: null, lot_code: null }] }))).rejects.toThrow();
  });

  it('12. separates committed, paid and outstanding amounts', async () => {
    await run((tx) => addExpensePayment(tx, ids.freight, { payment_date: '2026-09-05', amount: '400', fx_rate: '1', method: null, reference: null, idempotency_key: 'fr-pay-1' }));
    const t = await run((tx) => expenseTotals(tx));
    expect(D(t.committed_base).toFixed(2)).toBe('1063.28'); // 650 + 110.40 + 60 + 242.88
    expect(D(t.cash_spent_base).toFixed(2)).toBe('400.00');
    expect(D(t.outstanding_base).toFixed(2)).toBe('663.28');
    expect(D(t.forecast_base).toFixed(2)).toBe('50.00');
    const l = await run((tx) => liabilities(tx));
    expect(D(l.supplier).toFixed(2)).toBe('404.80'); // 4400 MAD x 0.092
  });

  it('8. records a sale with FIFO lot reservation, shipment and delivery', async () => {
    await run((tx) => addCashTransaction(tx, { txn_date: '2026-08-01', category: 'owner_contribution', amount: '5000', currency: 'EUR', fx_rate: '1', account: 'bank', description: 'Initial capital' }));
    ids.camp = await run((tx) => saveCampaign(tx, { name: 'Meta launch', channel: 'meta', start_date: '2026-09-15', end_date: null, planned_budget: '100', is_prelaunch: false, allocation_method: 'delivered_orders', sessions: 200, notes: null, products: [] }));
    await run((tx) => saveExpense(tx, expense({ name: 'Meta ads', category: 'paid_advertising', amount: '30', treatment: 'marketing', link_type: 'campaign', campaign_id: ids.camp, date_incurred: '2026-09-18' })));
    await run((tx) => saveExpense(tx, expense({ name: 'Flyers', category: 'marketing_other', amount: '20', treatment: 'marketing', date_incurred: '2026-09-18' })));
    const o = await run((tx) => createOrder(tx, order({ order_number: 'SO-1', campaign_id: ids.camp, payment_fee: '0.97', items: [{ variant_id: ids.vArgan, quantity: 2, unit_price: '24', line_discount: '0' }] })));
    ids.o1 = o.id;
    let st = await run((tx) => stockByVariant(tx));
    expect(st.find((s) => s.variant_id === ids.vArgan)!.reserved).toBe(2);
    expect(st.find((s) => s.variant_id === ids.vArgan)!.available).toBe(94);
    await run((tx) => transitionOrder(tx, ids.o1, { to: 'shipped', date: '2026-09-21' }));
    await expect(run((tx) => transitionOrder(tx, ids.o1, { to: 'shipped', date: '2026-09-21' }))).rejects.toThrow(/already/);
    await run((tx) => transitionOrder(tx, ids.o1, { to: 'delivered', date: '2026-09-23', collect_payment: true }));
    st = await run((tx) => stockByVariant(tx));
    expect(st.find((s) => s.variant_id === ids.vArgan)!.on_hand).toBe(94);
    expect(st.find((s) => s.variant_id === ids.vArgan)!.reserved).toBe(0);
    const { order: ord } = await run((tx) => getOrder(tx, ids.o1));
    expect(ord.payment_status).toBe('paid');
    expect(D(ord.cogs_shipped_base).toFixed(4)).toBe('16.1917');
  });

  it('blocks sales that would silently create negative stock', async () => {
    await expect(run((tx) => createOrder(tx, order({ order_number: 'SO-BIG', items: [{ variant_id: ids.vArgan, quantity: 500, unit_price: '24', line_discount: '0' }] })))).rejects.toThrow(/Not enough available stock/);
    const n = await run((tx) => tx.one<{ n: number }>(`select count(*)::int as n from sales_orders where order_number = 'SO-BIG'`));
    expect(n.n).toBe(0); // the whole transaction rolled back
  });

  it('9. cancellation of an undelivered COD order restores stock without revenue', async () => {
    const o = await run((tx) => createOrder(tx, order({ order_number: 'SO-2', payment_method: 'cod', items: [{ variant_id: ids.vArgan, quantity: 1, unit_price: '24', line_discount: '0' }, { variant_id: ids.vClay, quantity: 2, unit_price: '15', line_discount: '0' }] })));
    await run((tx) => transitionOrder(tx, o.id, { to: 'shipped', date: '2026-09-22' }));
    await run((tx) => transitionOrder(tx, o.id, { to: 'cancelled', date: '2026-09-28' }));
    await expect(run((tx) => transitionOrder(tx, o.id, { to: 'cancelled', date: '2026-09-28' }))).rejects.toThrow();
    const st = await run((tx) => stockByVariant(tx));
    expect(st.find((s) => s.variant_id === ids.vArgan)!.on_hand).toBe(94);
    expect(st.find((s) => s.variant_id === ids.vClay)!.on_hand).toBe(190);
  });

  it('9. return with refund restocks resellable units exactly once', async () => {
    const o = await run((tx) => createOrder(tx, order({ order_number: 'SO-3', items: [{ variant_id: ids.vClay, quantity: 3, unit_price: '15', line_discount: '0' }] })));
    ids.o3 = o.id;
    await run((tx) => transitionOrder(tx, o.id, { to: 'shipped', date: '2026-09-22' }));
    await run((tx) => transitionOrder(tx, o.id, { to: 'delivered', date: '2026-09-24' }));
    await run((tx) => addOrderPayment(tx, o.id, { kind: 'payment', payment_date: '2026-09-24', amount: '45', method: 'card', reference: null, idempotency_key: 'so3-pay' }));
    const { items } = await run((tx) => getOrder(tx, o.id));
    const r = { return_date: '2026-09-30', reason: 'Changed mind', items: [{ order_item_id: items[0].id, quantity: 1, condition: 'resellable' as const }], refund_amount: '15', return_shipping_cost: '4', refund_now: true, idempotency_key: 'ret-so3' };
    await run((tx) => createReturn(tx, o.id, r));
    await expect(run((tx) => createReturn(tx, o.id, r))).rejects.toThrow(); // duplicate
    await expect(run((tx) => createReturn(tx, o.id, { ...r, idempotency_key: 'ret-so3-b', items: [{ ...r.items[0], quantity: 3 }] }))).rejects.toThrow(/more units/);
    const st = await run((tx) => stockByVariant(tx));
    expect(st.find((s) => s.variant_id === ids.vClay)!.on_hand).toBe(188);
    const { order: ord } = await run((tx) => getOrder(tx, o.id));
    expect(ord.payment_status).toBe('partially_refunded');
  });

  it('6-7, 10, 16. P&L, marketing allocated once, and reconciliation', async () => {
    const pnl = await run((tx) => profitAndLoss(tx, { from: '2026-09-01', to: '2026-09-30' }));
    // Recognised (delivered) orders: SO-1 (40.00 ex VAT) and SO-3 (37.50 ex VAT, refund 12.50)
    expect(pnl.grossSales.toFixed(2)).toBe('77.50');
    expect(pnl.refunds.toFixed(2)).toBe('12.50');
    expect(pnl.netSales.toFixed(2)).toBe('65.00');
    // COGS: 2 x 8.095833 + 2 x 6.037895 (3 shipped, 1 restocked)
    expect(pnl.cogs.toFixed(2)).toBe('28.27');
    expect(pnl.failedDeliveryCount).toBe(1);
    expect(pnl.failedDeliveries.toFixed(2)).toBe('5.50'); // shipping lost on the refused COD parcel
    expect(pnl.marketing.toFixed(2)).toBe('50.00');
    const mk = await run((tx) => marketingAnalysis(tx, { from: '2026-09-01', to: '2026-09-30' }));
    const c = mk.campaigns.find((x) => x.id === ids.camp)!;
    expect(c.cpa!.toFixed(2)).toBe('30.00');
    expect(c.roas!.toFixed(2)).toBe('1.33'); // 40 / 30
    const allocated = [...mk.perVariantAds.values()].reduce((a, v) => a.plus(v), D(0));
    expect(allocated.plus(mk.unallocatedTotal).toFixed(2)).toBe(mk.totalSpend.toFixed(2)); // nothing counted twice or lost
    expect(mk.perVariantAds.get(ids.vArgan)!.toFixed(2)).toBe('30.00');
    expect(mk.unallocatedTotal.toFixed(2)).toBe('20.00');
    // cash reconciles to the transactions
    const cash = await run((tx) => cashPosition(tx));
    // 5000 - 334.80 - 364.00 - 400 (freight) + 48 + 45 - 15
    expect(cash.balance.toFixed(2)).toBe('3979.20');
    expect(cash.known).toBe(true);
  });

  it('11. product profitability reacts to late costs', async () => {
    const before = await run((tx) => productProfitability(tx, { from: '2026-09-01', to: '2026-09-30' }));
    const a0 = before.rows.find((r) => r.variant.id === ids.vArgan)!;
    expect(a0.unitsSold).toBe(2);
    expect(a0.advertising.toFixed(2)).toBe('30.00');
    // A late inspection invoice for the argan line arrives after the sale
    await run((tx) => saveExpense(tx, expense({ link_type: 'shipment', shipment_id: ids.ship, treatment: 'product_acquisition', name: 'Lab inspection', category: 'inspection', amount: '48', allocation_method: 'quantity', variant_id: ids.vArgan })));
    const after = await run((tx) => productProfitability(tx, { from: '2026-09-01', to: '2026-09-30' }));
    const a1 = after.rows.find((r) => r.variant.id === ids.vArgan)!;
    expect(D(a1.variant.current_landed_cost).toFixed(4)).toBe('8.5958'); // (777.20 + 48) / 96
    expect(a1.cogs.greaterThan(a0.cogs)).toBe(true);
    expect(a1.contributionAfterAds.lessThan(a0.contributionAfterAds)).toBe(true);
  });

  it('13-14. reorder plan estimates stockout and second-order cash needs', async () => {
    const plan = await run((tx) => reorderPlan(tx, { today: '2026-09-30', overrides: { orderQty: 300 } }));
    const a = plan.results.find((r) => r.variant.id === ids.vArgan)!;
    expect(a.result.status).toBe('insufficient_data'); // very little history: honest about confidence
    expect(a.result.cost.purchase.toFixed(2)).toBe('1656.00'); // 300 x 60 MAD x 0.092
    expect(a.result.cash.known).toBe(true);
    // with a longer artificial history the engine projects a stockout date
    const plan2 = await run((tx) => reorderPlan(tx, { variantId: ids.vArgan, today: '2026-09-30', overrides: { historyDays: 7 } }));
    expect(plan2.results[0].inputs.windowDays).toBeGreaterThan(0);
  });

  it('stock adjustments are audited and cannot go below zero', async () => {
    const lot = (await run((tx) => listLots(tx, { variantId: ids.vClay })))[0];
    await run((tx) => adjustStock(tx, { lot_id: lot.lot_id, quantity: 2, movement_type: 'write_off', reason: 'Broken jars in storage', idempotency_key: 'wo-1-abc' }));
    await expect(run((tx) => adjustStock(tx, { lot_id: lot.lot_id, quantity: 10000, movement_type: 'write_off', reason: 'Too many', idempotency_key: 'wo-2-abc' }))).rejects.toThrow(/only has/);
    const audit = await run((tx) => tx.one<{ n: number }>(`select count(*)::int as n from audit_logs where table_name = 'inventory_movements' and business_id = $1`, [biz]));
    expect(audit.n).toBeGreaterThan(0);
  });

  it('18. users cannot access other businesses (database-enforced RLS)', async () => {
    const intruder = await createUser('intruder@test.local');
    await createTestBusiness(intruder, 'Other Co');
    await expect(as(intruder, biz, (tx) => listProducts(tx))).rejects.toThrow(/access/);
    // even raw queries without a business filter return nothing from another tenant
    const rows = await withUser(intruder, (q) => q.query('select * from products'));
    expect(rows).toHaveLength(0);
    const cash = await withUser(intruder, (q) => q.query('select * from cash_transactions'));
    expect(cash).toHaveLength(0);
    await expect(withUser(intruder, (q) => q.query(`update products set name = 'hacked' where business_id = $1 returning id`, [biz]))).resolves.toHaveLength(0);
  });
});
