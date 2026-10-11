import * as React from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'sage' | 'gold' | 'amber' | 'rose' | 'sky' | 'ink';
const tones: Record<Tone, string> = {
  neutral: 'bg-ivory-deep text-ink-soft border-line',
  sage: 'bg-sage-50 text-sage-700 border-sage-200',
  gold: 'bg-champagne-100 text-champagne-700 border-champagne-300',
  amber: 'bg-amber-50 text-amber-700 border-champagne-300',
  rose: 'bg-rose-50 text-rose-700 border-rose-600/25',
  sky: 'bg-sky-50 text-sky-700 border-sky-700/20',
  ink: 'bg-ink text-white border-ink',
};

export function Badge({ tone = 'neutral', className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  draft: 'neutral', active: 'sage', discontinued: 'neutral', ordered: 'sky', partially_paid: 'amber', paid: 'sage', in_production: 'sky', shipped: 'sky', received: 'sage', cancelled: 'neutral',
  planned: 'neutral', booked: 'sky', in_transit: 'sky', at_customs: 'amber', cleared: 'sky', delivered: 'sage',
  pending: 'neutral', confirmed: 'sky', processing: 'sky', returned: 'amber', unpaid: 'amber', refunded: 'rose', partially_refunded: 'amber',
  committed: 'sky', healthy: 'sage', plan: 'sky', order_soon: 'amber', urgent: 'rose', insufficient_data: 'neutral',
  profitable: 'sage', below_target: 'amber', break_even: 'gold', unprofitable: 'rose', on_target: 'sage', below_minimum: 'amber', below_break_even: 'rose', unknown: 'neutral',
};
const STATUS_LABELS: Record<string, string> = {
  order_soon: 'Order soon', plan: 'Plan next order', insufficient_data: 'Not enough data', below_target: 'Below target margin', break_even: 'Break-even', on_target: 'On target',
  below_minimum: 'Below minimum margin', below_break_even: 'Below break-even', partially_paid: 'Partially paid', partially_refunded: 'Partially refunded', in_production: 'In production', in_transit: 'In transit', at_customs: 'At customs', unknown: 'No price / cost',
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return null;
  const label = STATUS_LABELS[status] ?? status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} dot className={className}>
      {label}
    </Badge>
  );
}
