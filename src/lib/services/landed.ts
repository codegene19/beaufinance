import { Tx } from '../db/tenant';
import { D, Decimal } from '../calc/money';
import { allocatePool, lotLandedCost, type AllocationIssue, type PoolCost, type PoolLine, type LineCost, type Allocation } from '../calc/landed';

interface PoolResult {
  kind: 'purchase_order' | 'shipment';
  id: string;
  label: string;
  lines: (PoolLine & { lineCost: LineCost })[];
  costs: PoolCost[];
  allocations: Allocation[];
  issues: AllocationIssue[];
  plannedEstimate: Decimal; // planned (uncommitted) acquisition costs — forecast only
}

async function costsFor(tx: Tx, column: 'purchase_order_id' | 'shipment_id', id: string, fallbackMethod: string) {
  const rows = await tx.many(
    `select e.id, e.name, e.category, e.amount_base, e.allocation_method, e.variant_id, e.commitment
       from expenses e where e.${column} = $1 and e.treatment = 'product_acquisition' and e.commitment <> 'cancelled' order by e.date_incurred, e.created_at`,
    [id],
  );
  const manual = await tx.many<{ expense_id: string; variant_id: string; share_pct: string }>(
    `select m.expense_id, m.variant_id, m.share_pct from expense_manual_allocations m join expenses e on e.id = m.expense_id where e.${column} = $1`,
    [id],
  );
  const committed: PoolCost[] = rows
    .filter((r) => r.commitment === 'committed')
    .map((r) => ({
      expenseId: r.id,
      name: r.name,
      category: r.category,
      amountBase: r.amount_base,
      method: (r.allocation_method ?? fallbackMethod) as PoolCost['method'],
      variantId: r.variant_id,
      manualShares: manual.filter((m) => m.expense_id === r.id).map((m) => ({ variantId: m.variant_id, sharePct: m.share_pct })),
    }));
  const planned = rows.filter((r) => r.commitment === 'planned').reduce<Decimal>((a, r) => a.plus(D(r.amount_base)), new Decimal(0));
  return { committed, planned };
}

export async function computePoPool(tx: Tx, poId: string): Promise<PoolResult> {
  const po = await tx.one('select id, po_number, fx_rate from purchase_orders where id = $1 and business_id = $2', [poId, tx.businessId], 'Purchase order not found');
  const items = await tx.many(
    `select i.id, i.variant_id, i.quantity, i.line_total, v.sku, v.variant_name, p.name as product_name, v.weight_kg, v.length_cm, v.width_cm, v.height_cm
       from purchase_order_items i join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id
      where i.purchase_order_id = $1 order by p.name`,
    [poId],
  );
  const lines: PoolLine[] = items.map((i) => ({
    lineId: i.id,
    poItemId: i.id,
    shipmentItemId: null,
    variantId: i.variant_id,
    label: `${i.product_name} — ${i.variant_name} (${i.sku})`,
    quantity: i.quantity,
    purchaseValueBase: D(i.line_total).times(D(po.fx_rate)),
    totalWeightKg: i.weight_kg === null ? null : D(i.weight_kg).times(i.quantity),
    totalVolumeM3: i.length_cm === null || i.width_cm === null || i.height_cm === null ? null : D(i.length_cm).times(i.width_cm).times(i.height_cm).div(1e6).times(i.quantity),
  }));
  const { committed, planned } = await costsFor(tx, 'purchase_order_id', poId, 'value');
  const r = allocatePool(lines, committed);
  return {
    kind: 'purchase_order',
    id: poId,
    label: po.po_number,
    lines: lines.map((l) => ({ ...l, lineCost: r.lineCosts.find((c) => c.lineId === l.lineId)! })),
    costs: committed,
    allocations: r.allocations,
    issues: r.issues,
    plannedEstimate: planned,
  };
}

