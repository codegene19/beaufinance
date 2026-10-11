import * as React from 'react';
import Link from 'next/link';
import { cn } from './cn';
import { Card } from './card';
import { Info, AlertTriangle, ChevronRight } from 'lucide-react';

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-champagne-700">{eyebrow}</div>}
        <h1 className="font-display text-3xl font-semibold leading-tight text-ink sm:text-[2.1rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-sage-50 text-sage-600 [&_svg]:size-6">{icon}</div>}
      <h3 className="font-display text-xl font-semibold text-ink">{title}</h3>
      {children && <div className="mt-2 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  href,
  tone = 'default',
  hint,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning' | 'estimate';
  hint?: string;
}) {
  const inner = (
    <Card className={cn('h-full p-4 transition-colors', href && 'hover:border-sage-400')}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12px] font-medium uppercase tracking-wide text-muted" title={hint}>
          {label}
        </div>
        {href && <ChevronRight className="size-4 text-line-strong" />}
      </div>
      <div
        className={cn(
          'num mt-2 text-[1.55rem] font-semibold leading-none tracking-tight',
          tone === 'positive' && 'text-sage-700',
          tone === 'negative' && 'text-rose-600',
          tone === 'warning' && 'text-amber-700',
          tone === 'estimate' && 'text-ink-soft italic',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block focus-visible:rounded-[var(--radius-card)]">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function Callout({ tone = 'info', title, children, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const styles = {
    info: 'border-sky-700/20 bg-sky-50 text-sky-700',
    warning: 'border-champagne-300 bg-amber-50 text-amber-700',
    danger: 'border-rose-600/25 bg-rose-50 text-rose-700',
    success: 'border-sage-200 bg-sage-50 text-sage-700',
  }[tone];
  const Icon = tone === 'info' || tone === 'success' ? Info : AlertTriangle;
  return (
    <div className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', styles, className)} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        <div className={cn(title && 'mt-0.5', 'text-[13px] leading-relaxed [&_a]:underline')}>{children}</div>
      </div>
    </div>
  );
}

export function KV({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-4 border-b border-line/60 pb-2">
          <dt className="text-muted">{k}</dt>
          <dd className="num text-right font-medium text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn('mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-champagne-700', className)}>{children}</h3>;
}

export function EstimateTag() {
  return <span className="ml-1 rounded bg-champagne-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-champagne-700">Estimate</span>;
}
