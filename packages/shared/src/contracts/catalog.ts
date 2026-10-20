import { z } from 'zod';
import {
  CategoryTheme,
  DiscountPolicy,
  DiscountTargetType,
  DiscountType,
  RenewalPolicy,
} from '../enums';
import { IsoDate, Money } from './common';

export const MediaRef = z.object({
  id: z.string(),
  checksum: z.string(),
  mime: z.string(),
  url: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type MediaRef = z.infer<typeof MediaRef>;

/** IANA time zone known to the runtime (an unknown one would make every date format call throw). */
function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const KioskSettings = z.object({
  centerName: z.string().min(1).max(120),
  centerSubtitle: z.string().max(200),
  logoMediaId: z.string().nullable(),
  receiptHeader: z.string().max(500),
  receiptFooter: z.string().max(500),
  supportText: z.string().max(300),
  /** Inactivity timeout before the session is cleared (seconds). */
  sessionTimeoutSec: z.number().int().min(30).max(900),
  /** Countdown shown before the timeout fires (seconds). */
  timeoutWarningSec: z.number().int().min(5).max(60),
  /** Seconds the end-of-session screen waits before returning to the start screen. */
  endScreenSec: z.number().int().min(3).max(60),
  /** Max seconds to wait for the card reader before treating the result as UNKNOWN. */
  paymentTimeoutSec: z.number().int().min(30).max(300),
  maxItemQuantity: z.number().int().min(1).max(20),
  discountPolicy: z.nativeEnum(DiscountPolicy),
  renewalPolicy: z.nativeEnum(RenewalPolicy),
  /** Offline QR validation from the kiosk cache (PRD §15, approved default: allowed). */
  offlineQrValidation: z.boolean(),
  /** Offline service sales (paid by card reader, synced later with an OFF code). */
  offlineSalesEnabled: z.boolean(),
  /** Offline subscription purchase. Policy still open (PRD appendix D) → default disabled. */
  offlineSubscriptionSales: z.boolean(),
  /** How long a cached catalogue stays usable offline before sales stop (hours). */
  offlineCatalogMaxAgeHours: z.number().int().min(1).max(720),
  timezone: z.string().refine(isTimeZone, 'منطقه زمانی نامعتبر است (مثال: Asia/Tehran)'),
  /** A short click sound on every tap (kiosk, web app, Android app). Older settings default to on. */
  tapSound: z.boolean().default(true),
  /** Red and blue smoke drifting on the start screen (kiosk, web app, Android app). Older settings default to on. */
  startSmoke: z.boolean().default(true),
});
export type KioskSettings = z.infer<typeof KioskSettings>;

export const KioskContent = z.object({
  welcome: z.object({
    title: z.string().max(120),
    subtitle: z.string().max(240),
    ctaLabel: z.string().max(40),
    heroMediaId: z.string().nullable(),
  }),
  home: z.object({
    title: z.string().max(120),
    servicesTitle: z.string().max(80),
    servicesSubtitle: z.string().max(160),
    subscriptionTitle: z.string().max(80),
    subscriptionSubtitle: z.string().max(160),
    memberTitle: z.string().max(80),
    memberSubtitle: z.string().max(160),
    /** Photo behind each home card (K02); null → plain themed card. Older saved content has none. */
    servicesMediaId: z.string().nullable().default(null),
    subscriptionMediaId: z.string().nullable().default(null),
    memberMediaId: z.string().nullable().default(null),
  }),
  subscriptionIntro: z.object({
    title: z.string().max(120),
    subtitle: z.string().max(240),
    benefits: z.array(z.string().max(160)).max(8),
  }),
  monitoringIntro: z.object({
    title: z.string().max(120),
    body: z.string().max(800),
    modules: z.array(z.string().max(120)).max(12),
  }),
});
export type KioskContent = z.infer<typeof KioskContent>;

export const ServiceDto = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  includes: z.array(z.string()),
  unit: z.string(),
  price: Money,
  mediaId: z.string().nullable(),
  categoryId: z.string(),
  subcategoryId: z.string(),
  fullAccessIncluded: z.boolean(),
  sortOrder: z.number().int(),
  revision: z.number().int(),
});
export type ServiceDto = z.infer<typeof ServiceDto>;

export const SubcategoryDto = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  mediaId: z.string().nullable(),
  sortOrder: z.number().int(),
  services: z.array(ServiceDto),
});
export type SubcategoryDto = z.infer<typeof SubcategoryDto>;

export const CategoryDto = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  subtitle: z.string(),
  description: z.string(),
  theme: z.nativeEnum(CategoryTheme),
  mediaId: z.string().nullable(),
  sortOrder: z.number().int(),
  /** false → shown as an informational category only (e.g. monitoring in the base version). */
  salesEnabled: z.boolean(),
  subscriptionCovered: z.boolean(),
  subcategories: z.array(SubcategoryDto),
});
export type CategoryDto = z.infer<typeof CategoryDto>;

export const PlanDto = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  durationDays: z.number().int().positive(),
  durationMonths: z.number().int().positive(),
  price: Money,
  badge: z.string().nullable(),
  /** Photo on the plan's card (absent from servers before 1.10). */
  mediaId: z.string().nullable().default(null),
  sortOrder: z.number().int(),
});
export type PlanDto = z.infer<typeof PlanDto>;

export const DiscountDto = z.object({
  id: z.string(),
  title: z.string(),
  type: z.nativeEnum(DiscountType),
  value: z.number().int().nonnegative(),
  priority: z.number().int(),
  active: z.boolean(),
  startsAt: IsoDate.nullable(),
  endsAt: IsoDate.nullable(),
  targets: z.array(z.object({ targetType: z.nativeEnum(DiscountTargetType), targetId: z.string() })),
});
export type DiscountDto = z.infer<typeof DiscountDto>;

export const Bootstrap = z.object({
  catalogRevision: z.number().int(),
  generatedAt: IsoDate,
  settings: KioskSettings,
  content: KioskContent,
  categories: z.array(CategoryDto),
  plans: z.array(PlanDto),
  discounts: z.array(DiscountDto),
  media: z.array(MediaRef),
});
export type Bootstrap = z.infer<typeof Bootstrap>;
