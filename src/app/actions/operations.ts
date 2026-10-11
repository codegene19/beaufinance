'use server';
import { z } from 'zod';
import { runAction } from '@/lib/action';
import {
  adjustmentSchema, openingStockSchema, salesOrderSchema, orderTransitionSchema, orderPaymentSchema, returnSchema, expenseSchema, paymentSchema, campaignSchema, cashTxnSchema,
} from '@/lib/validation/schemas';
import * as inv from '@/lib/services/inventory';
import * as sales from '@/lib/services/sales';
import * as exp from '@/lib/services/expenses';
import * as mkt from '@/lib/services/marketing';
import * as fin from '@/lib/services/finance';
import { savePurchaseScenario } from '@/lib/services/reorder';

const ALL = ['/'];

export async function adjustStockAction(input: unknown) {
  return runAction(adjustmentSchema, input, (tx, v) => inv.adjustStock(tx, v), { revalidate: ALL });
}
export async function openingStockAction(input: unknown) {
  return runAction(openingStockSchema, input, (tx, v) => inv.addOpeningStock(tx, v), { revalidate: ALL });
}
export async function updateLotExpiryAction(lotId: string, expiry: string | null) {
  return runAction(z.object({ expiry: z.iso.date().nullable() }), { expiry }, (tx, v) => tx.exec('update inventory_lots set expiry_date = $2 where id = $1 and business_id = $3', [lotId, v.expiry, tx.businessId]), { revalidate: ALL });
}

export async function createOrderAction(input: unknown) {
  return runAction(salesOrderSchema, input, (tx, v) => sales.createOrder(tx, v), { revalidate: ALL });
}
export async function transitionOrderAction(id: string, input: unknown) {
  return runAction(orderTransitionSchema, input, (tx, v) => sales.transitionOrder(tx, id, v), { revalidate: ALL });
}
export async function orderPaymentAction(id: string, input: unknown) {
  return runAction(orderPaymentSchema, input, (tx, v) => sales.addOrderPayment(tx, id, v), { revalidate: ALL });
}
export async function deleteOrderPaymentAction(id: string) {
  return runAction(null, null, (tx) => sales.deleteOrderPayment(tx, id), { revalidate: ALL });
}
export async function createReturnAction(id: string, input: unknown) {
  return runAction(returnSchema, input, (tx, v) => sales.createReturn(tx, id, v), { revalidate: ALL });
}
export async function deleteOrderAction(id: string) {
  return runAction(null, null, (tx) => sales.deleteOrder(tx, id), { revalidate: ALL });
}
export async function updateOrderCostsAction(id: string, input: unknown) {
  const s = z.object({
    shipping_cost: z.string(), fulfillment_cost: z.string(), packaging_cost: z.string(), payment_fee: z.string(), platform_fee: z.string(),
    delivery_provider: z.string().nullable(), tracking_ref: z.string().nullable(), notes: z.string().nullable(),
  });
  return runAction(s, input, async (tx, v) => {
    for (const k of ['shipping_cost', 'fulfillment_cost', 'packaging_cost', 'payment_fee', 'platform_fee'] as const) if (!/^\d+(\.\d{1,2})?$/.test(v[k])) throw new Error('Invalid amount');
    await tx.exec(
      'update sales_orders set shipping_cost=$3, fulfillment_cost=$4, packaging_cost=$5, payment_fee=$6, platform_fee=$7, delivery_provider=$8, tracking_ref=$9, notes=$10 where id = $1 and business_id = $2',
      [id, tx.businessId, v.shipping_cost, v.fulfillment_cost, v.packaging_cost, v.payment_fee, v.platform_fee, v.delivery_provider, v.tracking_ref, v.notes],
    );
  }, { revalidate: ALL });
}

export async function saveExpenseAction(input: unknown, id?: string) {
  return runAction(expenseSchema, input, async (tx, v) => {
    const r = await exp.saveExpense(tx, v, id);
    return { id: r.id, warnings: r.issues.map((i) => `${i.name}: ${i.message}`) };
  }, { revalidate: ALL });
}
export async function deleteExpenseAction(id: string) {
  return runAction(null, null, (tx) => exp.deleteExpense(tx, id), { revalidate: ALL });
}
export async function expensePaymentAction(id: string, input: unknown) {
  return runAction(paymentSchema.omit({ is_deposit: true }), input, (tx, v) => exp.addExpensePayment(tx, id, v), { revalidate: ALL });
}
export async function deleteExpensePaymentAction(id: string) {
  return runAction(null, null, (tx) => exp.deleteExpensePayment(tx, id), { revalidate: ALL });
}

export async function saveCampaignAction(input: unknown, id?: string) {
  return runAction(campaignSchema, input, (tx, v) => mkt.saveCampaign(tx, v, id), { revalidate: ALL });
}
export async function deleteCampaignAction(id: string) {
  return runAction(null, null, (tx) => mkt.deleteCampaign(tx, id), { revalidate: ALL });
}

export async function addCashAction(input: unknown) {
  return runAction(cashTxnSchema, input, (tx, v) => fin.addCashTransaction(tx, v), { revalidate: ALL });
}
export async function deleteCashAction(id: string) {
  return runAction(null, null, (tx) => fin.deleteCashTransaction(tx, id), { revalidate: ALL });
}

export async function savePriceSimulationAction(input: unknown) {
  const s = z.object({ variant_id: z.uuid().nullable(), name: z.string().trim().min(1).max(120), inputs: z.record(z.string(), z.unknown()), results: z.record(z.string(), z.unknown()) });
  return runAction(s, input, (tx, v) =>
    tx.exec('insert into price_simulations (business_id, variant_id, name, inputs, results, created_by) values ($1,$2,$3,$4,$5,$6)', [tx.businessId, v.variant_id, v.name, JSON.stringify(v.inputs), JSON.stringify(v.results), tx.userId]),
  { revalidate: ['/pricing'] });
}
export async function applyPriceAction(variantId: string, price: string, includesTax: boolean) {
  return runAction(z.object({ price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid price') }), { price }, (tx, v) =>
    tx.exec('update product_variants set default_selling_price = $2, selling_price_includes_tax = $3 where id = $1 and business_id = $4', [variantId, v.price, includesTax, tx.businessId]),
  { revalidate: ALL });
}
export async function savePurchaseScenarioAction(input: unknown) {
  const s = z.object({ variant_id: z.uuid(), name: z.string().trim().min(1).max(120), inputs: z.record(z.string(), z.unknown()), results: z.record(z.string(), z.unknown()) });
  return runAction(s, input, (tx, v) => savePurchaseScenario(tx, v.variant_id, v.name, v.inputs, v.results), { revalidate: ['/reorder'] });
}
