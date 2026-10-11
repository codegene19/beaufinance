import { beforeAll, describe, expect, it } from 'vitest';
import { D, sum } from '@/lib/calc/money';
import { setupTestDb, createUser, createTestBusiness, as, key } from './helpers/db';
import { createSupplier } from '@/lib/services/suppliers';
import { saveProduct, listVariants } from '@/lib/services/products';
import { savePurchaseOrder, addSupplierPayment, deleteSupplierPayment, getPurchaseOrder } from '@/lib/services/purchasing';
import { saveShipment, setShipmentItems } from '@/lib/services/shipments';
import { saveExpense, expenseTotals, deleteExpense } from '@/lib/services/expenses';
import { receiveGoods, listLots, addOpeningStock } from '@/lib/services/inventory';
import { profitAndLoss, productProfitability, cashPosition, addCashTransaction } from '@/lib/services/finance';
import { reorderPlan } from '@/lib/services/reorder';
import { groupOrders, importOrder } from '@/lib/services/import';
import { requireWriter } from '@/lib/services/business';
import { withUser } from '@/lib/db/tenant';
import { expenseSchema, productSchema, purchaseOrderSchema } from '@/lib/validation/schemas';

let user: string;
let biz: string;
const ids: Record<string, string> = {};
const run = <T>(fn: Parameters<typeof as<T>>[2]) => as(user, biz, fn);
const exp = (o: Record<string, unknown>) => expenseSchema.parse({ currency: 'EUR', fx_rate: '1', date_incurred: '2026-09-01', commitment: 'committed', manual_shares: [], ...o });

beforeAll(async () => {
  await setupTestDb();
  user = await createUser();
  biz = await createTestBusiness(user, 'Integrity Co');
  ids.sup = await run((tx) => createSupplier(tx, { name: 'S', country: 'MA', currency: 'MAD', default_deposit_pct: '30', contact_name: null, email: null, phone: null, address: null, payment_terms: null, lead_time_days: null, min_order_qty: null, notes: null }));
  for (const [sku, w] of [['A', '0.1'], ['B', null]] as const) {
    await run((tx) => saveProduct(tx, productSchema.parse({ name: `P${sku}`, status: 'active', has_expiry: false, variants: [{ sku, variant_name: 'Std', supplier_unit_price: '10', purchase_currency: 'MAD', default_selling_price: '20', selling_price_includes_tax: true, weight_kg: w ?? '', safety_stock_qty: 0 }] })));
  }
  const vs = await run((tx) => listVariants(tx));
  ids.A = vs.find((v) => v.sku === 'A')!.id;
  ids.B = vs.find((v) => v.sku === 'B')!.id;
  ids.po = await run((tx) => savePurchaseOrder(tx, purchaseOrderSchema.parse({ po_number: 'PO-I', supplier_id: ids.sup, order_date: '2026-08-01', currency: 'MAD', fx_rate: '0.1', status: 'ordered', deposit_due: '0', items: [{ variant_id: ids.A, quantity: 100, unit_price: '10' }, { variant_id: ids.B, quantity: 100, unit_price: '10' }] })));
  ids.sh = await run((tx) => saveShipment(tx, { reference: 'SH-I', carrier: null, mode: null, tracking_ref: null, status: 'in_transit', dispatch_date: null, expected_arrival_date: null, actual_arrival_date: null, default_allocation_method: 'quantity', notes: null }));
  const lines = await run((tx) => tx.many<{ id: string }>('select id from purchase_order_items where purchase_order_id = $1', [ids.po]));
  await run((tx) => setShipmentItems(tx, ids.sh, lines.map((l) => ({ purchase_order_item_id: l.id, quantity: 100, total_weight_kg: null, total_volume_m3: null }))));
});

