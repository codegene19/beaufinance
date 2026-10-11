'use client';
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export type FilterDef =
  | { type: 'search'; name: string; placeholder?: string }
  | { type: 'select'; name: string; label: string; options: { value: string; label: string }[] }
  | { type: 'date'; name: string; label: string };

/** Search & filters synced to the URL so results are shareable and survive refresh. */
export function FilterBar({ filters }: { filters: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const set = (name: string, value: string) => {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(name, value);
    else p.delete(name);
    p.delete('page');
    router.push(`${pathname}?${p.toString()}`);
  };
  React.useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) set('q', q);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const active = filters.some((f) => params.get(f.name));
  return (
    <div className="no-print flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
      {filters.map((f) =>
        f.type === 'search' ? (
          <div key={f.name} className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={f.placeholder ?? 'Search…'} className="h-9 pl-9" />
          </div>
        ) : f.type === 'select' ? (
          <Select key={f.name} aria-label={f.label} value={params.get(f.name) ?? ''} onChange={(e) => set(f.name, e.target.value)} className="h-9 w-auto min-w-[150px]">
            <option value="">{f.label}: all</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <label key={f.name} className="flex items-center gap-1.5 text-xs text-muted">
            {f.label}
            <Input type="date" value={params.get(f.name) ?? ''} onChange={(e) => set(f.name, e.target.value)} className="h-9 w-[150px]" />
          </label>
        ),
      )}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ('');
            router.push(pathname);
          }}
        >
          <X /> Clear
        </Button>
      )}
    </div>
  );
}

export function PeriodPicker({ withBucket = true, defaultPreset = 'last90' }: { withBucket?: boolean; defaultPreset?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const preset = params.get('period') ?? defaultPreset;
  const go = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) v ? p.set(k, v) : p.delete(k);
    router.push(`${pathname}?${p.toString()}`);
  };
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <Select aria-label="Reporting period" value={preset} onChange={(e) => go({ period: e.target.value, from: null, to: null })} className="h-9 w-auto">
        <option value="today">Today</option>
        <option value="last7">Last 7 days</option>
        <option value="last30">Last 30 days</option>
        <option value="mtd">This month</option>
        <option value="last90">Last 90 days</option>
        <option value="qtd">This quarter</option>
        <option value="ytd">Year to date</option>
        <option value="last365">Last 12 months</option>
        <option value="all">All time</option>
        <option value="custom">Custom…</option>
      </Select>
      {preset === 'custom' && (
        <>
          <Input type="date" aria-label="From" value={params.get('from') ?? ''} onChange={(e) => go({ from: e.target.value })} className="h-9 w-[150px]" />
          <Input type="date" aria-label="To" value={params.get('to') ?? ''} onChange={(e) => go({ to: e.target.value })} className="h-9 w-[150px]" />
        </>
      )}
      {withBucket && (
        <Select aria-label="Group by" value={params.get('bucket') ?? 'week'} onChange={(e) => go({ bucket: e.target.value })} className="h-9 w-auto">
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
          <option value="quarter">Quarterly</option>
        </Select>
      )}
    </div>
  );
}
