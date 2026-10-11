import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, FileSpreadsheet } from 'lucide-react';
import { tenant, getAppContext } from '@/lib/app-context';
import { buildReport, REPORTS } from '@/lib/services/reports';
import { PageHeader } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { Money, Pct, fmtDate } from '@/components/app/money';
import { PrintButton } from '../print-button';

export const metadata = { title: 'Report' };

export default async function ReportView({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params;
  if (!REPORTS.some((r) => r.key === key)) notFound();
  const p = await searchParams;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const r = await tenant((tx) => buildReport(tx, key, { from: p.from, to: p.to, variantId: p.variant, supplierId: p.supplier, shipmentId: p.shipment, channelId: p.channel, campaignId: p.campaign }));
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader eyebrow={<Link href={`/reports?${qs}`} className="hover:underline no-print">Reports</Link>} title={r.title} description={`${ctx.business.name} · ${p.from ?? 'start'} → ${p.to ?? 'today'} · ${r.rows.length} rows · amounts in ${cur} unless stated`}
        actions={<><PrintButton /><Button asChild variant="secondary" size="sm"><a href={`/api/export/${key}?${qs}`}><Download /> CSV</a></Button><Button asChild variant="secondary" size="sm"><a href={`/api/export/${key}?format=xlsx&${qs}`}><FileSpreadsheet /> Excel</a></Button></>} />
      <Card>
        {r.rows.length === 0 ? <p className="p-6 text-sm text-muted">No data for these filters.</p> : (
          <Table>
            <THead><tr>{r.columns.map((c) => <Th key={c.key} right={c.type === 'money' || c.type === 'number' || c.type === 'pct'}>{c.label}</Th>)}</tr></THead>
            <tbody>{r.rows.slice(0, 2000).map((row, i) => (
              <Tr key={i}>{r.columns.map((c) => {
                const v = row[c.key] as any;
                return <Td key={c.key} right={c.type === 'money' || c.type === 'number' || c.type === 'pct'}>{c.type === 'money' ? <Money value={v} currency={cur} /> : c.type === 'pct' ? <Pct value={v} /> : c.type === 'date' ? fmtDate(v) : v ?? '—'}</Td>;
              })}</Tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      {r.rows.length > 2000 && <p className="mt-2 text-xs text-muted">Showing the first 2,000 rows. Download CSV or Excel for the full report.</p>}
    </>
  );
}