describe('expense allocation integrity', () => {
  it('rejects linking one cost to both a PO and a shipment (no double allocation)', async () => {
    const r = expenseSchema.safeParse({ name: 'x', category: 'freight', amount: '10', currency: 'EUR', fx_rate: '1', date_incurred: '2026-09-01', commitment: 'committed', treatment: 'product_acquisition', link_type: 'shipment', shipment_id: ids.sh, purchase_order_id: ids.po, manual_shares: [] });
    expect(r.success).toBe(false);
    // and the database itself refuses it even if validation were bypassed
    await expect(run((tx) => tx.exec(`insert into expenses (business_id, name, category, amount, currency, fx_rate, date_incurred, treatment, purchase_order_id, shipment_id) values ($1,'x','freight',10,'EUR',1,'2026-09-01','product_acquisition',$2,$3)`, [biz, ids.po, ids.sh]))).rejects.toThrow();
  });

  it('rejects an acquisition cost without a pool, and manual shares that do not total 100%', () => {
    expect(expenseSchema.safeParse({ name: 'x', category: 'freight', amount: '10', currency: 'EUR', fx_rate: '1', date_incurred: '2026-09-01', commitment: 'committed', treatment: 'product_acquisition', link_type: 'general', manual_shares: [] }).success).toBe(false);
    expect(expenseSchema.safeParse({ name: 'x', category: 'freight', amount: '10', currency: 'EUR', fx_rate: '1', date_incurred: '2026-09-01', commitment: 'committed', treatment: 'product_acquisition', link_type: 'shipment', shipment_id: ids.sh, allocation_method: 'manual', manual_shares: [{ variant_id: ids.A, share_pct: '60' }] }).success).toBe(false);
  });

  it('does not guess when weight is missing, and reports the issue', async () => {
    const r = await run((tx) => saveExpense(tx, exp({ name: 'Weight freight', category: 'freight', amount: '50', treatment: 'product_acquisition', link_type: 'shipment', shipment_id: ids.sh, allocation_method: 'weight' })));
    expect(r.issues[0].message).toMatch(/weight is missing/);
    const n = await run((tx) => tx.one<{ n: number }>('select count(*)::int as n from cost_allocations where expense_id = $1', [r.id]));
    expect(n.n).toBe(0);
    await run((tx) => deleteExpense(tx, r.id));
  });

  it('re-allocating never duplicates rows; allocations always reconcile to costs', async () => {
    const r = await run((tx) => saveExpense(tx, exp({ name: 'Broker', category: 'broker', amount: '33.33', treatment: 'product_acquisition', link_type: 'shipment', shipment_id: ids.sh, allocation_method: 'quantity' })));
    for (let i = 0; i < 3; i++) await run((tx) => saveExpense(tx, exp({ name: 'Broker', category: 'broker', amount: '33.33', treatment: 'product_acquisition', link_type: 'shipment', shipment_id: ids.sh, allocation_method: 'quantity' }), r.id));
    const a = await run((tx) => tx.many<{ amount_base: string }>('select amount_base from cost_allocations where expense_id = $1', [r.id]));
    expect(a).toHaveLength(2);
    expect(sum(a.map((x) => x.amount_base)).toFixed(2)).toBe('33.33');
  });

  it('keeps expenses with a missing FX rate out of base totals and flags them', async () => {
    await run((tx) => saveExpense(tx, exp({ name: 'Planned USD', category: 'subscriptions', amount: '100', currency: 'USD', fx_rate: null, treatment: 'operating', commitment: 'planned' })));
    const t = await run((tx) => expenseTotals(tx));
    expect(t.missing_fx).toBe(1);
    const p = await run((tx) => profitAndLoss(tx, {}));
    expect(p.operating.toFixed(2)).toBe('0.00'); // planned + no rate: not counted as actual
  });
});

describe('partial receipts and payments', () => {
  it('receives in two partial deliveries with consistent unit cost', async () => {
    const lines = await run((tx) => tx.many<{ id: string; variant_id: string }>('select id, variant_id from purchase_order_items where purchase_order_id = $1', [ids.po]));
    const si = await run((tx) => tx.many<{ id: string; purchase_order_item_id: string }>('select id, purchase_order_item_id from shipment_items where shipment_id = $1', [ids.sh]));
    const a = lines.find((l) => l.variant_id === ids.A)!;
    const sA = si.find((s) => s.purchase_order_item_id === a.id)!;
    const rcv = (qty: number, k: string) => run((tx) => receiveGoods(tx, { purchase_order_id: ids.po, shipment_id: ids.sh, received_date: '2026-09-10', notes: null, idempotency_key: k, lines: [{ purchase_order_item_id: a.id, shipment_item_id: sA.id, qty_received: qty, qty_damaged: 0, qty_rejected: 0, qty_missing: 0, expiry_date: null, lot_code: null }] }));
    await rcv(40, 'part-1-xyz');
    await rcv(60, 'part-2-xyz');
    await expect(rcv(1, 'part-3-xyz')).rejects.toThrow(/exceed/);
    const lots = (await run((tx) => listLots(tx, { variantId: ids.A })));
    expect(lots).toHaveLength(2);
    expect(lots[0].landed_unit_cost).toBe(lots[1].landed_unit_cost);
    // 10 MAD x 0.1 = 1.00 purchase + broker 33.33 * (100/200) / 100 = 0.16665
    expect(D(lots[0].landed_unit_cost).toFixed(5)).toBe('1.16665');
    const po = await run((tx) => getPurchaseOrder(tx, ids.po));
    expect(po.po.status).not.toBe('received'); // B not yet received
  });

  it('payment deletion reverses its cash movement (reconciliation)', async () => {
    await run((tx) => addCashTransaction(tx, { txn_date: '2026-08-01', category: 'opening_balance', amount: '1000', currency: 'EUR', fx_rate: '1', account: 'bank', description: null }));
    const pid = await run((tx) => addSupplierPayment(tx, ids.po, { payment_date: '2026-08-02', amount: '500', fx_rate: '0.1', is_deposit: true, method: null, reference: null, idempotency_key: key() }));
    expect((await run((tx) => cashPosition(tx))).balance.toFixed(2)).toBe('950.00');
    await run((tx) => deleteSupplierPayment(tx, pid));
    expect((await run((tx) => cashPosition(tx))).balance.toFixed(2)).toBe('1000.00');
  });
});

