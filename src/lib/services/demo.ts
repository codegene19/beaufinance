import { addDays, formatISO } from 'date-fns';
import { withUser, withTenant, Tx } from '../db/tenant';
import { createBusiness } from './business';
import { createSupplier } from './suppliers';
import { saveProduct, listVariants } from './products';
import { savePurchaseOrder, addSupplierPayment } from './purchasing';
import { saveShipment, setShipmentItems } from './shipments';
import { saveExpense, addExpensePayment } from './expenses';
import { receiveGoods } from './inventory';
import { createOrder, transitionOrder, addOrderPayment, createReturn, getOrder } from './sales';
import { saveCampaign } from './marketing';
import { addCashTransaction } from './finance';
import { expenseSchema, productSchema, purchaseOrderSchema, salesOrderSchema } from '../validation/schemas';

/** Deterministic PRNG so the demo is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/**
 * Creates a SEPARATE business flagged is_demo with realistic sample data, built through the same
 * services as real data (so every figure is consistent). Never touches the user's real business.
 */
export async function seedDemoBusiness(userId: string, today = new Date()) {
  const businessId = await withUser(userId, (q) => createBusiness(q, userId, { name: 'Demo · Atlas Botanicals (sample data)', isDemo: true }));
  await withTenant({ userId, businessId }, (tx) => populate(tx, today));
  return businessId;
}

