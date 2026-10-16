import { z } from 'zod';
import {
  AccessResult,
  DeviceCommandType,
  HardwareState,
  OrderKind,
  PaymentResultSource,
  SubscriptionStatus,
  SyncEventType,
  TerminalOutcome,
  ItemType,
} from '../enums';
import { Bootstrap } from './catalog';
import { IsoDate, Money, Sha256Hex, Uuid } from './common';

// ---------------------------------------------------------------------------
// Access (QR validation)
// ---------------------------------------------------------------------------

export const ValidateAccessRequest = z.object({
  token: z.string().min(1).max(256),
  eventId: Uuid.optional(),
});
export type ValidateAccessRequest = z.infer<typeof ValidateAccessRequest>;

export const ValidateAccessResponse = z.object({
  result: z.nativeEnum(AccessResult),
  valid: z.boolean(),
  expiresAt: IsoDate.nullable(),
  startsAt: IsoDate.nullable(),
  planTitle: z.string().nullable(),
  /** Last four digits only. Never the full mobile number. */
  memberTail: z.string().nullable(),
  offline: z.boolean(),
});
export type ValidateAccessResponse = z.infer<typeof ValidateAccessResponse>;

export const SubscriptionCacheEntry = z.object({
  subscriptionId: z.string(),
  customerKey: z.string(),
  tokenHash: Sha256Hex,
  startsAt: IsoDate,
  expiresAt: IsoDate,
  status: z.nativeEnum(SubscriptionStatus),
  planTitle: z.string(),
  memberTail: z.string(),
  rev: z.number().int(),
});
export type SubscriptionCacheEntry = z.infer<typeof SubscriptionCacheEntry>;

// ---------------------------------------------------------------------------
// Sync events (device → server)
// ---------------------------------------------------------------------------

export const OfflineOrderLine = z.object({
  itemType: z.nativeEnum(ItemType),
  itemId: z.string().min(1).max(64),
  code: z.string().max(40),
  title: z.string().max(200),
  unit: z.string().max(40),
  categoryId: z.string().max(64).nullable(),
  categoryTitle: z.string().max(200).nullable(),
  unitPrice: Money,
  quantity: z.number().int().min(1).max(100),
  discountId: z.string().max(64).nullable(),
  discountTitle: z.string().max(200).nullable(),
  unitDiscount: Money,
  lineTotal: Money,
});
export type OfflineOrderLine = z.infer<typeof OfflineOrderLine>;

export const OrderOfflinePayload = z.object({
  localOrderId: Uuid,
  orderNumber: z.string().min(3).max(40),
  kind: z.nativeEnum(OrderKind),
  mobile: z.string(),
  createdAt: IsoDate,
  lines: z.array(OfflineOrderLine).min(1).max(100),
  subtotal: Money,
  discountTotal: Money,
  total: Money,
  qrTokenHash: Sha256Hex.nullable(),
  catalogRevision: z.number().int(),
});
export type OrderOfflinePayload = z.infer<typeof OrderOfflinePayload>;

export const PaymentResultPayload = z.object({
  paymentAttemptId: Uuid,
  localOrderId: Uuid,
  amount: Money,
  outcome: z.nativeEnum(TerminalOutcome),
  terminalRef: z.string().max(64).nullable(),
  rrn: z.string().max(64).nullable(),
  traceNo: z.string().max(64).nullable(),
  message: z.string().max(300).nullable(),
  source: z.nativeEnum(PaymentResultSource),
  occurredAt: IsoDate,
});
export type PaymentResultPayload = z.infer<typeof PaymentResultPayload>;

export const AccessLogPayload = z.object({
  tokenHash: Sha256Hex.nullable(),
  result: z.nativeEnum(AccessResult),
  checkedAt: IsoDate,
  offline: z.boolean(),
});
export type AccessLogPayload = z.infer<typeof AccessLogPayload>;

export const ReceiptPrintPayload = z.object({
  localOrderId: Uuid,
  printed: z.boolean(),
  detail: z.string().max(200).nullable(),
  at: IsoDate,
});
export type ReceiptPrintPayload = z.infer<typeof ReceiptPrintPayload>;

export const CommandResultPayload = z.object({
  commandId: z.string(),
  success: z.boolean(),
  result: z.unknown().optional(),
});
export type CommandResultPayload = z.infer<typeof CommandResultPayload>;

const eventBase = { eventId: Uuid, createdAt: IsoDate };
export const SyncEvent = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal(SyncEventType.ORDER_OFFLINE), payload: OrderOfflinePayload }),
  z.object({ ...eventBase, type: z.literal(SyncEventType.PAYMENT_RESULT), payload: PaymentResultPayload }),
  z.object({ ...eventBase, type: z.literal(SyncEventType.ACCESS_LOG), payload: AccessLogPayload }),
  z.object({ ...eventBase, type: z.literal(SyncEventType.RECEIPT_PRINT), payload: ReceiptPrintPayload }),
  z.object({ ...eventBase, type: z.literal(SyncEventType.COMMAND_RESULT), payload: CommandResultPayload }),
]);
export type SyncEvent = z.infer<typeof SyncEvent>;

export const SyncPushRequest = z.object({ events: z.array(SyncEvent).min(1).max(200) });
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

export const RejectedEvent = z.object({
  eventId: z.string(),
  code: z.string(),
  message: z.string(),
  /** true → the device should keep the event and retry later. */
  retryable: z.boolean(),
});
export type RejectedEvent = z.infer<typeof RejectedEvent>;

export const SyncPushResponse = z.object({
  acceptedEventIds: z.array(z.string()),
  rejectedEvents: z.array(RejectedEvent),
  results: z.record(z.string(), z.unknown()),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;

export const SyncPullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  subSince: z.coerce.number().int().min(0).default(0),
});

export const SyncPullResponse = z.object({
  serverTime: IsoDate,
  catalogRevision: z.number().int(),
  /** null when the device already has the latest catalogue revision. */
  catalog: Bootstrap.nullable(),
  subscriptions: z.array(SubscriptionCacheEntry),
  nextSubRev: z.number().int(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const HardwareStatus = z.object({
  state: z.nativeEnum(HardwareState),
  adapter: z.string().max(60),
  detail: z.string().max(200).nullable(),
});
export type HardwareStatus = z.infer<typeof HardwareStatus>;

export const HeartbeatRequest = z.object({
  appVersion: z.string().max(40),
  catalogRevision: z.number().int(),
  subRev: z.number().int(),
  hardware: z.object({ pos: HardwareStatus, printer: HardwareStatus, scanner: HardwareStatus }),
  outbox: z.object({
    pending: z.number().int().min(0),
    failed: z.number().int().min(0),
    oldestPendingAt: IsoDate.nullable(),
  }),
  unresolvedPayments: z.number().int().min(0),
  lastSyncAt: IsoDate.nullable(),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequest>;

export const DeviceCommandDto = z.object({
  id: z.string(),
  type: z.nativeEnum(DeviceCommandType),
  payload: z.record(z.string(), z.unknown()),
  createdAt: IsoDate,
});
export type DeviceCommandDto = z.infer<typeof DeviceCommandDto>;

export const HeartbeatResponse = z.object({
  serverTime: IsoDate,
  catalogRevision: z.number().int(),
  commands: z.array(DeviceCommandDto),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponse>;
