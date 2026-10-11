import Link from 'next/link';
import { tenant, getAppContext } from '@/lib/app-context';
import { reorderPlan, listPurchaseScenarios } from '@/lib/services/reorder';
import { defaultSaleTaxRate } from '@/lib/services/business';
import { PageHeader, Callout } from '@/components/ui/misc';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { fmtDate } from '@/components/app/money';
import { Planner } from './planner';
import { toExVat } from '@/lib/calc/pricing';

export const metadata = { title: 'Purchase planner' };

export default async function PlannerPage({ params }: { params: Promise<{ variantId: string }> }) {
  const { variantId } = await params;
  const ctx = await getAppContext();
  const data = await tenant(async (tx) => ({ plan: await reorderPlan(tx, { variantId }), scenarios: await listPurchaseScenarios(tx, variantId), vat: await defaultSaleTaxRate(tx) }));
  const row = data.plan.results[0];
  if (!row) return <Callout tone="warning">Product not found.</Callout>;
  const v = row.variant;
  return (
    <>
      <PageHeader eyebrow={<Link href="/reorder" className="hover:underline">Reorder planning</Link>} title={`Next bulk order · ${v.product_name} — ${v.variant_name}`} description={`${v.sku} · supplier ${v.supplier_name ?? 'not set'} · ${v.supplier_unit_price} ${v.purchase_currency} per unit`} />
      {row.notes.map((n, i) => <Callout key={i} tone="warning" className="mb-3">{n}</Callout>)}
      <Planner
        base={JSON.parse(JSON.stringify(row.inputs))}
        variantId={variantId}
        supplierPrice={String(Number(v.supplier_unit_price))}
        purchaseCurrency={v.purchase_currency}
        fx={row.fxRate}
        histExtra={row.historicalExtraPerUnit?.toString() ?? null}
        currency={ctx.business.base_currency}
        sellPriceExVat={v.default_selling_price ? toExVat(v.default_selling_price, v.selling_price_includes_tax, data.vat).toFixed(2) : null}
        minReserve={ctx.settings.min_cash_reserve}
      />
      {data.scenarios.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Saved scenarios" />
          <Table><THead><tr><Th>Name</Th><Th>Saved</Th><Th right>Qty</Th><Th right>Total landed</Th><Th right>Deposit</Th><Th>Affordable</Th></tr></THead>
            <tbody>{data.scenarios.map((s: any) => <Tr key={s.id}><Td className="font-medium">{s.name}</Td><Td muted>{fmtDate(s.created_at)}</Td><Td right>{s.results.qty}</Td><Td right>{s.results.totalLanded}</Td><Td right>{s.results.deposit}</Td><Td>{s.results.affordable === null ? 'unknown' : s.results.affordable ? 'yes' : 'no'}</Td></Tr>)}</tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
