import Link from 'next/link';
import { Download, FileSpreadsheet, Eye } from 'lucide-react';
import { tenant } from '@/lib/app-context';
import { REPORTS } from '@/lib/services/reports';
import { PageHeader } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { FilterBar } from '@/components/app/filters';

export const metadata = { title: 'Reports' };

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const refs = await tenant(async (tx) => ({
    variants: await tx.many<{ id: string; label: string }>(`select v.id, v.sku || ' — ' || p.name as label from product_variants v join products p on p.id = v.product_id where v.business_id = $1 order by 2`, [tx.businessId]),
    suppliers: await tx.many<{ id: string; name: string }>('select id, name from suppliers where business_id = $1 order by name', [tx.businessId]),
    shipments: await tx.many<{ id: string; reference: string }>('select id, reference from shipments where business_id = $1 order by created_at desc', [tx.businessId]),
    channels: await tx.many<{ id: string; name: string }>('select id, name from sales_channels where business_id = $1 order by name', [tx.businessId]),
    campaigns: await tx.many<{ id: string; name: string }>('select id, name from campaigns where business_id = $1 order by name', [tx.businessId]),
  }));
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => typeof v === 'string' && v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Reports" description="Download CSV or Excel, or open a printable view to save as PDF. Filters apply where relevant to each report." />
      <Card className="mb-4">
        <FilterBar filters={[
          { type: 'date', name: 'from', label: 'From' }, { type: 'date', name: 'to', label: 'To' },
          { type: 'select', name: 'variant', label: 'Product / SKU', options: refs.variants.map((v) => ({ value: v.id, label: v.label })) },
          { type: 'select', name: 'supplier', label: 'Supplier', options: refs.suppliers.map((v) => ({ value: v.id, label: v.name })) },
          { type: 'select', name: 'shipment', label: 'Shipment', options: refs.shipments.map((v) => ({ value: v.id, label: v.reference })) },
          { type: 'select', name: 'channel', label: 'Channel', options: refs.channels.map((v) => ({ value: v.id, label: v.name })) },
          { type: 'select', name: 'campaign', label: 'Campaign', options: refs.campaigns.map((v) => ({ value: v.id, label: v.name })) },
        ]} />
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card className="flex flex-col justify-between border-sage-200 bg-sage-50 p-5">
          <div><h3 className="font-semibold">Profit & loss statement</h3><p className="mt-1 text-sm text-muted">Polished P&L for the selected period, ready to print or save as PDF.</p></div>
          <div className="mt-4 flex gap-2 text-sm"><Link className="inline-flex items-center gap-1 font-medium text-sage-700 hover:underline" href={`/reports/pnl?${qs}`}><Eye className="size-4" /> Open</Link></div>
        </Card>
        {REPORTS.map((r) => (
          <Card key={r.key} className="flex flex-col justify-between p-5">
            <div><h3 className="font-semibold">{r.title}</h3><p className="mt-1 text-sm text-muted">{r.description}</p></div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <Link className="inline-flex items-center gap-1 font-medium text-sage-700 hover:underline" href={`/reports/${r.key}?${qs}`}><Eye className="size-4" /> View / PDF</Link>
              <a className="inline-flex items-center gap-1 text-ink-soft hover:underline" href={`/api/export/${r.key}?${qs}`}><Download className="size-4" /> CSV</a>
              <a className="inline-flex items-center gap-1 text-ink-soft hover:underline" href={`/api/export/${r.key}?format=xlsx&${qs}`}><FileSpreadsheet className="size-4" /> Excel</a>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
