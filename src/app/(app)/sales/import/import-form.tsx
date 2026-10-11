'use client';
import * as React from 'react';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { importOrdersAction } from '@/app/actions/import';

export function ImportForm({ template }: { template: string }) {
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [result, setResult] = React.useState<any>(null);
  const [pending, start] = React.useTransition();
  const download = () => {
    const url = URL.createObjectURL(new Blob([template], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'orders-template.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card>
      <CardHeader title="Upload" action={<Button variant="secondary" size="sm" onClick={download}>Download template</Button>} />
      <CardBody className="space-y-4">
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" className="block text-sm" onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          Papa.parse<Record<string, string>>(f, { header: true, skipEmptyLines: true, complete: (r) => { setRows(r.data); setResult(null); if (r.errors.length) toast.error(`${r.errors.length} row(s) could not be parsed`); } });
        }} />
        {rows.length > 0 && (
          <>
            <p className="text-sm">{rows.length} rows · {new Set(rows.map((r) => r.order_number)).size} orders detected. Columns: <span className="text-muted">{Object.keys(rows[0]).join(', ')}</span></p>
            <Button disabled={pending} onClick={() => start(async () => { const r = await importOrdersAction(rows); if (r.ok) { setResult(r.data); toast.success(`${r.data.imported} imported, ${r.data.skipped} skipped`); } else toast.error(r.error); })}>{pending ? 'Importing…' : 'Import orders'}</Button>
          </>
        )}
        {result && (
          <div className="rounded-lg border border-line p-4 text-sm">
            <div><strong>{result.imported}</strong> imported · <strong>{result.skipped}</strong> already existed (skipped) · <strong>{result.errors.length}</strong> failed</div>
            {result.errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-rose-600">{result.errors.map((e: any) => <li key={e.order}>{e.order}: {e.error}</li>)}</ul>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
