/** Persian display labels for domain enums (admin panel, receipts, kiosk). */
import type {
  AccessResult,
  AdminRole,
  DeviceCommandStatus,
  DeviceCommandType,
  DiscountTargetType,
  DiscountType,
  HardwareState,
  OrderKind,
  OrderStatus,
  PaymentResultSource,
  PaymentStatus,
  PrintStatus,
  SyncEventStatus,
} from './enums';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  LOCKED: 'در انتظار پرداخت',
  PAYMENT_PENDING: 'در حال پرداخت',
  PAID: 'پرداخت‌شده',
  FAILED: 'ناموفق',
  UNKNOWN: 'نامشخص',
  CANCELLED: 'لغوشده',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  INITIATED: 'شروع‌شده',
  PAID: 'موفق',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو در کارتخوان',
  UNKNOWN: 'نامشخص',
};

export const PAYMENT_SOURCE_LABEL: Record<PaymentResultSource, string> = {
  TERMINAL: 'پاسخ کارتخوان',
  INQUIRY: 'استعلام',
  RECONCILE: 'تطبیق دستی',
  RECOVERY: 'بازیابی پس از قطعی',
};

export const ORDER_KIND_LABEL: Record<OrderKind, string> = {
  SERVICES: 'خرید خدمات',
  SUBSCRIPTION: 'اشتراک کامل',
};

export const ACCESS_RESULT_LABEL: Record<AccessResult, string> = {
  ACTIVE: 'فعال',
  EXPIRED: 'منقضی',
  NOT_STARTED: 'هنوز شروع نشده',
  REVOKED: 'ابطال‌شده',
  INVALID: 'نامعتبر',
};

export const ROLE_LABEL: Record<AdminRole, string> = {
  ADMIN: 'مدیر اصلی',
  OPERATOR: 'اپراتور',
};

export const DISCOUNT_TYPE_LABEL: Record<DiscountType, string> = {
  PERCENT: 'درصدی',
  FIXED: 'مبلغ ثابت',
};

export const DISCOUNT_TARGET_LABEL: Record<DiscountTargetType, string> = {
  SERVICE: 'خدمت',
  SUBCATEGORY: 'زیرگروه',
  CATEGORY: 'حوزه',
  PLAN: 'پلن اشتراک',
};

export const PRINT_STATUS_LABEL: Record<PrintStatus, string> = {
  NOT_PRINTED: 'چاپ نشده',
  PRINTED: 'چاپ شد',
  FAILED: 'خطای چاپ',
};

export const HARDWARE_STATE_LABEL: Record<HardwareState, string> = {
  OK: 'سالم',
  WARNING: 'هشدار',
  ERROR: 'خطا',
  UNKNOWN: 'نامشخص',
};

export const SYNC_STATUS_LABEL: Record<SyncEventStatus, string> = {
  APPLIED: 'اعمال‌شده',
  REJECTED: 'ردشده',
  CONFLICT: 'مغایرت',
};

export const COMMAND_TYPE_LABEL: Record<DeviceCommandType, string> = {
  PAYMENT_INQUIRY: 'استعلام پرداخت',
  PRINT_RECEIPT: 'چاپ مجدد رسید',
  SYNC_NOW: 'همگام‌سازی فوری',
};

export const COMMAND_STATUS_LABEL: Record<DeviceCommandStatus, string> = {
  PENDING: 'در صف',
  DELIVERED: 'تحویل به دستگاه',
  DONE: 'انجام شد',
  FAILED: 'ناموفق',
};
