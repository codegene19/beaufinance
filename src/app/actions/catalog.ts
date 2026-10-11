'use server';
import { z } from 'zod';
import { runAction } from '@/lib/action';
import { productSchema, supplierSchema } from '@/lib/validation/schemas';
import * as products from '@/lib/services/products';
import * as suppliers from '@/lib/services/suppliers';

const R = ['/products', '/suppliers', '/'];

export async function saveProductAction(input: unknown, id?: string) {
  return runAction(productSchema, input, (tx, v) => products.saveProduct(tx, v, id), { revalidate: R });
}
export async function deleteProductAction(id: string) {
  return runAction(null, null, (tx) => products.deleteProduct(tx, id), { revalidate: R });
}
export async function addDocumentAction(productId: string, input: unknown) {
  return runAction(z.object({ name: z.string().trim().min(1, 'Name required'), url: z.url('Enter a full URL') }), input, (tx, v) => products.addDocument(tx, productId, v.name, v.url), { revalidate: R });
}
export async function deleteDocumentAction(id: string) {
  return runAction(null, null, (tx) => products.deleteDocument(tx, id), { revalidate: R });
}
export async function saveSupplierAction(input: unknown, id?: string) {
  return runAction(supplierSchema, input, (tx, v) => (id ? suppliers.updateSupplier(tx, id, v).then(() => id) : suppliers.createSupplier(tx, v)), { revalidate: R });
}
export async function archiveSupplierAction(id: string, archived: boolean) {
  return runAction(null, null, (tx) => suppliers.archiveSupplier(tx, id, archived), { revalidate: R });
}
export async function deleteSupplierAction(id: string) {
  return runAction(null, null, (tx) => suppliers.deleteSupplier(tx, id), { revalidate: R });
}
