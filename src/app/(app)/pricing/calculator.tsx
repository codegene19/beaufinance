'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Save, Check } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Callout, EstimateTag } from '@/components/ui/misc';
import { Field } from '@/components/app/form';
import { evaluatePrice, solvePriceForMargin, breakEvenPrice, charmRoundUp, marginStatus, type PricingInputs } from '@/lib/calc/pricing';
import { D, formatMoney, formatPct, Decimal } from '@/lib/calc/money';
import { savePriceSimulationAction, applyPriceAction } from '@/app/actions/operations';

export type VariantOpt = {
  id: string; label: string; landed: string | null; landedSource: string; packaging: string; price: string | null; priceIncl: boolean; target: string;
  adPerOrder: string; returnRate: string; startupPerUnit: string | null; prelaunchPerUnit: string | null;
};
type Ch = { id: string; name: string; commission_pct: string; commission_fixed: string };

const ok = (s: string) => /^-?\d*\.?\d+$/.test(s.trim());
const clean = (v: unknown) => (v === null || v === undefined || v === '' ? '0' : ok(String(v)) ? String(Number(v)) : String(v));

export function PricingCalculator({ variants, channels, settings, vat, currency, initialVariant }: { variants: VariantOpt[]; channels: Ch[]; settings: any; vat: string; currency: string; initialVariant?: string }) {
  const router = useRouter();
  const [vid, setVid] = React.useState(initialVariant ?? variants[0]?.id ?? '');
  const v = variants.find((x) => x.id === vid);
  const init = (x?: VariantOpt) => ({
    landedUnitCost: x?.landed ? D(x.landed).toDecimalPlaces(4).toString() : '0', packagingPerUnit: clean(x?.packaging ?? settings.default_packaging_cost),
    fulfillmentPerOrder: clean(settings.default_fulfillment_cost), shippingPerOrder: clean(settings.default_shipping_cost), customerShippingRevenue: clean('0'), unitsPerOrder: clean('1'),
    paymentFeePct: clean(settings.default_payment_fee_pct), paymentFeeFixed: clean(settings.default_payment_fee_fixed), marketplaceFeePct: clean('0'), marketplaceFeeFixed: clean('0'),
    adCostPerOrder: clean(x?.adPerOrder ?? '0'), returnRatePct: clean(x?.returnRate ?? '0'), returnCostPerReturn: clean('4.90'), returnResellablePct: clean('80'), discountPct: clean('0'), vatRatePct: clean(vat),
    targetMarginPct: clean(x?.target ?? settings.default_target_margin_pct), minMarginPct: clean(settings.min_acceptable_margin_pct), premiumUplift: clean(settings.premium_margin_uplift_pct),
  });
  const [f, setF] = React.useState<Record<string, string>>(init(v));
  const [feesOnGross, setFeesOnGross] = React.useState(settings.fee_basis === 'gross_incl_tax');
  const [displayIncl, setDisplayIncl] = React.useState(settings.price_tax_mode === 'tax_inclusive');
  const [volumes, setVolumes] = React.useState('100, 500, 1000');
  React.useEffect(() => { setF(init(v)); }, [vid]); // eslint-disable-line react-hooks/exhaustive-deps

  const bad = Object.entries(f).filter(([k, val]) => !ok(String(val)) && k !== 'unitsPerOrder');
  const inputs: PricingInputs = {
    landedUnitCost: ok(f.landedUnitCost) ? f.landedUnitCost : 0, packagingPerUnit: ok(f.packagingPerUnit) ? f.packagingPerUnit : 0, fulfillmentPerOrder: ok(f.fulfillmentPerOrder) ? f.fulfillmentPerOrder : 0,
    shippingPerOrder: ok(f.shippingPerOrder) ? f.shippingPerOrder : 0, customerShippingRevenue: ok(f.customerShippingRevenue) ? f.customerShippingRevenue : 0, unitsPerOrder: Math.max(1, parseInt(f.unitsPerOrder) || 1),
    paymentFeePct: ok(f.paymentFeePct) ? f.paymentFeePct : 0, paymentFeeFixed: ok(f.paymentFeeFixed) ? f.paymentFeeFixed : 0, marketplaceFeePct: ok(f.marketplaceFeePct) ? f.marketplaceFeePct : 0,
    marketplaceFeeFixed: ok(f.marketplaceFeeFixed) ? f.marketplaceFeeFixed : 0, adCostPerOrder: ok(f.adCostPerOrder) ? f.adCostPerOrder : 0, returnRatePct: ok(f.returnRatePct) ? f.returnRatePct : 0,
    returnCostPerReturn: ok(f.returnCostPerReturn) ? f.returnCostPerReturn : 0, returnResellablePct: ok(f.returnResellablePct) ? f.returnResellablePct : 0, discountPct: ok(f.discountPct) ? f.discountPct : 0,
    vatRatePct: ok(f.vatRatePct) ? f.vatRatePct : 0, feesOnGross,
  };
  const vatF = D(inputs.vatRatePct as any).div(100).plus(1);
  const show = (exVat: Decimal | null) => (exVat === null ? null : displayIncl ? exVat.times(vatF) : exVat);
  const toEx = (p: string) => (displayIncl ? D(p).div(vatF) : D(p));
  const be = breakEvenPrice(inputs);
  const minP = solvePriceForMargin(inputs, f.minMarginPct);
  const tgt = solvePriceForMargin(inputs, f.targetMarginPct);
  const prem = solvePriceForMargin(inputs, D(ok(f.targetMarginPct) ? f.targetMarginPct : 0).plus(D(ok(f.premiumUplift) ? f.premiumUplift : 0)));
  const recommendedDisplay = tgt ? (displayIncl ? charmRoundUp(tgt.times(vatF)) : tgt.toDecimalPlaces(2, Decimal.ROUND_UP)) : null;

  const [scen, setScen] = React.useState<{ conservative: string; recommended: string; premium: string }>({ conservative: '', recommended: '', premium: '' });
  React.useEffect(() => {
    setScen({
      conservative: minP ? show(minP)!.toDecimalPlaces(2, Decimal.ROUND_UP).toString() : '',
      recommended: recommendedDisplay ? recommendedDisplay.toString() : '',
      premium: prem ? (displayIncl ? charmRoundUp(prem.times(vatF)) : prem.toDecimalPlaces(2, Decimal.ROUND_UP)).toString() : '',
    });
  }, [vid, displayIncl, minP?.toString(), recommendedDisplay?.toString(), prem?.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  const vols = volumes.split(/[,\s]+/).map((x) => parseInt(x)).filter((x) => x > 0).slice(0, 5);
  const scenarios = (['conservative', 'recommended', 'premium'] as const).map((k) => {
    const p = scen[k];
    const r = ok(p) ? evaluatePrice(inputs, toEx(p)) : null;
    return { k, p, r, status: r ? marginStatus(r.marginPct, f.minMarginPct, f.targetMarginPct) : 'unknown' };
  });
  const current = v?.price ? evaluatePrice(inputs, v.priceIncl ? D(v.price).div(vatF) : D(v.price)) : null;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const money = (x: Decimal | null | undefined) => (x === null || x === undefined ? '—' : formatMoney(x, currency));
  const num = (k: string, label: string, hint?: string, suffix?: string) => (
    <Field label={label} hint={hint} error={!ok(String(f[k])) ? 'Enter a number' : undefined}>
      <div className="relative"><Input inputMode="decimal" value={f[k]} onChange={set(k)} className={suffix ? 'pr-8' : ''} />{suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}</div>
    </Field>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Product & assumptions" description="Pre-filled from your records — every input is editable." />
          <CardBody className="space-y-4">
            <Field label="Product / variant">
              <Select value={vid} onChange={(e) => setVid(e.target.value)}><option value="">Custom (no product)</option>{variants.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
            </Field>
            {v && <p className="text-xs text-muted">Landed cost source: {v.landedSource}</p>}
            <div className="grid grid-cols-2 gap-3">
              {num('landedUnitCost', 'Landed cost / unit', undefined, currency)}
              {num('packagingPerUnit', 'Packaging / unit')}
              {num('fulfillmentPerOrder', 'Fulfilment / order')}
              {num('shippingPerOrder', 'Shipping you pay / order')}
              {num('customerShippingRevenue', 'Shipping charged (incl. VAT)')}
              <Field label="Units per order"><Input type="number" min={1} value={f.unitsPerOrder} onChange={set('unitsPerOrder')} /></Field>
              {num('paymentFeePct', 'Payment fee', undefined, '%')}
              {num('paymentFeeFixed', 'Payment fixed fee')}
              {num('marketplaceFeePct', 'Platform commission', undefined, '%')}
              {num('marketplaceFeeFixed', 'Platform fixed fee')}
            </div>
            {channels.length > 0 && (
              <Field label="Apply channel commission">
                <Select defaultValue="" onChange={(e) => { const c = channels.find((x) => x.id === e.target.value); if (c) setF({ ...f, marketplaceFeePct: String(Number(c.commission_pct)), marketplaceFeeFixed: String(Number(c.commission_fixed)) }); }}>
                  <option value="">Choose a channel…</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name} ({Number(c.commission_pct)}%)</option>)}
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              {num('adCostPerOrder', 'Ad cost / delivered order', v ? 'From actual campaign allocation' : undefined)}
              {num('discountPct', 'Average discount', undefined, '%')}
              {num('returnRatePct', 'Return / refund rate', v ? 'From your history' : undefined, '%')}
              {num('returnCostPerReturn', 'Cost per return')}
              {num('returnResellablePct', 'Returns resellable', undefined, '%')}
              {num('vatRatePct', 'VAT / sales tax', 'From Settings › Tax', '%')}
            </div>
            <Checkbox checked={feesOnGross} onChange={(e) => setFeesOnGross(e.target.checked)} label="Percentage fees are charged on the VAT-inclusive amount" hint="True for most card processors and marketplaces." />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Targets" />
          <CardBody className="grid grid-cols-3 gap-3">
            {num('minMarginPct', 'Minimum', undefined, '%')}
            {num('targetMarginPct', 'Target', undefined, '%')}
            {num('premiumUplift', 'Premium +', undefined, '%')}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4">
        {bad.length > 0 && <Callout tone="warning">Some inputs are not valid numbers and are treated as 0: {bad.map(([k]) => k).join(', ')}.</Callout>}
        {D(inputs.landedUnitCost as any).isZero() && <Callout tone="warning" title="No landed cost">This product has not been received yet. Enter an estimated landed cost — results are estimates until goods arrive.</Callout>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted">All results are <strong>estimates</strong> per unit / order — not actual profit.</div>
          <div className="flex rounded-lg border border-line p-0.5 text-sm" role="group" aria-label="Price display">
            <button className={`rounded-md px-3 py-1 ${displayIncl ? 'bg-sage-700 text-white' : 'text-muted'}`} onClick={() => setDisplayIncl(true)}>Prices incl. VAT</button>
            <button className={`rounded-md px-3 py-1 ${!displayIncl ? 'bg-sage-700 text-white' : 'text-muted'}`} onClick={() => setDisplayIncl(false)}>Prices excl. VAT</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Break-even price', show(be), 'Contribution after ads = 0'],
            [`Minimum (${f.minMarginPct}% margin)`, show(minP), 'Conservative floor'],
            [`Target (${f.targetMarginPct}% margin)`, show(tgt), recommendedDisplay ? `Recommended: ${money(recommendedDisplay)}` : 'Unreachable with these fees'],
            ['Premium', show(prem), `${D(ok(f.targetMarginPct) ? f.targetMarginPct : 0).plus(D(ok(f.premiumUplift) ? f.premiumUplift : 0))}% margin`],
          ].map(([label, val, sub]: any) => (
            <Card key={label} className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
              <div className="num mt-1.5 text-2xl font-semibold">{val ? money(val) : <span className="text-base text-rose-600">Not reachable</span>}</div>
              <div className="mt-1 text-xs text-muted">{sub} · {displayIncl ? 'incl.' : 'excl.'} VAT</div>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader title="Compare scenarios" description="Edit any price; everything recalculates instantly." action={<EstimateTag />} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="px-4 py-2" />{scenarios.map((s) => <th key={s.k} className="px-4 py-2 text-right capitalize">{s.k}</th>)}{current && <th className="px-4 py-2 text-right">Current price</th>}</tr></thead>
              <tbody className="num">
                <tr className="border-b border-line"><td className="px-4 py-2 text-muted">Selling price ({displayIncl ? 'incl.' : 'excl.'} VAT)</td>{scenarios.map((s) => <td key={s.k} className="px-4 py-2 text-right"><Input inputMode="decimal" value={s.p} onChange={(e) => setScen({ ...scen, [s.k]: e.target.value })} className="ml-auto h-8 w-28 text-right" aria-label={`${s.k} price`} /></td>)}{current && <td className="px-4 py-2 text-right">{money(show(current.priceExVat))}</td>}</tr>
                {([
                  ['Price excl. VAT', (r: any) => money(r.priceExVat)],
                  ['Net revenue / order (after refunds)', (r: any) => money(r.netRevenuePerOrder)],
                  ['Product cost', (r: any) => money(r.costs.product.negated())],
                  ['Packaging, fulfilment, shipping', (r: any) => money(r.costs.packaging.plus(r.costs.fulfillment).plus(r.costs.shipping).negated())],
                  ['Payment & platform fees', (r: any) => money(r.costs.paymentFees.plus(r.costs.marketplaceFees).negated())],
                  ['Returns', (r: any) => money(r.costs.returns.negated())],
                  ['Profit / order before ads', (r: any) => money(r.contributionBeforeAdsPerOrder)],
                  ['Advertising', (r: any) => money(r.costs.advertising.negated())],
                  ['Profit / order after ads & refunds', (r: any) => <strong className={r.contributionPerOrder.lessThan(0) ? 'text-rose-600' : ''}>{money(r.contributionPerOrder)}</strong>],
                  ['Profit / unit', (r: any) => money(r.profitPerUnit)],
                  ['Contribution margin', (r: any) => formatPct(r.marginPct)],
                  ['Markup on landed cost', (r: any) => formatPct(r.markupPct)],
                ] as [string, (r: any) => React.ReactNode][]).map(([label, fn]) => (
                  <tr key={label} className="border-b border-line/60"><td className="px-4 py-2 text-muted">{label}</td>{scenarios.map((s) => <td key={s.k} className="px-4 py-2 text-right">{s.r ? fn(s.r) : '—'}</td>)}{current && <td className="px-4 py-2 text-right">{fn(current)}</td>}</tr>
                ))}
                <tr className="border-b border-line"><td className="px-4 py-2 text-muted">Assessment</td>{scenarios.map((s) => <td key={s.k} className="px-4 py-2 text-right"><StatusBadge status={s.status} /></td>)}{current && <td className="px-4 py-2 text-right"><StatusBadge status={marginStatus(current.marginPct, f.minMarginPct, f.targetMarginPct)} /></td>}</tr>
                {vols.map((n) => (
                  <tr key={n} className="border-b border-line/60 bg-ivory/40"><td className="px-4 py-2 text-muted">Expected profit at {n.toLocaleString('en-GB')} orders</td>{scenarios.map((s) => <td key={s.k} className="px-4 py-2 text-right">{s.r ? money(s.r.contributionPerOrder.times(n)) : '—'}</td>)}{current && <td className="px-4 py-2 text-right">{money(current.contributionPerOrder.times(n))}</td>}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line px-5 py-3">
            <Field label="Sales volumes (orders)"><Input value={volumes} onChange={(e) => setVolumes(e.target.value)} className="h-9 w-56" /></Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={async () => {
                const name = prompt('Name this simulation', `${v?.label ?? 'Custom'} — ${new Date().toLocaleDateString('en-GB')}`);
                if (!name) return;
                const r = await savePriceSimulationAction({ variant_id: vid || null, name, inputs: { ...f, feesOnGross, displayIncl }, results: Object.fromEntries(scenarios.map((s) => [s.k, { price: s.p, margin: s.r?.marginPct?.toFixed(2) ?? null, profitPerOrder: s.r?.contributionPerOrder.toFixed(2) ?? null }])) });
                r.ok ? (toast.success('Simulation saved'), router.refresh()) : toast.error(r.error);
              }}><Save /> Save simulation</Button>
              {v && scen.recommended && ok(scen.recommended) && (
                <Button size="sm" onClick={async () => {
                  if (!confirm(`Set ${v.label} default price to ${scen.recommended} (${displayIncl ? 'incl.' : 'excl.'} VAT)?`)) return;
                  const r = await applyPriceAction(v.id, D(scen.recommended).toFixed(2), displayIncl);
                  r.ok ? (toast.success('Default selling price updated'), router.refresh()) : toast.error(r.error);
                }}><Check /> Use recommended as default price</Button>
              )}
            </div>
          </div>
        </Card>

        {v && (v.startupPerUnit || v.prelaunchPerUnit) && (
          <Card className="p-5 text-sm">
            <div className="mb-1 font-semibold">Fully-loaded view (informational)</div>
            <p className="text-muted">
              Spreading one-time costs over your configured expected units adds about
              {v.startupPerUnit && <> <strong>{money(D(v.startupPerUnit))}</strong> startup cost</>}
              {v.startupPerUnit && v.prelaunchPerUnit && ' and'}
              {v.prelaunchPerUnit && <> <strong>{money(D(v.prelaunchPerUnit))}</strong> pre-launch marketing</>} per unit.
              These are <em>not</em> added to the margins above or to actual profitability, so nothing is counted twice.
            </p>
            {scenarios[1].r && <Badge tone="gold" className="mt-2">Recommended profit/unit after one-time costs: {money(scenarios[1].r.profitPerUnit.minus(D(v.startupPerUnit ?? 0)).minus(D(v.prelaunchPerUnit ?? 0)))}</Badge>}
          </Card>
        )}
        <p className="text-xs leading-relaxed text-muted">
          Formulas — Net revenue = price × units × (1 − discount) + shipping charged (excl. VAT), × (1 − return rate). Contribution = net revenue − landed cost × units × (1 − return rate × resellable share) − packaging − fulfilment − shipping − % fees (on {feesOnGross ? 'VAT-inclusive' : 'VAT-exclusive'} amount) − fixed fees − returns cost − advertising.
          Margin = contribution ÷ net revenue excl. VAT. Markup = profit per unit ÷ landed unit cost. Target prices are solved exactly (contribution is linear in price). Tax settings are configurable and not a statement of compliance.
        </p>
      </div>
    </div>
  );
}
