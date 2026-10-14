import { z } from 'zod';
import {
  ItemType,
  OrderKind,
  OrderStatus,
  PaymentResultSource,
  PaymentStatus,
  PrintStatus,
  TerminalOutcome,
} from '../enums';
import { IsoDate, Money, Sha256Hex, Uuid } from './common';

export const OrderItemInput = z.object({
  itemType: z.nativeEnum(ItemType),
  itemId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(20),
});
export type OrderItemInput = z.infer<typeof OrderItemInput>;

export const CreateOrderRequest = z
  .object({
    localOrderId: Uuid,
    idempotencyKey: Uuid,
    kind: z.nativeEnum(OrderKind),
    mobile: z.string().min(10).max(20),
    items: z.array(OrderItemInput).min(1).max(30),
    /** Total the kiosk showed to the customer (to detect price changes since the cart). */
    expectedTotal: Money.optional(),
    /** SHA-256 of the kiosk-generated QR token, required for subscription orders. */
    qrTokenHash: Sha256Hex.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === OrderKind.SUBSCRIPTION) {
      if (v.items.length !== 1 || v.items[0].itemType !== ItemType.PLAN || v.items[0].quantity !== 1) {
        ctx.addIssue({ code: 'custom', message: 'subscription orders contain exactly one plan', path: ['items'] });
      }
      if (!v.qrTokenHash) ctx.addIssue({ code: 'custom', message: 'qrTokenHash required', path: ['qrTokenHash'] });
    } else {
      if (v.items.some((i) => i.itemType !== ItemType.SERVICE)) {
        ctx.addIssue({ code: 'custom', message: 'service orders contain services only', path: ['items'] });
      }
      const ids = new Set(v.items.map((i) => i.itemId));
      if (ids.size !== v.items.length) {
        ctx.addIssue({ code: 'custom', message: 'duplicate items; use quantity', path: ['items'] });
      }
    }
  });
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

export const OrderItemDto = z.object({
  itemType: z.nativeEnum(ItemType),
  itemId: z.string(),
  code: z.string(),
  title: z.string(),
  unit: z.string(),
  categoryTitle: z.string().nullable(),
  unitPrice: Money,
  quantity: z.number().int(),
  unitDiscount: Money,
  discountTitle: z.string().nullable(),
  lineTotal: Money,
});
export type OrderItemDto = z.infer<typeof OrderItemDto>;

export const SubscriptionSummary = z.object({
  id: z.string(),
  planTitle: z.string(),
  startsAt: IsoDate,
  expiresAt: IsoDate,
  extended: z.boolean(),
});
export type SubscriptionSummary = z.infer<typeof SubscriptionSummary>;

export const OrderDto = z.object({
  id: z.string(),
  orderNumber: z.string(),
  localId: z.string(),
  kind: z.nativeEnum(OrderKind),
  status: z.nativeEnum(OrderStatus),
  mobileMasked: z.string(),
  subtotal: Money,
  discountTotal: Money,
  total: Money,
  items: z.array(OrderItemDto),
  offline: z.boolean(),
  createdAt: IsoDate,
  paidAt: IsoDate.nullable(),
  /** Set on creation when the server's locked total differs from the kiosk's expectedTotal. */
  priceChanged: z.boolean().optional(),
  /** Subscription orders: member already has coverage until this date. */
  activeCoverageUntil: IsoDate.nullable().optional(),
  /** Subscription orders: the period that will be activated if paid now. */
  periodPreview: z.object({ startsAt: IsoDate, expiresAt: IsoDate, extended: z.boolean() }).nullable().optional(),
  subscription: SubscriptionSummary.nullable().optional(),
});
export type OrderDto = z.infer<typeof OrderDto>;

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const InitiatePaymentRequest = z.object({
  orderId: z.string(),
  paymentAttemptId: Uuid,
  idempotencyKey: Uuid,
});
export type InitiatePaymentRequest = z.infer<typeof InitiatePaymentRequest>;

export const InitiatePaymentResponse = z.object({
  paymentAttemptId: z.string(),
  orderId: z.string(),
  amount: Money,
  status: z.nativeEnum(PaymentStatus),
  terminalInstruction: z.string(),
});
export type InitiatePaymentResponse = z.infer<typeof InitiatePaymentResponse>;

export const PaymentResultRequest = z.object({
  outcome: z.nativeEnum(TerminalOutcome),
  amount: Money,
  terminalRef: z.string().max(64).nullable().optional(),
  rrn: z.string().max(64).nullable().optional(),
  traceNo: z.string().max(64).nullable().optional(),
  message: z.string().max(300).nullable().optional(),
  source: z.nativeEnum(PaymentResultSource),
  occurredAt: IsoDate,
});
export type PaymentResultRequest = z.infer<typeof PaymentResultRequest>;

export const PaymentResultResponse = z.object({
  paymentAttemptId: z.string(),
  paymentStatus: z.nativeEnum(PaymentStatus),
  order: OrderDto,
  conflict: z.boolean(),
});
export type PaymentResultResponse = z.infer<typeof PaymentResultResponse>;

export const PaymentStatusResponse = z.object({
  paymentAttemptId: z.string(),
  status: z.nativeEnum(PaymentStatus),
  orderStatus: z.nativeEnum(OrderStatus),
  terminalRef: z.string().nullable(),
  resolvedAt: IsoDate.nullable(),
});
export type PaymentStatusResponse = z.infer<typeof PaymentStatusResponse>;

export const ReconcileRequest = z.object({
  outcome: z.enum([TerminalOutcome.PAID, TerminalOutcome.FAILED]),
  terminalRef: z.string().max(64).optional(),
  rrn: z.string().max(64).optional(),
  reason: z.string().min(5).max(500),
});
export type ReconcileRequest = z.infer<typeof ReconcileRequest>;

// ---------------------------------------------------------------------------
// Receipts (printer adapter input; also used by the admin reprint)
// ---------------------------------------------------------------------------

export const ReceiptData = z.object({
  centerName: z.string(),
  header: z.string(),
  footer: z.string(),
  orderNumber: z.string(),
  offline: z.boolean(),
  kind: z.nativeEnum(OrderKind),
  createdAt: IsoDate,
  paidAt: IsoDate.nullable(),
  mobileMasked: z.string(),
  lines: z.array(
    z.object({ code: z.string(), title: z.string(), quantity: z.number().int(), unitPrice: Money, unitDiscount: Money, lineTotal: Money }),
  ),
  subtotal: Money,
  discountTotal: Money,
  total: Money,
  payment: z.object({ terminalRef: z.string().nullable(), rrn: z.string().nullable() }),
  subscription: z
    .object({
      planTitle: z.string(),
      startsAt: IsoDate,
      expiresAt: IsoDate,
      /** Raw token for the printed QR. Only present at first issue on the kiosk. */
      qrToken: z.string().nullable(),
    })
    .nullable(),
  reprint: z.boolean(),
  timezone: z.string(),
});
export type ReceiptData = z.infer<typeof ReceiptData>;

export const PrintStatusDto = z.nativeEnum(PrintStatus);
