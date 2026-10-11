import Link from 'next/link';
import { tenant, getAppContext } from '@/lib/app-context';
import { listVariants } from '@/lib/services/products';
import { defaultSaleTaxRate } from '@/lib/services/business';
import { marketingAnalysis } from '@/lib/services/marketing';
import { orderFacts } from '@/lib/services/facts';
import { PageHeader } from '@/components/ui/misc';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { fmtDate } from '@/components/app/money';
import { PricingCalculator, type VariantOpt } from './calculator';
import { D } from '@/lib/calc/money';

export const metadata = { title: 'Pricing calculator' };

export default async function Pricing({ searchParams }: { searchParams: Promise<{ variant?: string; sku?: string }> }) {
  const sp = await searchParams;
  const ctx = await getAppContext();
  const s = ctx.settings;
  const data = await tenant(async (tx) => {
    const variants = await listVariants(tx);
    const vat = await defaultSaleTaxRate(tx);
    const mk = await marketingAnalysis(tx, {});
    const facts = await orderFacts(tx, {});
    const channels = await tx.many('select id, name, commission_pct, commission_fixed from sales_channels where business_id = $1 and is_active order by name', [tx.businessId]);
    const sims = await tx.many(`select ps.*, v.sku from price_simulations ps left join product_variants v on v.id = ps.variant_id where ps.business_id = $1 order by ps.created_at desc limit 20`, [tx.businessId]);
    const oneTime = await tx.one<{ startup: string; prelaunch: string }>(
      `select (select coalesce(sum(amount_base),0) from expenses where business_id = $1 and treatment = 'startup' and commitment = 'committed') as startup,
              (select coalesce(sum(e.amount_base),0) from expenses e join campaigns c on c.id = e.campaign_id where e.business_id = $1 and c.is_prelaunch and e.commitment = 'committed') as prelaunch`, [tx.businessId]);
    return { variants, vat, mk, facts, channels, sims, oneTime };
  });
  const opts: VariantOpt[] = data.variants.map((v) => {
    const deliveredOrders = data.facts.filter((f) => f.delivered && f.items.some((i) => i.variantId === v.id)).length;
    const orders = data.facts.filter((f) => f.items.some((i) => i.variantId === v.id));
    const returned = orders.filter((f) => f.items.some((i) => i.variantId === v.id && i.unitsReturned > 0)).length;
    const ads = data.mk.perVariantAds.get(v.id);
    return {
      id: v.id, label: `${v.product_name} — ${v.variant_name} (${v.sku})`, landed: v.current_landed_cost, landedSource: v.current_landed_cost ? (v.on_hand > 0 ? 'weighted average of lots on hand' : 'latest received lot') : 'not received yet — enter an estimate',
      packaging: v.packaging_cost ?? s.default_packaging_cost, price: v.default_selling_price, priceIncl: v.selling_price_includes_tax, target: v.target_margin_pct ?? s.default_target_margin_pct,
      adPerOrder: ads && deliveredOrders ? ads.div(deliveredOrders).toDecimalPlaces(2).toString() : '0',
      returnRate: orders.length >= 10 ? D(returned).div(orders.length).times(100).toDecimalPlaces(1).toString() : '0',
      startupPerUnit: s.startup_cost_spread_units ? D(data.oneTime.startup).div(s.startup_cost_spread_units).toDecimalPlaces(2).toString() : null,
      prelaunchPerUnit: s.prelaunch_marketing_spread_units ? D(data.oneTime.prelaunch).div(s.prelaunch_marketing_spread_units).toDecimalPlaces(2).toString() : null,
    };
  });
  const initial = sp.variant || data.variants.find((v) => v.sku === sp.sku)?.id;
  return (
    <>
      <PageHeader title="Selling price calculator" description="Find break-even, minimum, recommended and premium prices from your real landed costs, fees, VAT, returns and advertising." actions={<Link className="text-sm text-sage-700 hover:underline" href="/profitability">Product profitability →</Link>} />
      <PricingCalculator variants={opts} channels={data.channels as any} settings={s} vat={String(Number(data.vat))} currency={ctx.business.base_currency} initialVariant={initial} />
      {data.sims.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Saved simulations" />
          <Table><THead><tr><Th>Name</Th><Th>SKU</Th><Th>Saved</Th><Th right>Conservative</Th><Th right>Recommended</Th><Th right>Premium</Th></tr></THead>
            <tbody>{data.sims.map((x: any) => (
              <Tr key={x.id}><Td className="font-medium">{x.name}</Td><Td muted>{x.sku ?? '—'}</Td><Td muted>{fmtDate(x.created_at)}</Td>
                {['conservative', 'recommended', 'premium'].map((k) => <Td key={k} right>{x.results?.[k]?.price ?? '—'} <span className="text-xs text-muted">{x.results?.[k]?.margin ? `${x.results[k].margin}%` : ''}</span></Td>)}</Tr>
            ))}</tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
