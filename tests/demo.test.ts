import { beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, createUser, as } from './helpers/db';
import { seedDemoBusiness } from '@/lib/services/demo';
import { dashboard } from '@/lib/services/dashboard';
import { profitAndLoss, cashPosition } from '@/lib/services/finance';
import { D } from '@/lib/calc/money';

let user: string;
let biz: string;
beforeAll(async () => {
  await setupTestDb();
  user = await createUser('demo@test.local');
  biz = await seedDemoBusiness(user, new Date('2026-10-10T12:00:00Z'));
}, 300000);

describe('demo dataset', () => {
  it('is flagged as demo and reconciles', async () => {
    const b = await as(user, biz, (tx) => tx.one<{ is_demo: boolean }>('select is_demo from businesses where id = $1', [biz]));
    expect(b.is_demo).toBe(true);
    const pnl = await as(user, biz, (tx) => profitAndLoss(tx, {}));
    expect(pnl.orders).toBeGreaterThan(50);
    expect(pnl.netSales.greaterThan(0)).toBe(true);
    // cash balance equals sum of signed cash transactions
    const cash = await as(user, biz, (tx) => cashPosition(tx));
    const raw = await as(user, biz, (tx) => tx.one<{ s: string }>(`select sum(case when direction='in' then amount_base else -amount_base end) as s from cash_transactions`));
    expect(cash.balance.toFixed(2)).toBe(D(raw.s).toFixed(2));
    // no lot has negative stock
    const neg = await as(user, biz, (tx) => tx.one<{ n: number }>('select count(*)::int as n from v_lot_stock where on_hand < 0'));
    expect(neg.n).toBe(0);
  });

  it('dashboard computes from records', async () => {
    const dsh = await as(user, biz, (tx) => dashboard(tx, { from: '2026-07-12', to: '2026-10-10', bucket: 'week' }));
    expect(dsh.series.length).toBeGreaterThan(5);
    expect(dsh.kpis.cash.known).toBe(true);
    require('node:fs').writeFileSync('/tmp/claude-501/demo-out.json', JSON.stringify({ net: dsh.kpis.netSales, gp: dsh.kpis.grossProfit, profitAfterAds: dsh.kpis.profitAfterAds, nop: dsh.kpis.netOperatingProfit, cash: dsh.kpis.cash.balance, inv: dsh.kpis.inventoryValue, reorder: dsh.inventory.map((r) => `${r.sku}:${r.status}:${r.available}`) }));
  });
});
