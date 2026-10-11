'use server';
import { z } from 'zod';
import { runAction } from '@/lib/action';
import { paymentSchema, purchaseOrderSchema, shipmentSchema, shipmentItemsSchema, receiptSchema } from '@/lib/validation/schemas';
import * as po from '@/lib/services/purchasing';
import * as sh from '@/lib/services/shipments';
import { receiveGoods } from '@/lib/services/inventory';
import { recomputeLanded } from '@/lib/services/landed';

const R = ['/purchase-orders', '/shipments', '/inventory', '/suppliers', '/cash-flow', '/'];

export async function savePurchaseOrderAction(input: unknown, id?: string) {
  return runAction(purchaseOrderSchema, input, (tx, v) => po.savePurchaseOrder(tx, v, id), { revalidate: R });
}
export async function setPoStatusAction(id: string, status: string) {
  return runAction(z.string(), status, (tx, s) => po.setPurchaseOrderStatus(tx, id, s), { revalidate: R });
}
export async function deletePurchaseOrderAction(id: string) {
  return runAction(null, null, (tx) => po.deletePurchaseOrder(tx, id), { revalidate: R });
}
export async function addSupplierPaymentAction(poId: string, input: unknown) {
  return runAction(paymentSchema, input, (tx, v) => po.addSupplierPayment(tx, poId, v), { revalidate: R });
}
export async function deleteSupplierPaymentAction(id: string) {
  return runAction(null, null, (tx) => po.deleteSupplierPayment(tx, id), { revalidate: R });
}
export async function saveShipmentAction(input: unknown, id?: string) {
  return runAction(shipmentSchema, input, (tx, v) => sh.saveShipment(tx, v, id), { revalidate: R });
}
export async function setShipmentItemsAction(id: string, input: unknown) {
  return runAction(shipmentItemsSchema, input, (tx, v) => sh.setShipmentItems(tx, id, v.items), { revalidate: R });
}
export async function deleteShipmentAction(id: string) {
  return runAction(null, null, (tx) => sh.deleteShipment(tx, id), { revalidate: R });
}
export async function receiveGoodsAction(input: unknown) {
  return runAction(receiptSchema, input, (tx, v) => receiveGoods(tx, v), { revalidate: R });
}
export async function recomputeLandedAction(poId: string) {
  return runAction(null, null, (tx) => recomputeLanded(tx, { poIds: [poId] }).then((r) => ({ warnings: r.issues.map((i) => `${i.pool}: ${i.name} — ${i.message}`) })), { revalidate: R });
}
