import { z } from 'zod';
import {
  AdminRole,
  CategoryTheme,
  DiscountTargetType,
  DiscountType,
  OrderKind,
  OrderStatus,
  PaymentStatus,
} from '../enums';
import { KioskContent, KioskSettings } from './catalog';
import { IsoDate, Money, PageQuery } from './common';

const code = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[A-Za-z0-9-]+$/, 'کد فقط شامل حروف لاتین، عدد و خط تیره است');
/** A real calendar day as YYYY-MM-DD: 2026-02-30 would otherwise roll over to March silently. */
const DateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'تاریخ نامعتبر است');

// ---------------------------------------------------------------------------
// Auth & users
// ---------------------------------------------------------------------------

export const LoginRequest = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
  /** kiosk = signed in from the kiosk's gear: a short session (KIOSK_ADMIN_SESSION_MINUTES). */
  client: z.enum(['panel', 'kiosk']).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const AdminUserDto = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: z.nativeEnum(AdminRole),
  active: z.boolean(),
  lastLoginAt: IsoDate.nullable(),
  lockedUntil: IsoDate.nullable(),
  createdAt: IsoDate,
});
export type AdminUserDto = z.infer<typeof AdminUserDto>;

export const LoginResponse = z.object({ token: z.string(), expiresAt: IsoDate, user: AdminUserDto });
export type LoginResponse = z.infer<typeof LoginResponse>;

const password = z.string().min(8, 'رمز عبور حداقل ۸ کاراکتر است').max(200);

export const CreateUserRequest = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'نام کاربری فقط حروف کوچک لاتین، عدد و . _ -'),
  displayName: z.string().trim().min(2).max(80),
  password,
  role: z.nativeEnum(AdminRole),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

export const UpdateUserRequest = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  role: z.nativeEnum(AdminRole).optional(),
  active: z.boolean().optional(),
  password: password.optional(),
  unlock: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

export const ChangePasswordRequest = z.object({ currentPassword: z.string().min(1), newPassword: password });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const CategoryUpsert = z.object({
  code,
  title: z.string().trim().min(2).max(80),
  subtitle: z.string().trim().max(160).default(''),
  description: z.string().trim().max(1000).default(''),
  theme: z.nativeEnum(CategoryTheme),
  mediaId: z.string().nullable().default(null),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
  salesEnabled: z.boolean().default(true),
  subscriptionCovered: z.boolean().default(true),
});
export type CategoryUpsert = z.infer<typeof CategoryUpsert>;

export const SubcategoryUpsert = z.object({
  categoryId: z.string().min(1),
  code,
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(''),
  mediaId: z.string().nullable().default(null),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});
export type SubcategoryUpsert = z.infer<typeof SubcategoryUpsert>;

