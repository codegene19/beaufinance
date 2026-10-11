import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { Callout } from '@/components/ui/misc';
import { Money } from '@/components/app/money';
import { categoryLabel } from '@/lib/constants';
import { D } from '@/lib/calc/money';

type Pool = {
  kind: string; label: string; plannedEstimate: any;
  lines: { lineId: string; label: string; quantity: number; lineCost: { purchase: any; allocated: any; byCategory: Record<string, any>; total: any; perBasisUnit: any } }[];
  issues: { name: string; message: string }[];
  costs: { expenseId: string; name: string; method: string; amountBase: any }[];
};

/** Transparent table: how each line's landed cost is built, cost by cost. */
export function LandedBreakdown({ pool, currency, includePurchase }: { pool: Pool; currency: string; includePurchase: boolean }) {
  const cats = Array.from(new Set(pool.lines.flatMap((l) => Object.keys(l.lineCost.byCategory))));
  return (
    <div className="space-y-3">
      {pool.issues.map((i, k) => <Callout key={k} tone="warning" title={i.name}>{i.message}</Callout>)}
      <Table>
        <THead>
          <tr>
            <Th>Line</Th><Th right>Units</Th>
            {includePurchase && <Th right>Purchase</Th>}
            {cats.map((c) => <Th key={c} right>{categoryLabel(c)}</Th>)}
            <Th right>{includePurchase ? 'Landed total' : 'Allocated'}</Th><Th right>Per unit</Th>
          </tr>
        </THead>
        <tbody>
          {pool.lines.map((l) => (
            <Tr key={l.lineId}>
              <Td className="max-w-64"><span className="line-clamp-2">{l.label}</span></Td>
              <Td right>{l.quantity}</Td>
              {includePurchase && <Td right><Money value={l.lineCost.purchase} currency={currency} /></Td>}
              {cats.map((c) => <Td key={c} right><Money value={l.lineCost.byCategory[c] ?? 0} currency={currency} /></Td>)}
              <Td right className="font-semibold"><Money value={includePurchase ? l.lineCost.total : l.lineCost.allocated} currency={currency} /></Td>
              <Td right><Money value={includePurchase ? l.lineCost.perBasisUnit : D(l.lineCost.allocated.toString()).div(l.quantity || 1)} currency={currency} decimals={4} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {pool.costs.length > 0 && (
        <p className="px-4 pb-2 text-xs text-muted">
          Allocation methods: {pool.costs.map((c) => `${c.name} by ${c.method}`).join(' · ')}.
          {D(pool.plannedEstimate.toString()).greaterThan(0) && <> Planned (not yet committed) costs of <Money value={pool.plannedEstimate} currency={currency} /> are excluded until committed.</>}
        </p>
      )}
    </div>
  );
}