export async function computeShipmentPool(tx: Tx, shipmentId: string): Promise<PoolResult> {
  const sh = await tx.one('select id, reference, default_allocation_method from shipments where id = $1 and business_id = $2', [shipmentId, tx.businessId], 'Shipment not found');
  const items = await tx.many(
    `select si.id, si.quantity, si.total_weight_kg, si.total_volume_m3, pi.id as po_item_id, pi.variant_id, pi.unit_price, po.fx_rate, po.po_number,
            v.sku, v.variant_name, p.name as product_name, v.weight_kg, v.length_cm, v.width_cm, v.height_cm
       from shipment_items si join purchase_order_items pi on pi.id = si.purchase_order_item_id
       join purchase_orders po on po.id = pi.purchase_order_id
       join product_variants v on v.id = pi.variant_id join products p on p.id = v.product_id
      where si.shipment_id = $1 order by po.po_number, p.name`,
    [shipmentId],
  );
  const lines: PoolLine[] = items.map((i) => ({
    lineId: i.id,
    poItemId: i.po_item_id,
    shipmentItemId: i.id,
    variantId: i.variant_id,
    label: `${i.product_name} — ${i.variant_name} (${i.sku}) · ${i.po_number}`,
    quantity: i.quantity,
    purchaseValueBase: D(i.unit_price).times(i.quantity).times(D(i.fx_rate)),
    totalWeightKg: i.total_weight_kg ?? (i.weight_kg === null ? null : D(i.weight_kg).times(i.quantity)),
    totalVolumeM3:
      i.total_volume_m3 ?? (i.length_cm === null || i.width_cm === null || i.height_cm === null ? null : D(i.length_cm).times(i.width_cm).times(i.height_cm).div(1e6).times(i.quantity)),
  }));
  const { committed, planned } = await costsFor(tx, 'shipment_id', shipmentId, sh.default_allocation_method);
  const r = allocatePool(lines, committed);
  return {
    kind: 'shipment',
    id: shipmentId,
    label: sh.reference,
    lines: lines.map((l) => ({ ...l, lineCost: r.lineCosts.find((c) => c.lineId === l.lineId)! })),
    costs: committed,
    allocations: r.allocations,
    issues: r.issues,
    plannedEstimate: planned,
  };
}

/**
 * Rebuilds cost allocations and refreshes landed costs of every affected lot, atomically
 * within the caller's transaction. Expands to all POs/shipments connected to the inputs.
 */