describe('no misleading results without data', () => {
  it('zero sales: profitability says insufficient data and reorder makes no quantity up', async () => {
    const p = await run((tx) => productProfitability(tx, {}));
    expect(p.rows.every((r) => r.classification === 'insufficient_data')).toBe(true);
    const r = await run((tx) => reorderPlan(tx, { today: '2026-10-10' }));
    expect(r.results.every((x) => x.result.status === 'insufficient_data' && x.result.suggestedQty === 0)).toBe(true);
    const pnl = await run((tx) => profitAndLoss(tx, {}));
    expect(pnl.netSales.toFixed(2)).toBe('0.00');
  });
});

describe('CSV import', () => {
  it('imports orders once; re-import skips; bad SKUs are reported', async () => {
    await run((tx) => addOpeningStock(tx, { variant_id: ids.B, quantity: 10, unit_cost: '1.50', received_date: '2026-09-01', expiry_date: null, lot_code: null, idempotency_key: key() }));
    const rows = [
      { order_number: 'CSV-1', order_date: '2026-10-01', sku: 'B', quantity: '2', unit_price: '20', status: 'delivered', paid: 'yes' },
      { order_number: 'CSV-2', order_date: '2026-10-01', sku: 'ZZZ', quantity: '1', unit_price: '20' },
    ];
    const g = groupOrders(rows);
    expect(await run((tx) => importOrder(tx, g[0]))).toBe('imported');
    await expect(run((tx) => importOrder(tx, g[1]))).rejects.toThrow(/Unknown SKU/);
    expect(await run((tx) => importOrder(tx, g[0]))).toBe('skipped');
    const pnl = await run((tx) => profitAndLoss(tx, {}));
    expect(pnl.orders).toBe(1);
    expect(pnl.netSales.toFixed(2)).toBe('33.33'); // 40 incl. 20% VAT
  });
});

describe('roles', () => {
  it('viewers can read but not write (application and database)', async () => {
    const viewer = await createUser('viewer@test.local');
    await withUser(user, (q) => q.query(`select add_business_member($1, 'viewer@test.local', 'viewer')`, [biz]));
    const n = await as(viewer, biz, (tx) => tx.one<{ n: number }>('select count(*)::int as n from products'));
    expect(n.n).toBe(2);
    await expect(as(viewer, biz, (tx) => requireWriter(tx))).rejects.toThrow(/read-only/);
    const changed = await withUser(viewer, (q) => q.query(`update products set name = 'x' where business_id = $1 returning id`, [biz]));
    expect(changed).toHaveLength(0); // RLS silently filters the update
    await expect(withUser(viewer, (q) => q.query(`insert into suppliers (business_id, name) values ($1, 'evil')`, [biz]))).rejects.toThrow();
  });

  it('ledgers are append-only for app users', async () => {
    await expect(run((tx) => tx.exec('update inventory_movements set quantity = 999'))).resolves.toBeUndefined();
    const max = await run((tx) => tx.one<{ m: number }>('select max(quantity)::int as m from inventory_movements'));
    expect(max.m).not.toBe(999);
    await expect(run((tx) => tx.exec('delete from audit_logs'))).rejects.toThrow();
  });
});
