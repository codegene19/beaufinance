import { Tx } from '../db/tenant';
import { AppError } from '../errors';
import { D } from '../calc/money';
import type { ExpenseInput } from '../validation/schemas';
import { recomputeLanded } from './landed';

export interface ExpenseFilters {
  q?: string;
  view?: 'all' | 'committed' | 'paid' | 'outstanding' | 'forecast';
  category?: string;
  treatment?: string;
  from?: string;
  to?: string;
  shipmentId?: string;
  poId?: string;
  campaignId?: string;
}

export async function listExpenses(tx: Tx, f: ExpenseFilters = {}) {
  return tx.many(
    `select e.*, sh.reference as shipment_ref, po.po_number, c.name as campaign_name, v.sku
       from v_expense_summary e
       left join shipments sh on sh.id = e.shipment_id left join purchase_orders po on po.id = e.purchase_order_id
       left join campaigns c on c.id = e.campaign_id left join product_variants v on v.id = e.variant_id
      where e.business_id = $1
        and ($2::text is null or e.name ilike '%' || $2 || '%' or e.payee ilike '%' || $2 || '%' or e.description ilike '%' || $2 || '%')
        and (case $3::text
               when 'committed' then e.commitment = 'committed'
               when 'paid' then e.paid > 0
               when 'outstanding' then e.commitment = 'committed' and e.outstanding > 0
               when 'forecast' then e.commitment = 'planned'
               else true end)
        and ($4::text is null or e.category = $4)
        and ($5::text is null or e.treatment::text = $5)
        and ($6::date is null or e.date_incurred >= $6) and ($7::date is null or e.date_incurred <= $7)
        and ($8::uuid is null or e.shipment_id = $8) and ($9::uuid is null or e.purchase_order_id = $9) and ($10::uuid is null or e.campaign_id = $10)
      order by e.date_incurred desc, e.created_at desc`,
    [tx.businessId, f.q || null, f.view || 'all', f.category || null, f.treatment || null, f.from || null, f.to || null, f.shipmentId || null, f.poId || null, f.campaignId || null],
  );
}

/**
 * The three distinct views of spending, plus supporting totals.
 *  committed: ordered / contractually committed (paid or not) — excludes planned & cancelled
 *  cashSpent: money that actually left the business (payments)
 *  forecast:  planned, not yet committed
 */
export async function expenseTotals(tx: Tx, f: { from?: string | null; to?: string | null } = {}) {
  return tx.one(
    `select
       coalesce(sum(amount_base) filter (where commitment = 'committed'), 0) as committed_base,
       coalesce(sum(paid_base), 0) as cash_spent_base,
       coalesce(sum(round(outstanding * fx_rate, 4)) filter (where commitment = 'committed'), 0) as outstanding_base,
       coalesce(sum(amount_base) filter (where commitment = 'planned'), 0) as forecast_base,
       count(*) filter (where fx_rate is null and commitment <> 'cancelled')::int as missing_fx,
       coalesce(sum(amount_base) filter (where commitment = 'committed' and treatment = 'recoverable_tax'), 0) as recoverable_tax_base
     from v_expense_summary where business_id = $1 and ($2::date is null or date_incurred >= $2) and ($3::date is null or date_incurred <= $3)`,
    [tx.businessId, f.from || null, f.to || null],
  );
}

export async function getExpense(tx: Tx, id: string) {
  const expense = await tx.one('select * from v_expense_summary where id = $1 and business_id = $2', [id, tx.businessId], 'Expense not found');
  const payments = await tx.many('select * from expense_payments where expense_id = $1 order by payment_date', [id]);
  const manual = await tx.many('select * from expense_manual_allocations where expense_id = $1', [id]);
  const allocations = await tx.many(
    `select ca.*, v.sku, v.variant_name, p.name as product_name from cost_allocations ca join purchase_order_items pi on pi.id = ca.purchase_order_item_id
       join product_variants v on v.id = pi.variant_id join products p on p.id = v.product_id where ca.expense_id = $1`,
    [id],
  );
  return { expense, payments, manual, allocations };
}

const COLS = ['name', 'description', 'category', 'amount', 'currency', 'fx_rate', 'date_incurred', 'due_date', 'commitment', 'treatment', 'payee', 'supplier_id', 'purchase_order_id', 'shipment_id', 'variant_id', 'campaign_id', 'allocation_method', 'attachment_url', 'recurring_interval', 'notes'] as const;