export const ServiceUpsert = z
  .object({
    code,
    title: z.string().trim().min(2).max(160),
    subcategoryId: z.string().min(1),
    description: z.string().trim().max(2000).default(''),
    includes: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
    unit: z.string().trim().min(1).max(40),
    price: Money.nullable(),
    mediaId: z.string().nullable().default(null),
    fullAccessIncluded: z.boolean().default(true),
    active: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .refine((v) => !v.active || v.price !== null, {
    message: 'خدمت بدون تعرفه قابل فعال‌سازی نیست',
    path: ['price'],
  });
export type ServiceUpsert = z.infer<typeof ServiceUpsert>;

export const PlanUpsert = z.object({
  code,
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(''),
  durationDays: z.number().int().min(1).max(1100),
  durationMonths: z.number().int().min(1).max(36),
  price: Money,
  badge: z.string().trim().max(40).nullable().default(null),
  mediaId: z.string().nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type PlanUpsert = z.infer<typeof PlanUpsert>;

export const DiscountUpsert = z
  .object({
    title: z.string().trim().min(2).max(80),
    type: z.nativeEnum(DiscountType),
    value: z.number().int().min(1),
    priority: z.number().int().min(0).max(9999).default(100),
    active: z.boolean().default(true),
    startsAt: IsoDate.nullable().default(null),
    endsAt: IsoDate.nullable().default(null),
    targets: z
      .array(z.object({ targetType: z.nativeEnum(DiscountTargetType), targetId: z.string().min(1) }))
      .min(1, 'حداقل یک هدف برای تخفیف لازم است'),
  })
  .refine((v) => v.type !== DiscountType.PERCENT || v.value <= 100, {
    message: 'درصد تخفیف حداکثر ۱۰۰ است',
    path: ['value'],
  })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'پایان بازه باید بعد از شروع باشد',
    path: ['endsAt'],
  });
export type DiscountUpsert = z.infer<typeof DiscountUpsert>;

export const ReorderRequest = z.object({ ids: z.array(z.string()).min(1).max(500) });
export type ReorderRequest = z.infer<typeof ReorderRequest>;

export const SettingsUpdate = KioskSettings.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;
export const ContentUpdate = KioskContent;
export type ContentUpdate = z.infer<typeof ContentUpdate>;

// ---------------------------------------------------------------------------
// Subscriptions / orders / payments
// ---------------------------------------------------------------------------

export const ReasonRequest = z.object({ reason: z.string().trim().min(5, 'ذکر دلیل الزامی است').max(500) });
export type ReasonRequest = z.infer<typeof ReasonRequest>;

export const ExtendSubscriptionRequest = z.object({
  days: z.number().int().min(1).max(400),
  reason: z.string().trim().min(5).max(500),
});
export type ExtendSubscriptionRequest = z.infer<typeof ExtendSubscriptionRequest>;

export const OrdersQuery = PageQuery.extend({
  q: z.string().trim().max(40).optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  kind: z.nativeEnum(OrderKind).optional(),
  from: DateKey.optional(),
  to: DateKey.optional(),
  conflict: z.enum(['true', 'false']).optional(),
  offline: z.enum(['true', 'false']).optional(),
});
export type OrdersQuery = z.infer<typeof OrdersQuery>;

export const PaymentsQuery = PageQuery.extend({
  status: z.nativeEnum(PaymentStatus).optional(),
  from: DateKey.optional(),
  to: DateKey.optional(),
  q: z.string().trim().max(40).optional(),
});
export type PaymentsQuery = z.infer<typeof PaymentsQuery>;

export const SubscriptionsQuery = PageQuery.extend({
  q: z.string().trim().max(40).optional(),
  state: z.enum(['active', 'expired', 'upcoming', 'cancelled']).optional(),
  planId: z.string().optional(),
});
export type SubscriptionsQuery = z.infer<typeof SubscriptionsQuery>;

export const ReportQuery = z.object({
  from: DateKey,
  to: DateKey,
  categoryId: z.string().optional(),
  serviceId: z.string().optional(),
  planId: z.string().optional(),
  kind: z.nativeEnum(OrderKind).optional(),
  discountId: z.string().optional(),
});
export type ReportQuery = z.infer<typeof ReportQuery>;

export const DashboardQuery = z.object({ from: DateKey.optional(), to: DateKey.optional() });

export const AuditQuery = PageQuery.extend({
  action: z.string().max(60).optional(),
  entityType: z.string().max(60).optional(),
  actorId: z.string().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export const CreateDeviceRequest = z.object({
  id: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[A-Z0-9-]+$/, 'شناسه دستگاه فقط حروف بزرگ لاتین، عدد و خط تیره'),
  name: z.string().trim().min(2).max(80),
});
export type CreateDeviceRequest = z.infer<typeof CreateDeviceRequest>;

export const PrintReceiptCommandRequest = z.object({ deviceId: z.string().min(1) });
export type PrintReceiptCommandRequest = z.infer<typeof PrintReceiptCommandRequest>;
