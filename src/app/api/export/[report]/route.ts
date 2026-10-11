import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { tenant, getAppContext } from '@/lib/app-context';
import { buildReport, type Report } from '@/lib/services/reports';
import { listOrders } from '@/lib/services/sales';

export const runtime = 'nodejs';

function csvCell(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(r: Report) {
  const lines = [r.columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => csvCell(row[c.key])).join(','));
  return '﻿' + lines.join('\r\n'); // BOM so Excel opens UTF-8 correctly
}

async function toXlsx(r: Report, business: string, currency: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BeauFinance';
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([`${business} — ${r.title}`]).font = { bold: true, size: 14 };
  ws.addRow([`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · amounts in ${currency} unless stated · management figures, not tax filings`]).font = { italic: true, color: { argb: 'FF6F7275' } };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B563F' } }));
  for (const row of r.rows) ws.addRow(r.columns.map((c) => row[c.key] ?? null));
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(40, Math.max(12, c.label.length + 2));
    if (c.type === 'money') col.numFmt = '#,##0.00';
    if (c.type === 'pct') col.numFmt = '0.0"%"';
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const ctx = await getAppContext();
  const sp = req.nextUrl.searchParams;
  const g = (k: string) => sp.get(k) || null;
  const filters = { from: g('from'), to: g('to'), variantId: g('variant'), supplierId: g('supplier'), shipmentId: g('shipment'), channelId: g('channel'), campaignId: g('campaign') };
  let r: Report;
  try {
    if (report === 'sales' && (sp.get('q') || sp.get('status') || sp.get('paymentStatus'))) {
      const rows = await tenant((tx) => listOrders(tx, { q: g('q') ?? undefined, status: g('status') ?? undefined, paymentStatus: g('paymentStatus') ?? undefined, from: g('from') ?? undefined, to: g('to') ?? undefined, limit: 100000 }));
      const full = await tenant((tx) => buildReport(tx, 'sales', filters));
      const ids = new Set(rows.map((x) => x.order_number));
      r = { ...full, rows: full.rows.filter((x) => ids.has(x.order as string)) };
    } else r = await tenant((tx) => buildReport(tx, report, filters));
  } catch {
    return NextResponse.json({ error: 'Unknown report' }, { status: 404 });
  }
  const name = `${report}-${new Date().toISOString().slice(0, 10)}`;
  if (sp.get('format') === 'xlsx') {
    const buf = await toXlsx(r, ctx.business.name, ctx.business.base_currency);
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"`, 'Cache-Control': 'no-store' } });
  }
  return new NextResponse(toCsv(r), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Cache-Control': 'no-store' } });
}
