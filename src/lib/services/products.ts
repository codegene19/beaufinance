import { Tx } from '../db/tenant';
import { AppError } from '../errors';
import type { ProductInput } from '../validation/schemas';

const P_COLS = ['name', 'description', 'brand', 'category', 'supplier_id', 'country_of_origin', 'image_url', 'status', 'has_expiry', 'shelf_life_days', 'notes'] as const;
const V_COLS = [
  'sku', 'barcode', 'variant_name', 'supplier_unit_price', 'purchase_currency', 'default_selling_price', 'selling_price_includes_tax', 'target_margin_pct',
  'target_markup_pct', 'length_cm', 'width_cm', 'height_cm', 'weight_kg', 'min_order_qty', 'order_multiple', 'supplier_lead_days', 'shipping_lead_days',
  'safety_stock_qty', 'packaging_cost',
] as const;

export interface VariantRow {
  id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  [k: string]: any;
}

/** All variants with their live stock position and current landed cost (weighted over lots on hand, else the latest lot). */
export async function listVariants(tx: Tx, opts: { q?: string; status?: string; activeOnly?: boolean } = {}): Promise<VariantRow[]> {
  return tx.many<VariantRow>(
    `select v.*, p.name as product_name, p.status as product_status, p.category, p.brand, p.has_expiry, p.supplier_id, p.image_url,
            s.name as supplier_name, s.default_deposit_pct, s.lead_time_days as supplier_default_lead,
            coalesce(st.on_hand, 0)::int as on_hand, coalesce(st.reserved, 0)::int as reserved, coalesce(st.available, 0)::int as available,
            coalesce(st.stock_value, 0) as stock_value,
            case when coalesce(st.on_hand, 0) > 0 then st.stock_value / st.on_hand else lc.landed_unit_cost end as current_landed_cost,
            lc.landed_unit_cost as latest_lot_cost,
            coalesce(it.in_transit, 0)::int as in_transit, coalesce(it.on_order, 0)::int as on_order
       from product_variants v
       join products p on p.id = v.product_id
       left join suppliers s on s.id = p.supplier_id
       left join (select variant_id, sum(on_hand) as on_hand, sum(reserved) as reserved, sum(available) as available,
                         sum(greatest(on_hand,0) * landed_unit_cost) as stock_value
                    from v_lot_stock group by variant_id) st on st.variant_id = v.id
       left join lateral (select landed_unit_cost from inventory_lots l where l.variant_id = v.id and l.qty_sellable > 0
                           order by received_date desc, created_at desc limit 1) lc on true
       left join (
         select pi.variant_id,
                sum(case when sh.status in ('in_transit','at_customs','cleared','delivered') then greatest(si.quantity - coalesce(rl.acc,0),0) else 0 end) as in_transit,
                sum(greatest(pi.qty_outstanding,0)) as on_order
           from v_po_item_progress pi
           join purchase_orders po on po.id = pi.purchase_order_id and po.status not in ('draft','cancelled','received')
           left join shipment_items si on si.purchase_order_item_id = pi.po_item_id
           left join shipments sh on sh.id = si.shipment_id
           left join (select shipment_item_id, sum(qty_received + qty_missing) as acc from inventory_lots group by shipment_item_id) rl on rl.shipment_item_id = si.id
          group by pi.variant_id) it on it.variant_id = v.id
      where v.business_id = $1
        and ($2::text is null or p.name ilike '%' || $2 || '%' or v.sku ilike '%' || $2 || '%' or v.variant_name ilike '%' || $2 || '%' or v.barcode = $2)
        and ($3::text is null or p.status::text = $3)
        and (not $4 or (v.is_active and p.status <> 'discontinued'))
      order by p.name, v.variant_name`,
    [tx.businessId, opts.q || null, opts.status || null, !!opts.activeOnly],
  );
}

export async function listProducts(tx: Tx, opts: { q?: string; status?: string; category?: string } = {}) {
  return tx.many(
    `select p.*, s.name as supplier_name,
            (select count(*) from product_variants v where v.product_id = p.id)::int as variant_count,
            (select string_agg(v.sku, ', ' order by v.sku) from product_variants v where v.product_id = p.id) as skus,
            (select min(v.default_selling_price) from product_variants v where v.product_id = p.id) as min_price,
            coalesce((select sum(ls.on_hand) from v_lot_stock ls join product_variants v on v.id = ls.variant_id where v.product_id = p.id), 0)::int as on_hand
       from products p left join suppliers s on s.id = p.supplier_id
      where p.business_id = $1
        and ($2::text is null or p.name ilike '%' || $2 || '%' or p.brand ilike '%' || $2 || '%'
             or exists (select 1 from product_variants v where v.product_id = p.id and (v.sku ilike '%' || $2 || '%' or v.barcode = $2)))
        and ($3::text is null or p.status::text = $3)
        and ($4::text is null or p.category = $4)
      order by p.created_at desc`,
    [tx.businessId, opts.q || null, opts.status || null, opts.category || null],
  );
}

