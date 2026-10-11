export type ErrorCode = 'validation' | 'not_found' | 'forbidden' | 'conflict' | 'insufficient_stock' | 'invalid_state' | 'unauthenticated';

/** An error whose message is safe and meaningful to show to the user. */
export class AppError extends Error {
  constructor(message: string, public readonly code: ErrorCode = 'validation', public readonly details?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}

export type ActionResult<T = unknown> = { ok: true; data: T; warnings?: string[] } | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

/** Translates database constraint violations into readable messages. */
export function toUserMessage(e: unknown): { message: string; code?: string } {
  if (e instanceof AppError) return { message: e.message, code: e.code };
  const err = e as { code?: string; message?: string; constraint_name?: string; constraint?: string; detail?: string };
  const constraint = err.constraint_name ?? err.constraint ?? '';
  switch (err.code) {
    case '23505':
      if (constraint.includes('idempotency')) return { message: 'This operation was already recorded (duplicate submission prevented).', code: 'conflict' };
      if (constraint.includes('sku')) return { message: 'A variant with this SKU already exists.', code: 'conflict' };
      if (constraint.includes('po_number')) return { message: 'A purchase order with this number already exists.', code: 'conflict' };
      if (constraint.includes('order_number')) return { message: 'A sales order with this number already exists.', code: 'conflict' };
      return { message: 'A record with the same unique value already exists.', code: 'conflict' };
    case '22P02':
      return { message: 'An identifier or value has an invalid format.', code: 'validation' };
    case '23503':
      return { message: 'This record is referenced by other records (or references a missing one) and cannot be changed this way.', code: 'conflict' };
    case '23514':
      return { message: `A value is outside the allowed range${constraint ? ` (${constraint})` : ''}.`, code: 'validation' };
    case '23502':
      return { message: 'A required value is missing.', code: 'validation' };
    case 'P0001':
    case 'P0002':
      return { message: err.message ?? 'Operation failed', code: 'validation' };
    case '42501':
      return { message: 'You do not have permission to perform this action.', code: 'forbidden' };
  }
  console.error(e);
  return { message: 'Something went wrong while saving. Nothing was changed.' };
}
