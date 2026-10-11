import { formatMoney, formatPct, D, type Num } from '@/lib/calc/money';
import { cn } from '@/components/ui/cn';

export function Money({ value, currency = 'EUR', className, signed, compact, decimals }: { value: Num | { toString(): string }; currency?: string; className?: string; signed?: boolean; compact?: boolean; decimals?: number }) {
  if (value === null || value === undefined) return <span className={cn('text-muted', className)}>—</span>;
  const v = D(value.toString());
  return <span className={cn('num', signed && v.lessThan(0) && 'text-rose-600', signed && v.greaterThan(0) && 'text-sage-700', className)}>{formatMoney(v, currency, { compact, decimals })}</span>;
}

export function Pct({ value, className, dp = 1, signed }: { value: Num | { toString(): string } | null; className?: string; dp?: number; signed?: boolean }) {
  if (value === null || value === undefined) return <span className={cn('text-muted', className)}>—</span>;
  const v = D(value.toString());
  return <span className={cn('num', signed && v.lessThan(0) && 'text-rose-600', className)}>{formatPct(v, dp)}</span>;
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