export async function getProduct(tx: Tx, id: string) {
  const product = await tx.one('select p.*, s.name as supplier_name from products p left join suppliers s on s.id = p.supplier_id where p.id = $1 and p.business_id = $2', [id, tx.businessId], 'Product not found');
  const variants = await tx.many('select * from product_variants where product_id = $1 order by created_at', [id]);
  const documents = await tx.many('select * from product_documents where product_id = $1 order by created_at', [id]);
  return { product, variants, documents };
}

export async function listCategories(tx: Tx) {
  return (await tx.many<{ category: string }>('select distinct category from products where business_id = $1 and category is not null order by 1', [tx.businessId])).map((r) => r.category);
}

export async function saveProduct(tx: Tx, input: ProductInput, id?: string) {
  const skus = input.variants.map((v) => v.sku.toLowerCase());
  if (new Set(skus).size !== skus.length) throw new AppError('Each variant needs a unique SKU.');
  let productId = id;
  if (id) {
    await tx.one('select id from products where id = $1 and business_id = $2', [id, tx.businessId], 'Product not found');
    await tx.exec(`update products set ${P_COLS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = now() where id = $1 and business_id = $2`, [id, tx.businessId, ...P_COLS.map((c) => input[c])]);
  } else {
    const r = await tx.one<{ id: string }>(
      `insert into products (business_id, ${P_COLS.join(', ')}) values ($1, ${P_COLS.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
      [tx.businessId, ...P_COLS.map((c) => input[c])],
    );
    productId = r.id;
  }
  const existing = await tx.many<{ id: string }>('select id from product_variants where product_id = $1', [productId]);
  const keep = new Set(input.variants.map((v) => v.id).filter(Boolean));
  for (const e of existing) {
    if (!keep.has(e.id)) {
      const used = await tx.one<{ n: number }>(
        `select ((select count(*) from purchase_order_items where variant_id = $1) + (select count(*) from sales_order_items where variant_id = $1) + (select count(*) from inventory_lots where variant_id = $1))::int as n`,
        [e.id],
      );
      if (used.n > 0) throw new AppError('A variant that has purchases, stock or sales cannot be removed. Mark it inactive or discontinue the product instead.', 'conflict');
      await tx.exec('delete from product_variants where id = $1', [e.id]);
    }
  }
  for (const v of input.variants) {
    const vals = V_COLS.map((c) => (v as any)[c]);
    if (v.id && existing.some((e) => e.id === v.id)) {
      await tx.exec(`update product_variants set ${V_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [v.id, ...vals]);
    } else {
      await tx.exec(
        `insert into product_variants (business_id, product_id, ${V_COLS.join(', ')}) values ($1, $2, ${V_COLS.map((_, i) => `$${i + 3}`).join(', ')})`,
        [tx.businessId, productId, ...vals],
      );
    }
  }
  return productId!;
}

export async function deleteProduct(tx: Tx, id: string) {
  const used = await tx.one<{ n: number }>(
    `select ((select count(*) from purchase_order_items i join product_variants v on v.id = i.variant_id where v.product_id = $1)
           + (select count(*) from sales_order_items i join product_variants v on v.id = i.variant_id where v.product_id = $1)
           + (select count(*) from inventory_lots l join product_variants v on v.id = l.variant_id where v.product_id = $1))::int as n`,
    [id],
  );
  if (used.n > 0) throw new AppError('This product has purchase, stock or sales history. Set its status to "discontinued" instead of deleting it.', 'conflict');
  await tx.exec('delete from products where id = $1 and business_id = $2', [id, tx.businessId]);
}

export async function addDocument(tx: Tx, productId: string, name: string, url: string) {
  await tx.exec('insert into product_documents (business_id, product_id, name, url) values ($1,$2,$3,$4)', [tx.businessId, productId, name, url]);
}
export async function deleteDocument(tx: Tx, docId: string) {
  await tx.exec('delete from product_documents where id = $1 and business_id = $2', [docId, tx.businessId]);
}
