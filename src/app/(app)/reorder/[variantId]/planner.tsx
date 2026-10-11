'use client';
import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Callout, EstimateTag, KV } from '@/components/ui/misc';
import { Field } from '@/components/app/form';
import { LinesChart } from '@/components/app/charts';
import { computeReorder, projectStock, type ReorderInputs } from '@/lib/calc/reorder';
import { D, formatMoney } from '@/lib/calc/money';
import { savePurchaseScenarioAction } from '@/app/actions/operations';

const ok = (s: string) => /^\d*\.?\d+$/.test(s.trim());

export function Planner({ base, variantId, supplierPrice, purchaseCurrency, fx, histExtra, currency, sellPriceExVat, minReserve }: { base: ReorderInputs; variantId: string; supplierPrice: string; purchaseCurrency: string; fx: string | null; histExtra: string | null; currency: string; sellPriceExVat: string | null; minReserve: string }) {
  const auto = computeReorder(base);
  const [s, setS] = React.useState({
    qty: String(auto.suggestedQty || base.minOrderQty || 0), price: supplierPrice, fx: fx ? String(Number(fx)) : '', extra: histExtra ? D(histExtra).toDecimalPlaces(2).toString() : '0',
    deposit: String(Number(base.depositPct)), supplierLead: String(base.supplierLeadDays), shippingLead: String(base.shippingLeadDays), coverage: String(base.targetCoverageDays),
  });
  const set = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value });
  const fxOk = ok(s.fx);
  const inputs: ReorderInputs = {
    ...base,
    orderQtyOverride: parseInt(s.qty) || 0,
    unitPurchaseCost: ok(s.price) && fxOk ? D(s.price).times(D(s.fx)) : 0,
    extraLandedPerUnit: ok(s.extra) ? s.extra : 0,
    depositPct: ok(s.deposit) ? s.deposit : 0,
    supplierLeadDays: parseInt(s.supplierLead) || 0,
    shippingLeadDays: parseInt(s.shippingLead) || 0,
    targetCoverageDays: parseInt(s.coverage) || base.targetCoverageDays,
  };
  // contribution per unit at the new landed cost: price ex VAT − landed − (base other costs kept from server estimate)
  const landedUnit = D(inputs.unitPurchaseCost as any).plus(D(inputs.extraLandedPerUnit as any));
  const baseLanded = D(base.unitPurchaseCost as any).plus(D(base.extraLandedPerUnit as any));
  inputs.contributionPerUnit = base.contributionPerUnit === null ? null : D(base.contributionPerUnit as any).minus(landedUnit.minus(baseLanded));
  const r = computeReorder(inputs);
  const autoQty = computeReorder({ ...inputs, orderQtyOverride: null }).suggestedQty;
  const today = base.today;
  const series = projectStock({
    today, available: Math.max(0, r.available), avgDaily: r.avgDailySales.toNumber(),
    incoming: base.incoming.map((i) => ({ qty: i.qty, day: i.expectedDate ? Math.max(0, differenceInCalendarDays(parseISO(i.expectedDate), parseISO(today))) : r.leadTimeDays })),
    plannedQty: inputs.orderQtyOverride ?? 0, plannedArrivalDay: r.leadTimeDays, days: Math.min(365, r.leadTimeDays + inputs.targetCoverageDays),
  });
  const m = (x: any) => (x === null || x === undefined ? '—' : formatMoney(x, currency));
  const qtyNum = inputs.orderQtyOverride ?? 0;
  const profitPotential = inputs.contributionPerUnit !== null ? D(inputs.contributionPerUnit as any).times(qtyNum) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <Card>
        <CardHeader title="Purchase scenario" description="Change any assumption before committing." action={<EstimateTag />} />
        <CardBody className="space-y-3">
          <Field label="Order quantity" hint={`Engine suggests ${autoQty} (MOQ ${base.minOrderQty}, multiples of ${base.orderMultiple})`}><Input type="number" value={s.qty} onChange={set('qty')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Supplier price (${purchaseCurrency})`}><Input inputMode="decimal" value={s.price} onChange={set('price')} /></Field>
            <Field label={`Rate → ${currency}`} error={!fxOk ? 'Required' : undefined}><Input inputMode="decimal" value={s.fx} onChange={set('fx')} /></Field>
          </div>
          <Field label={`Freight, customs & import costs / unit (${currency})`} hint={histExtra ? `Last shipment: ${D(histExtra).toDecimalPlaces(2)}` : 'No history — estimate it'}><Input inputMode="decimal" value={s.extra} onChange={set('extra')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deposit %"><Input inputMode="decimal" value={s.deposit} onChange={set('deposit')} /></Field>
            <Field label="Coverage target (days)"><Input type="number" value={s.coverage} onChange={set('coverage')} /></Field>
            <Field label="Supplier lead (days)"><Input type="number" value={s.supplierLead} onChange={set('supplierLead')} /></Field>
            <Field label="Shipping & customs (days)"><Input type="number" value={s.shippingLead} onChange={set('shippingLead')} /></Field>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant="secondary" onClick={async () => {
              const name = prompt('Scenario name', `${qtyNum} units @ ${s.price} ${purchaseCurrency}`);
              if (!name) return;
              const res = await savePurchaseScenarioAction({ variant_id: variantId, name, inputs: s, results: { status: r.status, qty: qtyNum, totalLanded: r.cost.totalLanded.toFixed(2), deposit: r.cost.deposit.toFixed(2), affordable: r.cash.affordable, stockout: r.stockoutDate } });
              res.ok ? toast.success('Scenario saved') : toast.error(res.error);
            }}>Save scenario</Button>
            <Button size="sm" asChild><Link href={`/purchase-orders/new?variant=${variantId}&qty=${qtyNum}&price=${s.price}&fx=${s.fx}`}>Create purchase order</Link></Button>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Inventory recommendation</h3><StatusBadge status={r.status} /></div>
            <p className="mb-3 text-sm text-ink-soft">{r.reasons.join(' ')}</p>
            <KV className="sm:grid-cols-1" items={[
              ['1. Current sellable units', `${base.sellableOnHand} (${r.available} available after reservations)`],
              ['2. Expected sales until arrival', `${r.expectedSalesUntilArrival} units over ${r.leadTimeDays} days`],
              ['3. Stock left at expected delivery', `${r.stockAtArrival} units${r.stockAtArrival < 0 ? ' (lost sales risk)' : ''}`],
              ['4. Recommended quantity', `${autoQty} units`],
              ['Stockout date (no new order)', r.stockoutDate ?? '—'],
              ['Recommended order date', r.recommendedOrderDate ?? '—'],
              ['Latest practical order date', r.latestOrderDate ?? '—'],
              ['Expected arrival if ordered today', r.expectedArrivalDate],
              ['Coverage after arrival', r.coverageAfterArrivalDays ? `${r.coverageAfterArrivalDays} days` : '—'],
            ]} />
          </Card>
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Financial affordability</h3>{r.cash.affordable === null ? <Badge>unknown</Badge> : r.cash.affordable ? <Badge tone="sage">affordable</Badge> : <Badge tone="rose">not affordable</Badge>}</div>
            <KV className="sm:grid-cols-1" items={[
              ['5. Purchase cost', m(r.cost.purchase)],
              ['Freight, customs & import', m(r.cost.extraLanded)],
              ['Total projected landed cost', m(r.cost.totalLanded)],
              ['Landed cost / unit', m(r.cost.landedUnitCost)],
              ['6. Deposit now / balance later', `${m(r.cost.deposit)} / ${m(r.cost.balance)}`],
              ['Cash balance', m(r.cash.available)],
              ['7. After committed liabilities', m(r.cash.afterLiabilities)],
              ['8. Minimum cash reserve', m(minReserve)],
              ['Cash remaining after purchase', m(r.cash.remainingAfterPurchase)],
              ['10. Units to sell to recover investment', r.paybackUnits ? `${r.paybackUnits} units` : '—'],
              ['Potential contribution on this order', m(profitPotential)],
            ]} />
            {r.cash.shortfall && <Callout tone="danger" className="mt-3">Short by {m(r.cash.shortfall)} while keeping the minimum reserve. Consider a smaller order, negotiating a lower deposit, or adding capital.</Callout>}
            {!r.cash.known && <Callout tone="warning" className="mt-3">Cash balance unknown — record an opening balance first.</Callout>}
          </Card>
        </div>
        <Card>
          <CardHeader title="Projected stock level" description="With confirmed incoming deliveries; dashed line adds this planned order at its expected arrival." />
          <CardBody>
            {r.avgDailySales.isZero() ? <p className="text-sm text-muted">No demand recorded yet, so stock is flat.</p> : (
              <LinesChart data={series} xKey="date" money={false} refY={{ y: r.safetyStock, label: 'Safety stock' }} keys={[{ key: 'withoutOrder', name: 'Without new order', color: '#a4453b' }, { key: 'withOrder', name: 'With this order', color: '#4a6c4f', dashed: true }]} />
            )}
          </CardBody>
        </Card>
        {sellPriceExVat === null && <Callout tone="info">Set a default selling price to estimate profit and payback.</Callout>}
        <p className="text-xs text-muted">Average daily sales = units ordered in the history window ÷ days observed. Inventory position = sellable + confirmed incoming − reserved. Reorder point = demand during lead time + safety stock (max of fixed safety stock and buffer days × daily sales). Suggested quantity covers lead time + target coverage + safety stock, net of inventory position, rounded up to MOQ and order multiples.</p>
      </div>
    </div>
  );
}
