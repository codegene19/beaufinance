import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Num = Decimal.Value | null | undefined;

/** Parse any numeric-ish value (DB numerics arrive as strings) into a Decimal. Null -> 0. */
export const D = (v: Num): Decimal => (v === null || v === undefined || v === '' ? new Decimal(0) : new Decimal(v));

export const sum = (vals: Num[]): Decimal => vals.reduce<Decimal>((a, v) => a.plus(D(v)), new Decimal(0));

/** Money is rounded half-up to 2 dp for presentation and posting. */
export const round2 = (v: Num) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const toNumber = (v: Num, dp = 2) => D(v).toDecimalPlaces(dp).toNumber();

/** Safe division: returns null when the denominator is zero (callers must handle "not available"). */
export function div(a: Num, b: Num): Decimal | null {
  const den = D(b);
  if (den.isZero()) return null;
  return D(a).div(den);
}

export function pct(a: Num, b: Num): Decimal | null {
  const r = div(a, b);
  return r === null ? null : r.times(100);
}

/**
 * Split `total` across weights so that the rounded parts add up EXACTLY to the rounded total
 * (largest-remainder method). Used for allocating costs without losing or inventing cents.
 */
export function allocateExact(total: Num, weights: Num[], dp = 4): Decimal[] {
  const t = D(total).toDecimalPlaces(dp);
  const w = weights.map(D);
  const wSum = sum(w);
  if (w.length === 0) return [];
  if (wSum.isZero()) throw new Error('Cannot allocate: all allocation weights are zero');
  const unit = new Decimal(10).pow(-dp);
  const raw = w.map((x) => t.times(x).div(wSum));
  const floored = raw.map((r) => r.toDecimalPlaces(dp, Decimal.ROUND_DOWN));
  let remainder = t.minus(sum(floored));
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(floored[i]) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const out = [...floored];
  let k = 0;
  while (remainder.greaterThan(0) && order.length > 0) {
    out[order[k % order.length].i] = out[order[k % order.length].i].plus(unit);
    remainder = remainder.minus(unit);
    k++;
  }
  return out;
}

export function formatMoney(v: Num, currency = 'EUR', opts: { decimals?: number; compact?: boolean } = {}) {
  if (v === null || v === undefined || v === '') return '—';
  const n = D(v).toNumber();
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: opts.compact ? 0 : (opts.decimals ?? 2),
    maximumFractionDigits: opts.compact ? 1 : (opts.decimals ?? 2),
    notation: opts.compact ? 'compact' : 'standard',
  }).format(n);
}

export function formatPct(v: Num | Decimal | null, dp = 1) {
  if (v === null || v === undefined || v === '') return '—';
  return `${D(v as Num).toDecimalPlaces(dp).toFixed(dp)}%`;
}

export function formatQty(v: Num) {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(D(v).toNumber());
}