export async function saveExpense(tx: Tx, input: ExpenseInput, id?: string) {
  // Normalise link targets based on the chosen link type: one pool only.
  const v: any = { ...input };
  if (v.link_type !== 'purchase_order') v.purchase_order_id = null;
  if (v.link_type !== 'shipment') v.shipment_id = null;
  if (v.link_type !== 'campaign') v.campaign_id = null;
  if (v.treatment !== 'product_acquisition') {
    v.allocation_method = null;
    if (v.link_type === 'purchase_order' || v.link_type === 'shipment') v.variant_id = v.variant_id ?? null;
  }
  if (v.treatment === 'product_acquisition' && !v.allocation_method) v.allocation_method = null; // falls back to the pool default
  const base = await tx.one<{ base_currency: string }>('select base_currency from businesses where id = $1', [tx.businessId]);
  if (v.currency === base.base_currency) v.fx_rate = '1';

  let before: { purchase_order_id: string | null; shipment_id: string | null } | null = null;
  if (id) {
    before = await tx.one('select purchase_order_id, shipment_id, amount, currency from expenses where id = $1 and business_id = $2', [id, tx.businessId], 'Expense not found');
    const paid = await tx.one<{ paid: string }>('select coalesce(sum(amount),0) as paid from expense_payments where expense_id = $1', [id]);
    if (D(paid.paid).greaterThan(D(v.amount))) throw new AppError('The amount cannot be lower than what has already been paid.', 'validation');
    if (D(paid.paid).greaterThan(0) && (before as any).currency !== v.currency) throw new AppError('The currency cannot be changed after payments have been recorded.', 'invalid_state');
    if (v.commitment === 'planned' && D(paid.paid).greaterThan(0)) throw new AppError('A paid expense cannot be moved back to "planned".', 'invalid_state');
    await tx.exec(`update expenses set ${COLS.map((c, i) => `${c} = $${i + 3}`).join(', ')} where id = $1 and business_id = $2`, [id, tx.businessId, ...COLS.map((c) => v[c])]);
  } else {
    const r = await tx.one<{ id: string }>(`insert into expenses (business_id, ${COLS.join(', ')}) values ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}) returning id`, [tx.businessId, ...COLS.map((c) => v[c])]);
    id = r.id;
  }
  await tx.exec('delete from expense_manual_allocations where expense_id = $1', [id]);
  if (v.allocation_method === 'manual') {
    for (const s of v.manual_shares) await tx.exec('insert into expense_manual_allocations (business_id, expense_id, variant_id, share_pct) values ($1,$2,$3,$4)', [tx.businessId, id, s.variant_id, s.share_pct]);
  }
  const poIds = [v.purchase_order_id, before?.purchase_order_id].filter(Boolean) as string[];
  const shipmentIds = [v.shipment_id, before?.shipment_id].filter(Boolean) as string[];
  const result = poIds.length || shipmentIds.length ? await recomputeLanded(tx, { poIds, shipmentIds }) : { issues: [] };
  return { id: id!, issues: result.issues.filter((i) => i.expenseId === id) };
}

export async function deleteExpense(tx: Tx, id: string) {
  const e = await tx.one<{ purchase_order_id: string | null; shipment_id: string | null }>('select purchase_order_id, shipment_id from expenses where id = $1 and business_id = $2', [id, tx.businessId], 'Expense not found');
  const pays = await tx.many<{ id: string }>('select id from expense_payments where expense_id = $1', [id]);
  for (const p of pays) await tx.exec(`delete from cash_transactions where source_type = 'expense_payment' and source_id = $1`, [p.id]);
  await tx.exec('delete from expense_payments where expense_id = $1', [id]);
  await tx.exec('delete from expenses where id = $1', [id]);
  if (e.purchase_order_id || e.shipment_id) await recomputeLanded(tx, { poIds: e.purchase_order_id ? [e.purchase_order_id] : [], shipmentIds: e.shipment_id ? [e.shipment_id] : [] });
}

export async function addExpensePayment(tx: Tx, expenseId: string, p: { payment_date: string; amount: string; fx_rate: string; method: string | null; reference: string | null; idempotency_key: string }) {
  const e = await tx.one<{ name: string; currency: string; outstanding: string; commitment: string; treatment: string }>('select name, currency, outstanding, commitment, treatment from v_expense_summary where id = $1 and business_id = $2', [expenseId, tx.businessId], 'Expense not found');
  await tx.exec('select id from expenses where id = $1 for update', [expenseId]);
  if (e.commitment === 'cancelled') throw new AppError('This expense is cancelled.', 'invalid_state');
  if (D(p.amount).greaterThan(D(e.outstanding))) throw new AppError(`Payment exceeds the outstanding amount (${e.outstanding} ${e.currency}).`, 'validation');
  // Paying a planned cost means it is now committed
  if (e.commitment === 'planned') await tx.exec(`update expenses set commitment = 'committed' where id = $1`, [expenseId]);
  const pay = await tx.one<{ id: string }>(
    `insert into expense_payments (business_id, expense_id, payment_date, amount, fx_rate, method, reference, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [tx.businessId, expenseId, p.payment_date, p.amount, p.fx_rate, p.method, p.reference, `ep:${p.idempotency_key}`],
  );
  await tx.exec(
    `insert into cash_transactions (business_id, txn_date, direction, category, amount, currency, fx_rate, description, source_type, source_id, created_by)
     values ($1,$2,'out',$3,$4,$5,$6,$7,'expense_payment',$8,$9)`,
    [tx.businessId, p.payment_date, e.treatment === 'recoverable_tax' ? 'tax_payment' : 'expense_payment', p.amount, e.currency, p.fx_rate, e.name, pay.id, tx.userId],
  );
  if (e.commitment === 'planned') {
    const ex = await tx.one<{ purchase_order_id: string | null; shipment_id: string | null }>('select purchase_order_id, shipment_id from expenses where id = $1', [expenseId]);
    if (ex.purchase_order_id || ex.shipment_id) await recomputeLanded(tx, { poIds: ex.purchase_order_id ? [ex.purchase_order_id] : [], shipmentIds: ex.shipment_id ? [ex.shipment_id] : [] });
  }
  return pay.id;
}

export async function deleteExpensePayment(tx: Tx, paymentId: string) {
  await tx.one('select id from expense_payments where id = $1 and business_id = $2', [paymentId, tx.businessId], 'Payment not found');
  await tx.exec(`delete from cash_transactions where source_type = 'expense_payment' and source_id = $1`, [paymentId]);
  await tx.exec('delete from expense_payments where id = $1', [paymentId]);
}
