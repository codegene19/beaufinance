import { D, Decimal, allocateExact, sum, type Num } from './money';

export type AllocationMethod = 'quantity' | 'value' | 'weight' | 'volume' | 'manual';

/** One line of a cost pool (a shipment item, or a PO item when goods have no shipment). */
export interface PoolLine {
  lineId: string;
  poItemId: string;
  shipmentItemId: string | null;
  variantId: string;
  label: string;
  quantity: number; // units this line covers (shipped, or ordered)
  purchaseValueBase: Num; // quantity x unit price x PO accounting rate
  totalWeightKg: Num | null;
  totalVolumeM3: Num | null;
}

export interface PoolCost {
  expenseId: string;
  name: string;
  category: string;
  amountBase: Num | null; // null when the FX rate is missing
  method: AllocationMethod;
  variantId?: string | null; // restrict allocation to lines of this variant
  manualShares?: { variantId: string; sharePct: Num }[];
}

export interface Allocation {
  expenseId: string;
  lineId: string;
  poItemId: string;
  shipmentItemId: string | null;
  method: AllocationMethod;
  basis: Decimal;
  amount: Decimal;
}

export interface LineCost {
  lineId: string;
  purchase: Decimal;
  allocated: Decimal;
  byCategory: Record<string, Decimal>;
  total: Decimal;
  /** landed cost per unit of the line's basis quantity (before losses) */
  perBasisUnit: Decimal;
}

export interface AllocationIssue {
  expenseId: string;
  name: string;
  message: string;
}

function basisFor(line: PoolLine, method: Exclude<AllocationMethod, 'manual'>): Decimal | null {
  switch (method) {
    case 'quantity':
      return D(line.quantity);
    case 'value':
      return D(line.purchaseValueBase);
    case 'weight':
      return line.totalWeightKg === null || line.totalWeightKg === undefined ? null : D(line.totalWeightKg);
    case 'volume':
      return line.totalVolumeM3 === null || line.totalVolumeM3 === undefined ? null : D(line.totalVolumeM3);
  }
}

/**
 * Allocates capitalisable acquisition costs across pool lines.
 * Never silently falls back to an equal split: if the data needed for the chosen
 * method is missing, the cost is reported as an issue and left unallocated.
 */
export function allocatePool(lines: PoolLine[], costs: PoolCost[]): { allocations: Allocation[]; lineCosts: LineCost[]; issues: AllocationIssue[] } {
  const allocations: Allocation[] = [];
  const issues: AllocationIssue[] = [];

  for (const c of costs) {
    if (c.amountBase === null || c.amountBase === undefined) {
      issues.push({ expenseId: c.expenseId, name: c.name, message: 'Missing exchange rate — cost not included in landed cost.' });
      continue;
    }
    const amount = D(c.amountBase);
    if (amount.isZero()) continue;
    const eligible = c.variantId ? lines.filter((l) => l.variantId === c.variantId) : lines;
    if (eligible.length === 0) {
      issues.push({ expenseId: c.expenseId, name: c.name, message: 'No matching product lines in this shipment / purchase order.' });
      continue;
    }

    if (c.method === 'manual') {
      const shares = (c.manualShares ?? []).filter((s) => D(s.sharePct).greaterThan(0));
      if (shares.length === 0) {
        issues.push({ expenseId: c.expenseId, name: c.name, message: 'Manual allocation selected but no shares were entered.' });
        continue;
      }
      const missing = shares.filter((s) => !eligible.some((l) => l.variantId === s.variantId));
      if (missing.length) {
        issues.push({ expenseId: c.expenseId, name: c.name, message: 'Manual allocation references a product that is not in this pool.' });
        continue;
      }
      const shareAmounts = allocateExact(amount, shares.map((s) => s.sharePct));
      shares.forEach((s, si) => {
        const vLines = eligible.filter((l) => l.variantId === s.variantId);
        const parts = allocateExact(shareAmounts[si], vLines.map((l) => l.quantity));
        vLines.forEach((l, i) =>
          allocations.push({ expenseId: c.expenseId, lineId: l.lineId, poItemId: l.poItemId, shipmentItemId: l.shipmentItemId, method: 'manual', basis: D(s.sharePct), amount: parts[i] }),
        );
      });
      continue;
    }

    const bases = eligible.map((l) => basisFor(l, c.method as Exclude<AllocationMethod, 'manual'>));
    if (bases.some((b) => b === null)) {
      issues.push({ expenseId: c.expenseId, name: c.name, message: `Cannot allocate by ${c.method}: ${c.method} is missing for at least one product line.` });
      continue;
    }
    if (sum(bases as Decimal[]).isZero()) {
      issues.push({ expenseId: c.expenseId, name: c.name, message: `Cannot allocate by ${c.method}: the total ${c.method} of the lines is zero.` });
      continue;
    }
    const parts = allocateExact(amount, bases as Decimal[]);
    eligible.forEach((l, i) =>
      allocations.push({ expenseId: c.expenseId, lineId: l.lineId, poItemId: l.poItemId, shipmentItemId: l.shipmentItemId, method: c.method, basis: bases[i] as Decimal, amount: parts[i] }),
    );
  }

  const catOf = new Map(costs.map((c) => [c.expenseId, c.category]));
  const lineCosts: LineCost[] = lines.map((l) => {
    const mine = allocations.filter((a) => a.lineId === l.lineId);
    const byCategory: Record<string, Decimal> = {};
    for (const a of mine) {
      const cat = catOf.get(a.expenseId) ?? 'other';
      byCategory[cat] = (byCategory[cat] ?? new Decimal(0)).plus(a.amount);
    }
    const purchase = D(l.purchaseValueBase);
    const allocated = sum(mine.map((a) => a.amount));
    const total = purchase.plus(allocated);
    return { lineId: l.lineId, purchase, allocated, byCategory, total, perBasisUnit: l.quantity > 0 ? total.div(l.quantity) : new Decimal(0) };
  });

  return { allocations, lineCosts, issues };
}

/**
 * Landed cost of a received lot. Units lost (damaged, rejected, missing) are absorbed
 * by the sellable units: landed cost per sellable unit = cost of units accounted for / sellable units.
 */
export function lotLandedCost(perBasisUnit: Num, lot: { received: number; damaged: number; rejected: number; missing: number }) {
  const accounted = lot.received + lot.missing; // received already includes damaged & rejected
  const sellable = lot.received - lot.damaged - lot.rejected;
  const total = D(perBasisUnit).times(accounted);
  return {
    accountedUnits: accounted,
    sellableUnits: sellable,
    total: total.toDecimalPlaces(4),
    unitCost: sellable > 0 ? total.div(sellable).toDecimalPlaces(6) : null,
  };
}
