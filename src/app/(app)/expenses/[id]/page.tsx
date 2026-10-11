import Link from 'next/link';
import { tenant, getAppContext } from '@/lib/app-context';
import { getExpense, } from '@/lib/services/expenses';
import { defaultFxRate } from '@/lib/services/business';
import { expensePaymentAction, deleteExpensePaymentAction, deleteExpenseAction } from '@/app/actions/operations';
import { PageHeader, KV, Callout } from '@/components/ui/misc';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { ConfirmButton } from '@/components/ui/confirm';
import { Money, fmtDate } from '@/components/app/money';
import { PaymentDialog } from '@/components/app/payment-dialog';
import { ExpenseForm } from '../expense-form';
import { expenseRefs } from '../refs';
import { categoryLabel, treatmentLabel } from '@/lib/constants';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export const metadata = { title: 'Expense' };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const cur = ctx.business.base_currency;
  const data = await tenant(async (tx) => {
    const d = await getExpense(tx, id);
    return { ...d, ...(await expenseRefs(tx)), rate: await defaultFxRate(tx, d.expense.currency) };
  });
  const e = data.expense;
  const link = e.shipment_id ? 'shipment' : e.purchase_order_id ? 'purchase_order' : e.campaign_id ? 'campaign' : 'general';
  const initial = {
    ...Object.fromEntries(['name', 'description', 'category', 'amount', 'currency', 'fx_rate', 'date_incurred', 'due_date', 'commitment', 'treatment', 'payee', 'supplier_id', 'purchase_order_id', 'shipment_id', 'variant_id', 'campaign_id', 'allocation_method', 'attachment_url', 'recurring_interval', 'notes'].map((k) => [k, s(e[k])])),
    link_type: link,
    manual_shares: data.manual.map((m: any) => ({ variant_id: m.variant_id, share_pct: String(Number(m.share_pct)) })),
  };
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/expenses" className="hover:underline">Expenses</Link>}
        title={e.name}
        description={`${categoryLabel(e.category)} · ${treatmentLabel(e.treatment)}`}
        actions={<><StatusBadge status={e.payment_state} /><ConfirmButton action={deleteExpenseAction.bind(null, id)} title="Delete expense?" description="Its payments and cash movements are removed too, and landed costs are recalculated. This cannot be undone." confirmLabel="Delete" redirectTo="/expenses" successMessage="Expense deleted">Delete</ConfirmButton></>}
      />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Summary" />
          <CardBody>
            <KV className="sm:grid-cols-1" items={[
              ['Amount', `${e.amount} ${e.currency}`],
              [`In ${cur}`, e.amount_base === null ? 'Missing exchange rate' : <Money value={e.amount_base} currency={cur} />],
              ['Rate used', e.fx_rate ?? '—'],
              ['Paid', `${e.paid} ${e.currency}`],
              ['Outstanding', `${e.outstanding} ${e.currency}`],
              ['Incurred / due', `${fmtDate(e.date_incurred)} / ${fmtDate(e.due_date)}`],
            ]} />
            {e.attachment_url && <a className="mt-3 inline-block text-sm text-sage-700 underline" href={e.attachment_url} target="_blank" rel="noreferrer">Open receipt / invoice</a>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Payments" action={e.commitment !== 'cancelled' && Number(e.outstanding) > 0 && <PaymentDialog title="Pay expense" currency={e.currency} baseCurrency={cur} outstanding={e.outstanding} defaultRate={e.fx_rate ?? data.rate} action={expensePaymentAction.bind(null, id)} />} />
          {data.payments.length === 0 ? <CardBody className="text-sm text-muted">No payments yet — this cost is {e.commitment === 'planned' ? 'only planned' : 'owed'}.</CardBody> : (
            <ul className="divide-y divide-line">{data.payments.map((p: any) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div><div className="font-medium">{p.amount} {e.currency}</div><div className="text-xs text-muted">{fmtDate(p.payment_date)} · <Money value={p.amount_base} currency={cur} />{p.reference ? ` · ${p.reference}` : ''}</div></div>
                <ConfirmButton action={deleteExpensePaymentAction.bind(null, p.id)} title="Delete payment?" description="The matching cash movement is removed too." confirmLabel="Delete" variant="ghost">Delete</ConfirmButton>
              </li>
            ))}</ul>
          )}
        </Card>
      </div>
      {e.treatment === 'product_acquisition' && (
        <Card className="mb-4">
          <CardHeader title="Allocation to products" description="Computed from the pool and method; rebuilt automatically when anything changes." />
          {data.allocations.length === 0 ? <div className="p-5"><Callout tone="warning">Not allocated yet. Check that the shipment / PO has product lines and the data the method needs (weight, volume) — or that the expense is committed.</Callout></div> : (
            <Table><THead><tr><Th>Product</Th><Th>Method</Th><Th right>Basis</Th><Th right>Allocated</Th></tr></THead>
              <tbody>{data.allocations.map((a: any) => <Tr key={a.id}><Td>{a.product_name} — {a.variant_name} <span className="text-xs text-muted">{a.sku}</span></Td><Td muted>{a.method}</Td><Td right>{Number(a.basis_value).toLocaleString('en-GB', { maximumFractionDigits: 3 })}</Td><Td right><Money value={a.amount_base} currency={cur} decimals={2} /></Td></Tr>)}</tbody>
            </Table>
          )}
        </Card>
      )}
      <h2 className="mb-3 font-display text-2xl font-semibold">Edit</h2>
      <ExpenseForm id={id} initial={initial} refs={data.refs} rates={data.rates} baseCurrency={cur} importVatRecoverable={ctx.settings.import_vat_recoverable} />
    </>
  );
}