export async function recomputeLanded(tx: Tx, scope: { poIds?: string[]; shipmentIds?: string[] }) {
  const poIds = new Set(scope.poIds ?? []);
  const shipIds = new Set(scope.shipmentIds ?? []);
  // closure over shipment <-> PO links
  for (let i = 0; i < 3; i++) {
    if (shipIds.size) {
      const r = await tx.many<{ id: string }>(
        `select distinct pi.purchase_order_id as id from shipment_items si join purchase_order_items pi on pi.id = si.purchase_order_item_id where si.shipment_id = any($1::uuid[])`,
        [[...shipIds]],
      );
      r.forEach((x) => poIds.add(x.id));
    }
    if (poIds.size) {
      const r = await tx.many<{ id: string }>(
        `select distinct si.shipment_id as id from shipment_items si join purchase_order_items pi on pi.id = si.purchase_order_item_id where pi.purchase_order_id = any($1::uuid[])`,
        [[...poIds]],
      );
      r.forEach((x) => shipIds.add(x.id));
    }
  }
  const poPools = [];
  for (const id of poIds) poPools.push(await computePoPool(tx, id));
  const shipPools = [];
  for (const id of shipIds) shipPools.push(await computeShipmentPool(tx, id));
  const issues: (AllocationIssue & { pool: string })[] = [];

  // Persist allocations (replace for the expenses in these pools)
  for (const pool of [...poPools, ...shipPools]) {
    const col = pool.kind === 'purchase_order' ? 'purchase_order_id' : 'shipment_id';
    await tx.exec(`delete from cost_allocations where expense_id in (select id from expenses where ${col} = $1)`, [pool.id]);
    for (const a of pool.allocations) {
      await tx.exec(
        `insert into cost_allocations (business_id, expense_id, purchase_order_item_id, shipment_item_id, method, basis_value, amount_base) values ($1,$2,$3,$4,$5,$6,$7)`,
        [tx.businessId, a.expenseId, a.poItemId, a.shipmentItemId, a.method, a.basis.toFixed(6), a.amount.toFixed(4)],
      );
    }
    pool.issues.forEach((i) => issues.push({ ...i, pool: pool.label }));
  }

  // Per-unit components
  const poUnit = new Map<string, { perUnit: Decimal; purchasePerUnit: Decimal; cats: Record<string, Decimal> }>();
  for (const pool of poPools)
    for (const l of pool.lines) {
      const cats: Record<string, Decimal> = {};
      for (const [k, v] of Object.entries(l.lineCost.byCategory)) cats[k] = v.div(l.quantity);
      poUnit.set(l.poItemId, { perUnit: l.lineCost.perBasisUnit, purchasePerUnit: l.lineCost.purchase.div(l.quantity), cats });
    }
  const shipUnit = new Map<string, { perUnit: Decimal; cats: Record<string, Decimal> }>();
  for (const pool of shipPools)
    for (const l of pool.lines) {
      const cats: Record<string, Decimal> = {};
      for (const [k, v] of Object.entries(l.lineCost.byCategory)) cats[k] = v.div(l.quantity);
      shipUnit.set(l.shipmentItemId!, { perUnit: l.lineCost.allocated.div(l.quantity), cats });
    }

  if (poIds.size) {
    const lots = await tx.many(
      `select id, purchase_order_item_id, shipment_item_id, qty_received, qty_damaged, qty_rejected, qty_missing from inventory_lots where purchase_order_item_id in (select id from purchase_order_items where purchase_order_id = any($1::uuid[]))`,
      [[...poIds]],
    );
    for (const lot of lots) {
      const pu = poUnit.get(lot.purchase_order_item_id);
      if (!pu) continue;
      const su = lot.shipment_item_id ? shipUnit.get(lot.shipment_item_id) : undefined;
      const perBasis = pu.perUnit.plus(su?.perUnit ?? 0);
      const r = lotLandedCost(perBasis, { received: lot.qty_received, damaged: lot.qty_damaged, rejected: lot.qty_rejected, missing: lot.qty_missing });
      const accounted = r.accountedUnits;
      const breakdown: Record<string, string> = { purchase: pu.purchasePerUnit.times(accounted).toFixed(4) };
      const add = (cats: Record<string, Decimal>) => {
        for (const [k, v] of Object.entries(cats)) breakdown[k] = D(breakdown[k] ?? 0).plus(v.times(accounted)).toFixed(4);
      };
      add(pu.cats);
      if (su) add(su.cats);
      await tx.exec(`update inventory_lots set landed_cost_total = $2, landed_unit_cost = $3, cost_breakdown = $4 where id = $1`, [
        lot.id,
        r.total.toFixed(4),
        (r.unitCost ?? new Decimal(0)).toFixed(6),
        JSON.stringify({ ...breakdown, accounted_units: accounted, sellable_units: r.sellableUnits, per_basis_unit: perBasis.toFixed(6) }),
      ]);
    }
  }
  return { issues, poIds: [...poIds], shipmentIds: [...shipIds] };
}

/** Full, inspectable breakdown of how landed cost is built for a PO and its shipments. */
export async function landedBreakdownForPo(tx: Tx, poId: string) {
  const poPool = await computePoPool(tx, poId);
  const shipIds = await tx.many<{ id: string }>(
    `select distinct si.shipment_id as id from shipment_items si join purchase_order_items pi on pi.id = si.purchase_order_item_id where pi.purchase_order_id = $1`,
    [poId],
  );
  const shipPools = [];
  for (const s of shipIds) shipPools.push(await computeShipmentPool(tx, s.id));
  const lots = await tx.many(
    `select l.*, v.sku, v.variant_name, p.name as product_name from inventory_lots l join product_variants v on v.id = l.variant_id join products p on p.id = v.product_id
      where l.purchase_order_item_id in (select id from purchase_order_items where purchase_order_id = $1) order by l.received_date`,
    [poId],
  );
  return { poPool, shipPools, lots };
}
