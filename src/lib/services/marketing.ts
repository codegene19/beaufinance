import { Tx } from '../db/tenant';
import { D, Decimal, allocateExact, sum } from '../calc/money';
import { campaignMetrics } from '../calc/analytics';
import type { CampaignInput } from '../validation/schemas';
import { orderFacts, type OrderFact } from './facts';
import { AppError } from '../errors';

export async function saveCampaign(tx: Tx, input: CampaignInput, id?: string) {
  const cols = ['name', 'channel', 'start_date', 'end_date', 'planned_budget', 'is_prelaunch', 'allocation_method', 'sessions', 'notes'] as const;
  if (id) {
    await tx.one('select id from campaigns where id = $1 and business_id = $2', [id, tx.businessId], 'Campaign not found');
    await tx.exec(`update campaigns set ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} where id = $1 and business_id = $2`, [id, tx.businessId, ...cols.map((c) => input[c])]);
  } else {
    id = (await tx.one<{ id: string }>(`insert into campaigns (business_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) returning id`, [tx.businessId, ...cols.map((c) => input[c])])).id;
  }
  await tx.exec('delete from campaign_products where campaign_id = $1', [id]);
  for (const p of input.products)
    await tx.exec('insert into campaign_products (business_id, campaign_id, variant_id, manual_share_pct) values ($1,$2,$3,$4)', [tx.businessId, id, p.variant_id, input.allocation_method === 'manual' ? p.manual_share_pct : null]);
  return id!;
}

export async function deleteCampaign(tx: Tx, id: string) {
  const n = await tx.one<{ n: number }>('select count(*)::int as n from expenses where campaign_id = $1', [id]);
  if (n.n > 0) throw new AppError('This campaign has recorded spend. Move or delete those expenses first.', 'conflict');
  await tx.exec('update sales_orders set campaign_id = null where campaign_id = $1 and business_id = $2', [id, tx.businessId]);
  await tx.exec('delete from campaigns where id = $1 and business_id = $2', [id, tx.businessId]);
}

export interface CampaignPerformance {
  id: string;
  name: string;
  channel: string;
  start_date: string | null;
  end_date: string | null;
  is_prelaunch: boolean;
  allocation_method: string;
  planned_budget: Decimal;
  spend: Decimal;
  paidSpend: Decimal;
  orders: number;
  deliveredOrders: number;
  revenue: Decimal;
  contributionBeforeAds: Decimal;
  cpa: Decimal | null;
  deliveredCpa: Decimal | null;
  roas: Decimal | null;
  conversionRatePct: Decimal | null;
  profitAfterAds: Decimal;
  products: { variant_id: string; sku: string }[];
  allocatedToProducts: Decimal;
  unallocated: Decimal;
  allocationNote: string | null;
}

/**
 * Campaign performance + allocation of each campaign's spend to products, exactly once.
 * Spend that cannot be attributed (pre-launch, no attributed orders, no campaign) is reported
 * separately as unallocated — never silently added to unit costs.
 */