async function populate(tx: Tx, todayDate: Date) {
  const d = (offset: number) => formatISO(addDays(todayDate, offset), { representation: 'date' });
  const rand = rng(42);
  const k = (s: string) => `demo-${s}`;

  await addCashTransaction(tx, { txn_date: d(-170), category: 'owner_contribution', amount: '15000', currency: 'EUR', fx_rate: '1', account: 'bank', description: 'Initial capital (demo)' });
  await addCashTransaction(tx, { txn_date: d(-60), category: 'owner_contribution', amount: '3000', currency: 'EUR', fx_rate: '1', account: 'bank', description: 'Additional capital (demo)' });

  const atlas = await createSupplier(tx, { name: 'Atlas Naturals Coop', country: 'MA', contact_name: 'Fatima Z.', email: 'orders@atlas-demo.example', phone: '+212 600 000 000', address: 'Agadir, Morocco', currency: 'MAD', payment_terms: '30% deposit, balance before shipment', default_deposit_pct: '30', lead_time_days: 35, min_order_qty: 100, notes: 'Demo supplier — women’s argan cooperative' });
  const rif = await createSupplier(tx, { name: 'Rif Botanicals SARL', country: 'MA', contact_name: 'Youssef B.', email: null, phone: null, address: 'Fès, Morocco', currency: 'MAD', payment_terms: '50% deposit', default_deposit_pct: '50', lead_time_days: 25, min_order_qty: 150, notes: null });

  const mk = (name: string, category: string, supplier: string, sku: string, variant: string, price: string, sell: string, weight: string, dims: [string, string, string], moq: number, safety: number) =>
    saveProduct(tx, productSchema.parse({
      name, category, brand: 'Atlas Botanicals', supplier_id: supplier, country_of_origin: 'MA', status: 'active', has_expiry: true, shelf_life_days: 730,
      description: `${name} — demo product`,
      variants: [{ sku, variant_name: variant, supplier_unit_price: price, purchase_currency: 'MAD', default_selling_price: sell, selling_price_includes_tax: true, target_margin_pct: '35',
        weight_kg: weight, length_cm: dims[0], width_cm: dims[1], height_cm: dims[2], min_order_qty: moq, order_multiple: 50, supplier_lead_days: 35, shipping_lead_days: 21, safety_stock_qty: safety }],
    }));
  await mk('Organic Argan Oil', 'Face & body oils', atlas, 'ARG-50', '50 ml', '65', '29.90', '0.14', ['4', '4', '12'], 100, 20);
  await mk('Organic Argan Oil', 'Face & body oils', atlas, 'ARG-100', '100 ml', '110', '44.90', '0.24', ['5', '5', '15'], 100, 10);
  await mk('Rhassoul Clay Mask', 'Masks', rif, 'RHA-200', '200 g', '28', '16.90', '0.24', ['8', '8', '9'], 150, 20);
  await mk('Damask Rose Water', 'Toners', rif, 'ROSE-150', '150 ml', '22', '14.90', '0.19', ['5', '5', '16'], 150, 25);
  await mk('Beldi Black Soap', 'Cleansers', rif, 'SOAP-250', '250 g', '25', '13.90', '0.29', ['8', '8', '8'], 150, 15);
  const vs = await listVariants(tx);
  const v = (sku: string) => vs.find((x) => x.sku === sku)!.id;

  // Startup & operating costs
  const exp = (o: Record<string, unknown>) => saveExpense(tx, expenseSchema.parse({ currency: 'EUR', fx_rate: '1', commitment: 'committed', manual_shares: [], link_type: 'general', ...o }));
  const pay = async (id: string, date: string, amount: string, fx = '1') => addExpensePayment(tx, id, { payment_date: date, amount, fx_rate: fx, method: 'card', reference: null, idempotency_key: k(`${id}-${date}`) });
  for (const [name, cat, amt, off] of [['Brand identity & logo', 'branding', '1200', -165], ['Shopify theme & setup', 'website_setup', '780', -150], ['Product photography', 'photography', '650', -120], ['Product samples', 'samples', '240', -175], ['Company registration', 'legal_admin', '350', -168]] as const) {
    const r = await exp({ name, category: cat, amount: amt, treatment: cat === 'legal_admin' ? 'startup' : 'startup', date_incurred: d(off) });
    await pay(r.id, d(off), amt);
  }
  for (let m = 4; m >= 0; m--) {
    const r = await exp({ name: 'Shopify subscription', category: 'subscriptions', amount: '39', treatment: 'operating', date_incurred: d(-m * 30 - 5), recurring_interval: 'monthly' });
    await pay(r.id, d(-m * 30 - 5), '39');
    const a = await exp({ name: 'Accountant retainer', category: 'accounting', amount: '120', treatment: 'operating', date_incurred: d(-m * 30 - 2), recurring_interval: 'monthly' });
    if (m > 0) await pay(a.id, d(-m * 30 + 10), '120');
  }

  // First bulk purchase
  const po1 = await savePurchaseOrder(tx, purchaseOrderSchema.parse({
    po_number: 'PO-DEMO-001', supplier_id: atlas, order_date: d(-145), currency: 'MAD', fx_rate: '0.0921', status: 'ordered', deposit_due: '13410', expected_arrival_date: d(-95),
    items: [{ variant_id: v('ARG-50'), quantity: 400, unit_price: '65' }, { variant_id: v('ARG-100'), quantity: 150, unit_price: '110' }],
  }));
  await addSupplierPayment(tx, po1, { payment_date: d(-144), amount: '12750', fx_rate: '0.0925', is_deposit: true, method: 'SWIFT', reference: 'DEP-001', idempotency_key: k('po1-dep') });
  await addSupplierPayment(tx, po1, { payment_date: d(-112), amount: '29750', fx_rate: '0.0918', is_deposit: false, method: 'SWIFT', reference: 'BAL-001', idempotency_key: k('po1-bal') });
  const po2 = await savePurchaseOrder(tx, purchaseOrderSchema.parse({
    po_number: 'PO-DEMO-002', supplier_id: rif, order_date: d(-140), currency: 'MAD', fx_rate: '0.0921', status: 'ordered', deposit_due: '7210', expected_arrival_date: d(-95),
    items: [{ variant_id: v('RHA-200'), quantity: 300, unit_price: '28' }, { variant_id: v('ROSE-150'), quantity: 160, unit_price: '22' }, { variant_id: v('SOAP-250'), quantity: 100, unit_price: '25' }],
  }));
  await addSupplierPayment(tx, po2, { payment_date: d(-139), amount: '7210', fx_rate: '0.0925', is_deposit: true, method: 'SWIFT', reference: 'DEP-002', idempotency_key: k('po2-dep') });
  await addSupplierPayment(tx, po2, { payment_date: d(-108), amount: '5000', fx_rate: '0.0917', is_deposit: false, method: 'SWIFT', reference: 'P2-002', idempotency_key: k('po2-p2') });

  const sh = await saveShipment(tx, { reference: 'SHP-AGA-PAR-01', carrier: 'Kuehne+Nagel (demo)', mode: 'air', tracking_ref: 'KN123456', status: 'in_transit', dispatch_date: d(-104), expected_arrival_date: d(-96), actual_arrival_date: null, default_allocation_method: 'value', notes: 'Consolidated air freight Agadir → Paris CDG' });
  const lines = await tx.many<{ po_item_id: string; quantity: number }>('select po_item_id, quantity from v_po_item_progress where purchase_order_id = any($1::uuid[])', [[po1, po2]]);
  await setShipmentItems(tx, sh, lines.map((l) => ({ purchase_order_item_id: l.po_item_id, quantity: l.quantity, total_weight_kg: null, total_volume_m3: null })));
  const shipCost = async (name: string, category: string, amount: string, method: string, treatment = 'product_acquisition', currency = 'EUR', fx = '1', paid = true) => {
    const r = await exp({ name, category, amount, currency, fx_rate: fx, treatment, link_type: 'shipment', shipment_id: sh, allocation_method: treatment === 'product_acquisition' ? method : null, date_incurred: d(-100), due_date: d(-90), payee: 'Kuehne+Nagel' });
    if (paid) await pay(r.id, d(-98), amount, fx);
    return r.id;
  };
  await shipCost('Air freight AGA→CDG', 'freight', '1480', 'weight');
  await shipCost('Cargo insurance', 'insurance', '85', 'value');
  await shipCost('Customs duties', 'customs_duty', '402.60', 'value');
  await shipCost('Import VAT (recoverable)', 'import_vat', '1320.50', 'value', 'recoverable_tax');
  await shipCost('Customs broker', 'broker', '185', 'quantity');
  await shipCost('CDG handling', 'port_handling', '120', 'weight');
  await shipCost('Local delivery to studio', 'local_transport', '160', 'quantity', 'product_acquisition', 'EUR', '1', false);
  await shipCost('Labels & French INCI stickers', 'packaging_labeling', '2400', 'quantity', 'product_acquisition', 'MAD', '0.0921');
  await exp({ name: 'Bank transfer fees PO-001', category: 'bank_fee', amount: '42', treatment: 'product_acquisition', link_type: 'purchase_order', purchase_order_id: po1, allocation_method: 'value', date_incurred: d(-112) });

  const items = await tx.many<{ po_item_id: string; quantity: number; purchase_order_id: string; variant_id: string }>('select po_item_id, quantity, purchase_order_id, variant_id from v_po_item_progress where purchase_order_id = any($1::uuid[])', [[po1, po2]]);
  const sItems = await tx.many<{ id: string; purchase_order_item_id: string }>('select id, purchase_order_item_id from shipment_items where shipment_id = $1', [sh]);
  for (const po of [po1, po2]) {
    await receiveGoods(tx, {
      purchase_order_id: po, shipment_id: sh, received_date: d(-95), notes: 'Counted on arrival', idempotency_key: k(`rcv-${po}`),
      lines: items.filter((i) => i.purchase_order_id === po).map((i) => {
        const dmg = i.variant_id === v('ROSE-150') ? 6 : i.variant_id === v('ARG-50') ? 3 : 0;
        return { purchase_order_item_id: i.po_item_id, shipment_item_id: sItems.find((s) => s.purchase_order_item_id === i.po_item_id)!.id, qty_received: i.quantity, qty_damaged: dmg, qty_rejected: 0, qty_missing: 0, expiry_date: d(-95 + 700), lot_code: null };
      }),
    });
  }

  // Marketing
  const pre = await saveCampaign(tx, { name: 'Pre-launch influencer seeding', channel: 'influencer', start_date: d(-110), end_date: d(-92), planned_budget: '800', is_prelaunch: true, allocation_method: 'delivered_orders', sessions: null, notes: '6 micro-influencers, gifted products + fees', products: [] });
  const r1 = await exp({ name: 'Influencer fees', category: 'influencer_marketing', amount: '720', treatment: 'marketing', link_type: 'campaign', campaign_id: pre, date_incurred: d(-100) });
  await pay(r1.id, d(-99), '720');
  const meta = await saveCampaign(tx, { name: 'Meta — Argan always-on', channel: 'meta', start_date: d(-92), end_date: null, planned_budget: '1500', is_prelaunch: false, allocation_method: 'delivered_orders', sessions: 5200, notes: 'Advantage+ shopping campaign', products: [{ variant_id: v('ARG-50'), manual_share_pct: null }, { variant_id: v('ARG-100'), manual_share_pct: null }] });
  const tiktok = await saveCampaign(tx, { name: 'TikTok — Rhassoul ritual', channel: 'tiktok', start_date: d(-60), end_date: d(-30), planned_budget: '400', is_prelaunch: false, allocation_method: 'revenue_share', sessions: 2100, notes: null, products: [{ variant_id: v('RHA-200'), manual_share_pct: null }] });
  for (const [c, amt, off] of [[meta, '380', -85], [meta, '420', -55], [meta, '450', -25], [tiktok, '290', -45]] as const) {
    const r = await exp({ name: c === meta ? 'Meta ads invoice' : 'TikTok ads invoice', category: 'paid_advertising', amount: amt, treatment: 'marketing', link_type: 'campaign', campaign_id: c, date_incurred: d(off) });
    await pay(r.id, d(off + 2), amt);
  }
  await exp({ name: 'Meta ads — next month budget', category: 'paid_advertising', amount: '500', treatment: 'marketing', link_type: 'campaign', campaign_id: meta, date_incurred: d(20), commitment: 'planned' });

  // Sales over the last ~90 days
  const channels = await tx.many<{ id: string; name: string }>('select id, name from sales_channels where business_id = $1', [tx.businessId]);
  const ch = (n: string) => channels.find((c) => c.name === n)!.id;
  const catalog = [
    { sku: 'ARG-50', price: '29.90', w: 0.34 },
    { sku: 'ARG-100', price: '44.90', w: 0.12 },
    { sku: 'RHA-200', price: '16.90', w: 0.2 },
    { sku: 'ROSE-150', price: '14.90', w: 0.22 },
    { sku: 'SOAP-250', price: '13.90', w: 0.12 },
  ];
  const stockLeft: Record<string, number> = {};
  for (const r of await tx.many<{ variant_id: string; available: number }>('select variant_id, sum(available)::int as available from v_lot_stock group by variant_id')) stockLeft[r.variant_id] = r.available;
  const pick = () => {
    let x = rand();
    for (const c of catalog) {
      if ((x -= c.w) <= 0) return c;
    }
    return catalog[0];
  };
  let n = 1000;
  for (let day = -90; day <= 0; day++) {
    const ramp = day < -70 ? 1.5 : day < -30 ? 3 : 4.2; // growth
    const count = Math.floor(ramp * (0.4 + rand() * 1.2));
    for (let j = 0; j < count; j++) {
      const lines: { sku: string; price: string; qty: number }[] = [];
      const first = pick();
      lines.push({ ...first, qty: rand() < 0.2 ? 2 : 1 });
      if (rand() < 0.3) {
        const second = pick();
        if (second.sku !== first.sku) lines.push({ ...second, qty: 1 });
      }
      if (lines.some((l) => (stockLeft[v(l.sku)] ?? 0) < l.qty)) continue;
      lines.forEach((l) => (stockLeft[v(l.sku)] -= l.qty));
      const r = rand();
      const channel = r < 0.55 ? 'Website' : r < 0.8 ? 'Instagram' : r < 0.92 ? 'TikTok Shop' : 'Marketplace';
      const pm = rand() < 0.22 ? 'cod' : rand() < 0.85 ? 'card' : 'paypal';
      const campaign = lines.some((l) => l.sku.startsWith('ARG')) && rand() < 0.45 ? meta : lines.some((l) => l.sku === 'RHA-200') && day > -60 && day < -25 && rand() < 0.5 ? tiktok : null;
      const merch = lines.reduce((a, l) => a + Number(l.price) * l.qty, 0);
      const shippingCharged = merch >= 45 ? 0 : 4.9;
      const comm = channel === 'TikTok Shop' ? 0.05 : channel === 'Marketplace' ? 0.15 : 0;
      const total = merch + shippingCharged; // used for fee estimates
      const date = d(day);
      const o = await createOrder(tx, salesOrderSchema.parse({
        order_number: `DEMO-${++n}`, order_date: date, customer_name: `Client ${n}`, customer_city: ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Lille', 'Nantes'][Math.floor(rand() * 6)],
        channel_id: ch(channel), campaign_id: campaign, market_code: 'FR', currency: 'EUR', fx_rate: '1', prices_include_tax: true, tax_rate_pct: '20',
        shipping_charged: shippingCharged.toFixed(2), order_discount: rand() < 0.1 ? '3.00' : '0', payment_method: pm, delivery_provider: 'Colissimo',
        shipping_cost: lines.length > 1 || lines[0].qty > 1 ? '6.90' : '5.40', fulfillment_cost: '1.20', packaging_cost: '0.95',
        payment_fee: pm === 'cod' ? '1.50' : (total * 0.015 + 0.25).toFixed(2), platform_fee: (total * comm).toFixed(2), initial_status: 'confirmed',
        items: lines.map((l) => ({ variant_id: v(l.sku), quantity: l.qty, unit_price: l.price, line_discount: '0' })),
      }));
      const age = -day;
      if (pm !== 'cod') {
        const f = await tx.one<{ total_incl_tax: string }>('select total_incl_tax from v_order_financials where id = $1', [o.id]);
        await addOrderPayment(tx, o.id, { kind: 'payment', payment_date: date, amount: f.total_incl_tax, method: pm, reference: null, idempotency_key: k(`pay-${o.id}`) });
      }
      if (age >= 1) await transitionOrder(tx, o.id, { to: 'shipped', date: d(day + 1) });
      if (age >= 4) {
        if (pm === 'cod' && rand() < 0.12) {
          await transitionOrder(tx, o.id, { to: 'cancelled', date: d(day + 6), restock: true });
          lines.forEach((l) => (stockLeft[v(l.sku)] += l.qty));
          continue;
        }
        await transitionOrder(tx, o.id, { to: 'delivered', date: d(day + 3), collect_payment: pm === 'cod' });
        if (age >= 12 && rand() < 0.04) {
          const { items: its } = await getOrder(tx, o.id);
          const it = its[0];
          await createReturn(tx, o.id, {
            return_date: d(day + 10), reason: 'Customer return (demo)', items: [{ order_item_id: it.id, quantity: 1, condition: rand() < 0.7 ? 'resellable' : 'damaged' }],
            refund_amount: it.unit_price, return_shipping_cost: '4.90', refund_now: true, idempotency_key: k(`ret-${o.id}`),
          });
        }
      }
    }
  }

  // Second bulk order already in production for the best-seller
  const po3 = await savePurchaseOrder(tx, purchaseOrderSchema.parse({
    po_number: 'PO-DEMO-003', supplier_id: atlas, order_date: d(-12), currency: 'MAD', fx_rate: '0.0919', status: 'ordered', deposit_due: '5850', expected_production_date: d(15), expected_ship_date: d(20), expected_arrival_date: d(30),
    items: [{ variant_id: v('ARG-50'), quantity: 300, unit_price: '64' }],
  }));
  await addSupplierPayment(tx, po3, { payment_date: d(-11), amount: '5760', fx_rate: '0.0919', is_deposit: true, method: 'SWIFT', reference: 'DEP-003', idempotency_key: k('po3-dep') });
  await tx.exec(`update purchase_orders set status = 'in_production' where id = $1`, [po3]);
  await exp({ name: 'Freight estimate for PO-DEMO-003', category: 'freight', amount: '620', treatment: 'product_acquisition', link_type: 'purchase_order', purchase_order_id: po3, allocation_method: 'quantity', date_incurred: d(20), commitment: 'planned' });
}
