/**
 * IPC contract between the kiosk UI (renderer) and the kiosk core (Electron main process,
 * or the dev bridge in browser mode). Only these channels exist — the preload script
 * exposes nothing else (contextIsolation + allowlist, PRD §18).
 */
import type {
  Bootstrap,
  HardwareStatus,
  ItemType,
  OrderItemDto,
  OrderKind,
  OrderStatus,
  TerminalOutcome,
  ValidateAccessResponse,
} from '@andishkadeh/shared';
import type { AdminLoginRequest, AdminLoginResult } from './admin-access';

export interface KioskStatus {
  deviceId: string;
  appVersion: string;
  /** Server reachable on the last request. */
  online: boolean;
  catalogRevision: number;
  catalogUpdatedAt: string | null;
  /** Sales can start: a usable catalogue exists and (online or offline sales allowed). */
  salesAvailable: boolean;
  subscriptionSalesAvailable: boolean;
  hardware: { pos: HardwareStatus; printer: HardwareStatus; scanner: HardwareStatus };
  /** true when any adapter is simulated — the UI must show a test-mode banner. */
  mockHardware: boolean;
  outbox: { pending: number; failed: number };
  unresolvedPayments: number;
  lastSyncAt: string | null;
}

export interface AppState {
  bootstrap: Bootstrap | null;
  status: KioskStatus;
  /** Base URL for cached media: `${mediaBase}/${checksum}`. */
  mediaBase: string;
}

export interface LocalOrderView {
  localOrderId: string;
  serverOrderId: string | null;
  orderNumber: string;
  kind: OrderKind;
  status: OrderStatus;
  offline: boolean;
  mobileMasked: string;
  items: OrderItemDto[];
  subtotal: number;
  discountTotal: number;
  total: number;
  priceChanged: boolean;
  activeCoverageUntil: string | null;
  periodPreview: { startsAt: string; expiresAt: string; extended: boolean } | null;
  subscription: { planTitle: string; startsAt: string; expiresAt: string; extended: boolean } | null;
  /** Raw QR token — only present after a confirmed payment of a subscription order. */
  qrToken: string | null;
  /** true while the server has not yet confirmed the payment result (offline / network drop). */
  syncPending: boolean;
  createdAt: string;
}

export interface CreateOrderInput {
  kind: OrderKind;
  mobile: string;
  items: Array<{ itemType: ItemType; itemId: string; quantity: number }>;
  expectedTotal?: number;
}

export type CreateOrderResult =
  | { ok: true; order: LocalOrderView }
  | { ok: false; code: string; message: string; unavailable?: string[] };

export interface PaymentOutcomeView {
  outcome: TerminalOutcome;
  message: string;
  order: LocalOrderView;
  /** A new attempt may be started (only after FAILED/CANCELLED; never after UNKNOWN). */
  canRetry: boolean;
}

export type PaymentStartResult = { ok: true; result: PaymentOutcomeView } | { ok: false; code: string; message: string };

export type ValidateResult =
  | { ok: true; result: ValidateAccessResponse }
  | { ok: false; code: 'OFFLINE_VALIDATION_DISABLED' | 'SCANNER_ERROR' | 'ERROR'; message: string };

export interface PrintResult {
  printed: boolean;
  detail: string | null;
}

export type DevControl =
  | { action: 'posScenario'; scenario: 'approve' | 'decline' | 'unknown' | 'timeout' | 'cancel' }
  | { action: 'inquiryMode'; mode: 'truth' | 'unknown' }
  | { action: 'printerMode'; mode: 'ok' | 'paper-out' | 'offline' }
  | { action: 'scannerMode'; mode: 'ok' | 'offline' }
  | { action: 'replayOutbox' }
  | { action: 'scan'; payload: string }
  | { action: 'network'; online: boolean }
  | { action: 'syncNow' };

/** request → response map of every allowed invoke channel. */
export interface IpcChannels {
  'app:getState': { req: void; res: AppState };
  'order:create': { req: CreateOrderInput; res: CreateOrderResult };
  'order:cancel': { req: { localOrderId: string }; res: { ok: boolean } };
  'payment:start': { req: { localOrderId: string }; res: PaymentStartResult };
  'payment:inquire': { req: { localOrderId: string }; res: PaymentStartResult };
  'receipt:print': { req: { localOrderId: string }; res: PrintResult };
  'access:validate': { req: { token: string }; res: ValidateResult };
  'session:end': { req: void; res: { ok: boolean } };
  'dev:control': { req: DevControl; res: { ok: boolean; message?: string } };
  /** Staff sign-in from the gear on the welcome screen (see core/admin-access.ts). */
  'admin:login': { req: AdminLoginRequest; res: AdminLoginResult };
}

export type IpcChannel = keyof IpcChannels;

export const IPC_CHANNELS: IpcChannel[] = [
  'app:getState',
  'order:create',
  'order:cancel',
  'payment:start',
  'payment:inquire',
  'receipt:print',
  'access:validate',
  'session:end',
  'dev:control',
  'admin:login',
];

export interface IpcEvents {
  status: KioskStatus;
  catalog: AppState;
  'scanner:scan': { payload: string };
  /**
   * Windows app: the admin panel window opened from the kiosk was closed (logout, idle, expiry).
   * `message` is set when the panel could not be shown at all.
   */
  admin: { open: boolean; message?: string };
}

export type IpcEvent = keyof IpcEvents;
export const IPC_EVENTS: IpcEvent[] = ['status', 'catalog', 'scanner:scan', 'admin'];