export async function marketingAnalysis(tx: Tx, f: { from?: string | null; to?: string | null } = {}) {
  const campaigns = await tx.many(`select * from campaigns where business_id = $1 order by coalesce(start_date, created_at::date) desc`, [tx.businessId]);
  const spendRows = await tx.many(
    `select campaign_id, coalesce(sum(amount_base),0) as spend, coalesce(sum(paid_base),0) as paid, count(*) filter (where fx_rate is null)::int as missing_fx
       from v_expense_summary where business_id = $1 and treatment = 'marketing' and commitment = 'committed'
        and ($2::date is null or date_incurred >= $2) and ($3::date is null or date_incurred <= $3)
      group by campaign_id`,
    [tx.businessId, f.from || null, f.to || null],
  );
  const cps = await tx.many(`select cp.*, v.sku from campaign_products cp join product_variants v on v.id = cp.variant_id where cp.business_id = $1`, [tx.businessId]);
  // attributed orders: all non-cancelled orders of the campaign (placed in the period)
  const allOrders = await tx.many(
    `select id, campaign_id, status from sales_orders where business_id = $1 and campaign_id is not null and status <> 'cancelled'
       and ($2::date is null or order_date >= $2) and ($3::date is null or order_date <= $3)`,
    [tx.businessId, f.from || null, f.to || null],
  );
  const facts = (await orderFacts(tx, { from: f.from, to: f.to, byOrderDate: true })).filter((o) => o.campaignId);
  const factById = new Map(facts.map((o) => [o.id, o]));

  const perVariantAds = new Map<string, Decimal>();
  const addAd = (v: string, a: Decimal) => perVariantAds.set(v, (perVariantAds.get(v) ?? new Decimal(0)).plus(a));
  let unallocatedTotal = new Decimal(0);
  const unallocatedReasons: { label: string; amount: Decimal }[] = [];

  const perf: CampaignPerformance[] = campaigns.map((c) => {
    const s = spendRows.find((r) => r.campaign_id === c.id);
    const spend = D(s?.spend);
    const orders = allOrders.filter((o) => o.campaign_id === c.id);
    const recognized: OrderFact[] = orders.map((o) => factById.get(o.id)).filter(Boolean) as OrderFact[];
    const delivered = orders.filter((o) => ['delivered', 'returned'].includes(o.status));
    const revenue = sum(recognized.map((o) => o.netSales));
    const contribution = sum(recognized.map((o) => o.contribution));
    const m = campaignMetrics({ spend, orders: orders.length, deliveredOrders: delivered.length, revenueExVat: revenue, contributionBeforeAds: contribution, sessions: c.sessions });

    // allocation weights per variant
    const weights = new Map<string, Decimal>();
    let note: string | null = null;
    const addW = (v: string, w: Decimal) => weights.set(v, (weights.get(v) ?? new Decimal(0)).plus(w));
    if (c.is_prelaunch) note = 'Pre-launch campaign: spend kept as unallocated launch marketing.';
    else if (c.allocation_method === 'manual') {
      cps.filter((p) => p.campaign_id === c.id && p.manual_share_pct).forEach((p) => addW(p.variant_id, D(p.manual_share_pct)));
    } else {
      const pool = c.allocation_method === 'delivered_orders' ? recognized.filter((o) => o.delivered) : c.allocation_method === 'revenue_share' ? recognized : null;
      if (pool) {
        for (const o of pool) for (const it of o.items) addW(it.variantId, c.allocation_method === 'revenue_share' ? it.revenue.minus(it.refunds) : D(it.netUnits));
      } else {
        // attributed_orders: units in all attributed (non-cancelled) orders
        for (const o of orders) {
          const fct = factById.get(o.id);
          if (fct) for (const it of fct.items) addW(it.variantId, D(it.quantity));
        }
      }
    }
    const entries = [...weights.entries()].filter(([, w]) => w.greaterThan(0));
    let allocated = new Decimal(0);
    if (!c.is_prelaunch && entries.length && spend.greaterThan(0)) {
      const parts = allocateExact(spend, entries.map(([, w]) => w));
      entries.forEach(([v], i) => addAd(v, parts[i]));
      allocated = spend;
    } else if (spend.greaterThan(0)) {
      note = note ?? 'No attributed sales yet: spend shown as unallocated.';
      unallocatedReasons.push({ label: c.name, amount: spend });
    }
    unallocatedTotal = unallocatedTotal.plus(spend.minus(allocated));
    return {
      id: c.id,
      name: c.name,
      channel: c.channel,
      start_date: c.start_date,
      end_date: c.end_date,
      is_prelaunch: c.is_prelaunch,
      allocation_method: c.allocation_method,
      planned_budget: D(c.planned_budget),
      spend,
      paidSpend: D(s?.paid),
      orders: orders.length,
      deliveredOrders: delivered.length,
      revenue,
      contributionBeforeAds: contribution,
      ...m,
      products: cps.filter((p) => p.campaign_id === c.id).map((p) => ({ variant_id: p.variant_id, sku: p.sku })),
      allocatedToProducts: allocated,
      unallocated: spend.minus(allocated),
      allocationNote: note,
    };
  });

  const noCampaign = spendRows.find((r) => r.campaign_id === null);
  if (noCampaign && D(noCampaign.spend).greaterThan(0)) {
    unallocatedTotal = unallocatedTotal.plus(D(noCampaign.spend));
    unallocatedReasons.push({ label: 'Marketing not linked to a campaign', amount: D(noCampaign.spend) });
  }
  const totalSpend = sum(spendRows.map((r) => r.spend));
  const missingFx = spendRows.reduce((a, r) => a + r.missing_fx, 0);
  return { campaigns: perf, perVariantAds, unallocatedTotal, unallocatedReasons, totalSpend, missingFx };
}
