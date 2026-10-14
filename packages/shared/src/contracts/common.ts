import { z } from 'zod';

/** Integer Toman amount. Upper bound keeps every total inside a Postgres int4. */
export const Money = z.number().int().nonnegative().max(2_000_000_000);
export const Uuid = z.string().uuid();
export const IsoDate = z.string().datetime({ offset: true });
export const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/, 'expected sha256 hex');

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  CART_EMPTY: 'CART_EMPTY',
  INVALID_MOBILE: 'INVALID_MOBILE',
  ORDER_NOT_PAYABLE: 'ORDER_NOT_PAYABLE',
  PAYMENT_IN_PROGRESS: 'PAYMENT_IN_PROGRESS',
  PAYMENT_UNRESOLVED: 'PAYMENT_UNRESOLVED',
  IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_MISMATCH',
  RECONCILE_NOT_ALLOWED: 'RECONCILE_NOT_ALLOWED',
  DUPLICATE_CODE: 'DUPLICATE_CODE',
  PRICE_REQUIRED: 'PRICE_REQUIRED',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
