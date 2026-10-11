import { formatISO } from 'date-fns';
import { tenant, getAppContext } from '@/lib/app-context';
import { PageHeader } from '@/components/ui/misc';
import { ExpenseForm } from '../expense-form';
import { expenseRefs } from '../refs';

export const metadata = { title: 'Record expense' };

export default async function NewExpense({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getAppContext();
  const data = await tenant(expenseRefs);
  const cur = ctx.business.base_currency;
  const initial = {
    name: '', description: '', category: sp.category ?? '', amount: '', currency: sp.currency ?? cur, fx_rate: '1', date_incurred: formatISO(new Date(), { representation: 'date' }), due_date: '',
    commitment: sp.commitment ?? 'committed', treatment: sp.treatment ?? 'operating', payee: '', supplier_id: '', link_type: sp.link_type ?? 'general', purchase_order_id: sp.purchase_order_id ?? '',
    shipment_id: sp.shipment_id ?? '', variant_id: '', campaign_id: sp.campaign_id ?? '', allocation_method: '', manual_shares: [], attachment_url: '', recurring_interval: '', notes: '',
  };
  return (
    <>
      <PageHeader eyebrow="Expenses" title="Record expense" description="Costs can be recorded before goods arrive. Choose how each cost is treated so it is counted exactly once." />
      <ExpenseForm initial={initial} refs={data.refs} rates={data.rates} baseCurrency={cur} importVatRecoverable={ctx.settings.import_vat_recoverable} />
    </>
  );
}
