/**
 * Response shapes of the admin API (server → admin panel).
 * Requests are validated with zod (see admin.ts); responses are typed here.
 */
import type {
  AccessResult,
  AdminRole,
  DeviceCommandStatus,
  DeviceCommandType,
  OrderKind,
  OrderStatus,
  PaymentResultSource,
  PaymentStatus,
  PrintStatus,
  SubscriptionStatus,
  SyncEventStatus,
} from '../enums';
import type { HardwareStatus } from './sync';
import type { OrderItemDto } from './orders';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
}

export interface PaymentRow {
  id: string;
  orderId: string;
  orderNumber: string;
  deviceId: string;
  amount: number;
  status: PaymentStatus;
  terminalRef: string | null;
  rrn: string | null;
  source: PaymentResultSource | null;
  message: string | null;
  initiatedAt: string;
  resolvedAt: string | null;
  reconcileReason: string | null;
  reconciledBy: string | null;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  kind: OrderKind;
  status: OrderStatus;
  mobileMasked: string;
  total: number;
  discountTotal: number;
  itemsCount: number;
  deviceId: string;
  offline: boolean;
  conflictFlag: boolean;
  printStatus: PrintStatus;
  createdAt: string;
  paidAt: string | null;
}

export interface OrderDetail extends OrderRow {
  localId: string;
  subtotal: number;
  conflictNote: string | null;
  lockedAt: string;
  items: OrderItemDto[];
  payments: PaymentRow[];
  subscription: { id: string; planTitle: string; startsAt: string; expiresAt: string; status: SubscriptionStatus } | null;
}

export type SubscriptionState = 'active' | 'expired' | 'upcoming' | 'cancelled';

export interface SubscriptionRow {
  id: string;
  mobileMasked: string;
  planTitle: string;
  startsAt: string;
  expiresAt: string;
  status: SubscriptionStatus;
  state: SubscriptionState;
  orderId: string;
  orderNumber: string;
  qrIssuedAt: string;
  createdAt: string;
}

export interface SubscriptionDetail extends SubscriptionRow {
  cancelReason: string | null;
  cancelledAt: string | null;
  accessLogs: Array<{ id: string; checkedAt: string; result: AccessResult; deviceId: string; offline: boolean }>;
  memberHistory: SubscriptionRow[];
}

export interface DeviceRow {
  id: string;
  name: string;
  active: boolean;
  online: boolean;
  lastSeenAt: string | null;
  appVersion: string | null;
  catalogRevision: number | null;
  hardware: { pos: HardwareStatus; printer: HardwareStatus; scanner: HardwareStatus } | null;
  outbox: { pending: number; failed: number; oldestPendingAt: string | null } | null;
  unresolvedPayments: number;
  lastSyncAt: string | null;
}

/** Release of this server; the Windows kiosk installer of the same version (A15). */
export interface SystemInfo {
  version: string;
  kioskInstallerUrl: string;
  /** Address kiosks connect to (PUBLIC_BASE_URL). */
  publicBaseUrl: string;
}

/** Whether the Windows kiosk installer can be downloaded (null: could not be checked). */
export interface KioskInstallerInfo {
  version: string;
  url: string;
  available: boolean | null;
}

export interface DeviceCommandRow {
  id: string;
  deviceId: string;
  type: DeviceCommandType;
  status: DeviceCommandStatus;
  payload: Record<string, unknown>;
  result: unknown;
  createdAt: string;
  completedAt: string | null;
  createdBy: string | null;
}

export interface SyncEventRow {
  id: string;
  deviceId: string;
  type: string;
  status: SyncEventStatus;
  error: string | null;
  retryCount: number;
  receivedAt: string;
  appliedAt: string | null;
}

export interface SyncOverview {
  devices: DeviceRow[];
  totals: { applied: number; rejected: number; conflict: number };
  events: SyncEventRow[];
}

export interface MediaRow {
  id: string;
  url: string;
  originalName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  createdAt: string;
  usage: number;
}

export interface AuditRow {
  id: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export interface DashboardResponse {
  timezone: string;
  today: string;
  kpis: {
    todaySales: number;
    todayPaidOrders: number;
    activeSubscriptions: number;
    devicesOnline: number;
    devicesTotal: number;
  };
  salesSeries: Array<{ date: string; total: number; orders: number }>;
  categoryShare: Array<{ title: string; total: number }>;
  recentPayments: PaymentRow[];
  alerts: {
    unknownPayments: number;
    conflicts: number;
    syncPending: number;
    syncRejected: number;
    hardwareErrors: number;
    staleDevices: number;
    printFailures: number;
  };
  devices: DeviceRow[];
}

export interface ReportBucket {
  key: string;
  title: string;
  total: number;
  count: number;
  discount: number;
}

export interface ReportResponse {
  range: { from: string; to: string };
  summary: {
    paidTotal: number;
    paidCount: number;
    discountTotal: number;
    unknownTotal: number;
    unknownCount: number;
    failedCount: number;
    servicesTotal: number;
    subscriptionsTotal: number;
  };
  byDay: Array<{ date: string; total: number; count: number }>;
  byCategory: ReportBucket[];
  byService: ReportBucket[];
  byPlan: ReportBucket[];
  byDiscount: ReportBucket[];
}

export interface AdminCategory {
  id: string;
  code: string;
  title: string;
  subtitle: string;
  description: string;
  theme: string;
  mediaId: string | null;
  mediaUrl: string | null;
  sortOrder: number;
  active: boolean;
  salesEnabled: boolean;
  subscriptionCovered: boolean;
  subcategories: AdminSubcategory[];
}

export interface AdminSubcategory {
  id: string;
  categoryId: string;
  code: string;
  title: string;
  description: string;
  mediaId: string | null;
  sortOrder: number;
  active: boolean;
  serviceCount: number;
}

export interface AdminService {
  id: string;
  code: string;
  title: string;
  subcategoryId: string;
  subcategoryTitle: string;
  categoryId: string;
  categoryTitle: string;
  description: string;
  includes: string[];
  unit: string;
  price: number | null;
  mediaId: string | null;
  mediaUrl: string | null;
  fullAccessIncluded: boolean;
  active: boolean;
  sortOrder: number;
  revision: number;
  updatedAt: string;
}

export interface AdminPlan {
  id: string;
  code: string;
  title: string;
  description: string;
  durationDays: number;
  durationMonths: number;
  price: number;
  badge: string | null;
  active: boolean;
  sortOrder: number;
  subscriptionCount: number;
}

export interface AdminDiscount {
  id: string;
  title: string;
  type: string;
  value: number;
  priority: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  targets: Array<{ targetType: string; targetId: string; label: string }>;
  live: boolean;
}

export interface DiscountPreviewRow {
  itemType: 'SERVICE' | 'PLAN';
  itemId: string;
  code: string;
  title: string;
  price: number;
  /** Final price if this discount were published, after policy resolution with live discounts. */
  finalPrice: number;
  /** Discount that would actually apply (may be another, larger one under the BEST policy). */
  appliedDiscount: string | null;
}
