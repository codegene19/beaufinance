'use server';
import { z } from 'zod';
import { runAction } from '@/lib/action';
import { settingsSchema, exchangeRateSchema, taxRateSchema, channelSchema, marketSchema, currency } from '@/lib/validation/schemas';
import { updateSettings } from '@/lib/services/business';
import { AppError } from '@/lib/errors';

const R = ['/'];

export async function saveSettingsAction(input: unknown) {
  return runAction(settingsSchema, input, async (tx, v) => {
    const owner = await tx.one<{ role: string }>('select role from business_members where business_id = $1 and user_id = $2', [tx.businessId, tx.userId]);
    if (owner.role !== 'owner') throw new AppError('Only owners can change business settings.', 'forbidden');
    const b = await tx.one<{ base_currency: string }>('select base_currency from businesses where id = $1', [tx.businessId]);
    if (b.base_currency !== v.base_currency) {
      const n = await tx.one<{ n: number }>('select (select count(*) from cash_transactions where business_id = $1) + (select count(*) from purchase_orders where business_id = $1) as n', [tx.businessId]);
      if (Number(n.n) > 0) throw new AppError('The reporting currency cannot be changed once transactions exist (historical rates would no longer be meaningful).', 'invalid_state');
    }
    await updateSettings(tx, v);
  }, { revalidate: R });
}
export async function addExchangeRateAction(input: unknown) {
  return runAction(exchangeRateSchema, input, async (tx, v) => {
    await tx.exec('insert into currencies (business_id, code, name) values ($1,$2,$2) on conflict do nothing', [tx.businessId, v.currency]);
    await tx.exec(
      `insert into exchange_rates (business_id, currency, rate_to_base, effective_date, source) values ($1,$2,$3,$4,$5)
       on conflict (business_id, currency, effective_date) do update set rate_to_base = excluded.rate_to_base, source = excluded.source`,
      [tx.businessId, v.currency, v.rate_to_base, v.effective_date, v.source],
    );
  }, { revalidate: R });
}
export async function deleteExchangeRateAction(id: string) {
  return runAction(null, null, (tx) => tx.exec('delete from exchange_rates where id = $1 and business_id = $2', [id, tx.businessId]), { revalidate: R });
}
export async function addCurrencyAction(input: unknown) {
  return runAction(z.object({ code: currency, name: z.string().trim().min(1) }), input, (tx, v) => tx.exec('insert into currencies (business_id, code, name) values ($1,$2,$3) on conflict (business_id, code) do update set name = excluded.name', [tx.businessId, v.code, v.name]), { revalidate: R });
}
export async function saveTaxRateAction(input: unknown, id?: string) {
  return runAction(taxRateSchema, input, async (tx, v) => {
    if (v.is_default) await tx.exec('update tax_rates set is_default = false where business_id = $1 and market_code = $2 and transaction_type = $3', [tx.businessId, v.market_code, v.transaction_type]);
    if (id) await tx.exec('update tax_rates set market_code=$3, transaction_type=$4, name=$5, rate_pct=$6, is_default=$7, is_recoverable=$8, notes=$9 where id = $1 and business_id = $2', [id, tx.businessId, v.market_code, v.transaction_type, v.name, v.rate_pct, v.is_default, v.is_recoverable, v.notes]);
    else await tx.exec('insert into tax_rates (business_id, market_code, transaction_type, name, rate_pct, is_default, is_recoverable, notes) values ($1,$2,$3,$4,$5,$6,$7,$8)', [tx.businessId, v.market_code, v.transaction_type, v.name, v.rate_pct, v.is_default, v.is_recoverable, v.notes]);
  }, { revalidate: R });
}
export async function deleteTaxRateAction(id: string) {
  return runAction(null, null, (tx) => tx.exec('delete from tax_rates where id = $1 and business_id = $2', [id, tx.businessId]), { revalidate: R });
}
export async function saveChannelAction(input: unknown, id?: string) {
  return runAction(channelSchema, input, (tx, v) =>
    id
      ? tx.exec('update sales_channels set name=$3, kind=$4, commission_pct=$5, commission_fixed=$6, is_active=$7 where id = $1 and business_id = $2', [id, tx.businessId, v.name, v.kind, v.commission_pct, v.commission_fixed, v.is_active])
      : tx.exec('insert into sales_channels (business_id, name, kind, commission_pct, commission_fixed, is_active) values ($1,$2,$3,$4,$5,$6)', [tx.businessId, v.name, v.kind, v.commission_pct, v.commission_fixed, v.is_active]),
  { revalidate: R });
}
export async function saveMarketAction(input: unknown) {
  return runAction(marketSchema, input, (tx, v) =>
    tx.exec('insert into markets (business_id, code, name, currency, is_active) values ($1,$2,$3,$4,$5) on conflict (business_id, code) do update set name = excluded.name, currency = excluded.currency, is_active = excluded.is_active', [tx.businessId, v.code, v.name, v.currency, v.is_active]),
  { revalidate: R });
}
export async function addMemberAction(input: unknown) {
  return runAction(z.object({ email: z.email(), role: z.enum(['owner', 'manager', 'viewer']) }), input, (tx, v) => tx.exec('select add_business_member($1, $2, $3::member_role)', [tx.businessId, v.email, v.role]), { revalidate: R });
}
export async function removeMemberAction(userId: string) {
  return runAction(null, null, async (tx) => {
    if (userId === tx.userId) throw new AppError('You cannot remove yourself.', 'invalid_state');
    await tx.exec('delete from business_members where business_id = $1 and user_id = $2', [tx.businessId, userId]);
  }, { revalidate: R });
}
