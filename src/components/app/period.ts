import { formatISO, startOfMonth, startOfQuarter, startOfYear, subDays } from 'date-fns';

export type Bucket = 'day' | 'week' | 'month' | 'quarter';

export function resolvePeriod(sp: Record<string, string | string[] | undefined>, def = 'last90') {
  const g = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const preset = g('period') ?? def;
  const today = new Date();
  const iso = (d: Date) => formatISO(d, { representation: 'date' });
  let from: string | null = null;
  let to: string | null = iso(today);
  switch (preset) {
    case 'today': from = iso(today); break;
    case 'last7': from = iso(subDays(today, 6)); break;
    case 'last30': from = iso(subDays(today, 29)); break;
    case 'mtd': from = iso(startOfMonth(today)); break;
    case 'last90': from = iso(subDays(today, 89)); break;
    case 'qtd': from = iso(startOfQuarter(today)); break;
    case 'ytd': from = iso(startOfYear(today)); break;
    case 'last365': from = iso(subDays(today, 364)); break;
    case 'all': from = null; to = null; break;
    case 'custom': from = g('from') ?? null; to = g('to') ?? null; break;
  }
  const bucket = (g('bucket') as Bucket) ?? (preset === 'today' || preset === 'last7' ? 'day' : preset === 'last365' || preset === 'all' || preset === 'ytd' ? 'month' : 'week');
  const label = { today: 'Today', last7: 'Last 7 days', last30: 'Last 30 days', mtd: 'This month', last90: 'Last 90 days', qtd: 'This quarter', ytd: 'Year to date', last365: 'Last 12 months', all: 'All time', custom: `${from ?? '…'} → ${to ?? '…'}` }[preset] ?? preset;
  return { from, to, bucket, preset, label };
}

export const sp = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : undefined);
