/**
 * Domain enums shared by kiosk, admin panel and server.
 * Kept as const objects so they work at runtime in every app and map 1:1 to Prisma enums.
 */

export const OrderKind = { SERVICES: 'SERVICES', SUBSCRIPTION: 'SUBSCRIPTION' } as const;
export type OrderKind = (typeof OrderKind)[keyof typeof OrderKind];

export const ItemType = { SERVICE: 'SERVICE', PLAN: 'PLAN' } as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

/**
 * LOCKED: prices snapshotted, waiting for payment.
 * PAYMENT_PENDING: a payment attempt is in flight on the card reader.
 * PAID: a valid terminal confirmation was received (only final success state).
 * FAILED: the last attempt was declined; a new attempt may be started.
 * UNKNOWN: the terminal outcome is not known; must be resolved by inquiry/reconcile before retry.
 * CANCELLED: abandoned before any successful payment.
 */
export const OrderStatus = {
  LOCKED: 'LOCKED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentStatus = {
  INITIATED: 'INITIATED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** Terminal-level outcomes a payment adapter may report. */
export const TerminalOutcome = {
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
} as const;
export type TerminalOutcome = (typeof TerminalOutcome)[keyof typeof TerminalOutcome];

export const PaymentResultSource = {
  TERMINAL: 'TERMINAL',
  INQUIRY: 'INQUIRY',
  RECONCILE: 'RECONCILE',
  RECOVERY: 'RECOVERY',
} as const;
export type PaymentResultSource = (typeof PaymentResultSource)[keyof typeof PaymentResultSource];

export const SubscriptionStatus = { ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED' } as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const AccessResult = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  NOT_STARTED: 'NOT_STARTED',
  REVOKED: 'REVOKED',
  INVALID: 'INVALID',
} as const;
export type AccessResult = (typeof AccessResult)[keyof typeof AccessResult];

export const DiscountType = { PERCENT: 'PERCENT', FIXED: 'FIXED' } as const;
export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

export const DiscountTargetType = {
  SERVICE: 'SERVICE',
  SUBCATEGORY: 'SUBCATEGORY',
  CATEGORY: 'CATEGORY',
  PLAN: 'PLAN',
} as const;
export type DiscountTargetType = (typeof DiscountTargetType)[keyof typeof DiscountTargetType];

/** BEST: the largest discount wins. PRIORITY: lowest priority number wins (ties → larger amount). */
export const DiscountPolicy = { BEST: 'BEST', PRIORITY: 'PRIORITY' } as const;
export type DiscountPolicy = (typeof DiscountPolicy)[keyof typeof DiscountPolicy];

/** EXTEND_FROM_END: a renewal starts when the member's current coverage ends. START_NOW: starts at payment. */
export const RenewalPolicy = { EXTEND_FROM_END: 'EXTEND_FROM_END', START_NOW: 'START_NOW' } as const;
export type RenewalPolicy = (typeof RenewalPolicy)[keyof typeof RenewalPolicy];

export const AdminRole = { ADMIN: 'ADMIN', OPERATOR: 'OPERATOR' } as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const PrintStatus = { NOT_PRINTED: 'NOT_PRINTED', PRINTED: 'PRINTED', FAILED: 'FAILED' } as const;
export type PrintStatus = (typeof PrintStatus)[keyof typeof PrintStatus];

export const SyncEventType = {
  ORDER_OFFLINE: 'ORDER_OFFLINE',
  PAYMENT_RESULT: 'PAYMENT_RESULT',
  ACCESS_LOG: 'ACCESS_LOG',
  RECEIPT_PRINT: 'RECEIPT_PRINT',
  COMMAND_RESULT: 'COMMAND_RESULT',
} as const;
export type SyncEventType = (typeof SyncEventType)[keyof typeof SyncEventType];

export const SyncEventStatus = { APPLIED: 'APPLIED', REJECTED: 'REJECTED', CONFLICT: 'CONFLICT' } as const;
export type SyncEventStatus = (typeof SyncEventStatus)[keyof typeof SyncEventStatus];

export const DeviceCommandType = {
  PAYMENT_INQUIRY: 'PAYMENT_INQUIRY',
  PRINT_RECEIPT: 'PRINT_RECEIPT',
  SYNC_NOW: 'SYNC_NOW',
} as const;
export type DeviceCommandType = (typeof DeviceCommandType)[keyof typeof DeviceCommandType];

export const DeviceCommandStatus = {
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type DeviceCommandStatus = (typeof DeviceCommandStatus)[keyof typeof DeviceCommandStatus];

/** Hardware health as reported by adapters. UNKNOWN is used when no real SDK is connected. */
export const HardwareState = {
  OK: 'OK',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  UNKNOWN: 'UNKNOWN',
} as const;
export type HardwareState = (typeof HardwareState)[keyof typeof HardwareState];

export const CategoryTheme = { BLUE: 'blue', RED: 'red', PURPLE: 'purple', CYAN: 'cyan' } as const;
export type CategoryTheme = (typeof CategoryTheme)[keyof typeof CategoryTheme];
