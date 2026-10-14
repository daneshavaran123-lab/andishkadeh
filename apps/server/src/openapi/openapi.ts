import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z, type ZodTypeAny } from 'zod';
import * as C from '@andishkadeh/shared';

// Patches ZodType.prototype, so schemas created earlier in @andishkadeh/shared gain .openapi() too.
extendZodWithOpenApi(z);
// Under test runners the shared package may resolve a separate zod module instance.
if ((C.zod as unknown) !== z) extendZodWithOpenApi(C.zod as unknown as typeof z);

/**
 * OpenAPI document generated from the same zod contracts the code validates with,
 * so documentation can not drift from the implementation. Served at /api/docs.
 */
export function buildOpenApiDocument(): OpenAPIObject {
  const r = new OpenAPIRegistry();
  r.registerComponent('securitySchemes', 'device', {
    type: 'apiKey',
    in: 'header',
    name: 'Authorization',
    description: 'Device <deviceId>:<apiKey>  (یا هدرهای X-Device-Id و X-Device-Key)',
  });
  r.registerComponent('securitySchemes', 'admin', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });

  const json = (schema: ZodTypeAny) => ({ content: { 'application/json': { schema } } });
  const errors = {
    400: { description: 'ورودی نامعتبر (VALIDATION_FAILED)', ...json(C.ApiErrorBody) },
    401: { description: 'احراز هویت لازم است', ...json(C.ApiErrorBody) },
    403: { description: 'نقش کاربر مجاز نیست (RBAC)', ...json(C.ApiErrorBody) },
    409: { description: 'تعارض / پرداخت در جریان / نامشخص', ...json(C.ApiErrorBody) },
  };
  type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
  const path = (
    method: Method,
    p: string,
    tag: string,
    summary: string,
    opts: { body?: ZodTypeAny; query?: z.AnyZodObject; response?: ZodTypeAny; auth?: 'device' | 'admin' | null; params?: string[] } = {},
  ) =>
    r.registerPath({
      method,
      path: `/api/v1${p}`,
      tags: [tag],
      summary,
      security: opts.auth === null ? [] : [{ [opts.auth ?? 'admin']: [] }],
      request: {
        ...(opts.body ? { body: json(opts.body) } : {}),
        ...(opts.query ? { query: opts.query } : {}),
        ...(opts.params ? { params: z.object(Object.fromEntries(opts.params.map((k) => [k, z.string()]))) } : {}),
      },
      responses: { 200: { description: 'OK', ...(opts.response ? json(opts.response) : {}) }, ...errors },
    });

  // Kiosk
  path('get', '/kiosk/bootstrap', 'Kiosk', 'کاتالوگ، پلن‌ها، تخفیف‌ها، تنظیمات و revision', { auth: 'device', response: C.Bootstrap });
  path('post', '/orders', 'Kiosk', 'ایجاد و قفل قیمت سفارش (idempotent روی localOrderId)', { auth: 'device', body: C.CreateOrderRequest, response: C.OrderDto });
  path('post', '/orders/{id}/checkout', 'Kiosk', 'خواندن سفارش قفل‌شده', { auth: 'device', params: ['id'], response: C.OrderDto });
  path('post', '/orders/{id}/cancel', 'Kiosk', 'لغو سفارش پرداخت‌نشده', { auth: 'device', params: ['id'], response: C.OrderDto });
  path('post', '/payments/initiate', 'Kiosk', 'شروع تلاش پرداخت (یک تلاش فعال برای هر سفارش)', { auth: 'device', body: C.InitiatePaymentRequest, response: C.InitiatePaymentResponse });
  path('post', '/payments/{id}/result', 'Kiosk', 'گزارش نتیجه کارتخوان', { auth: 'device', params: ['id'], body: C.PaymentResultRequest, response: C.PaymentResultResponse });
  path('get', '/payments/{id}/status', 'Kiosk', 'استعلام وضعیت پرداخت', { auth: 'device', params: ['id'], response: C.PaymentStatusResponse });
  path('post', '/subscriptions/activate', 'Kiosk', 'نتیجه فعال‌سازی اشتراک (خودکار پس از PAID)', { auth: 'device', body: z.object({ orderId: z.string() }), response: C.SubscriptionSummary.nullable() });
  path('post', '/access/validate', 'Kiosk', 'اعتبارسنجی QR عضویت', { auth: 'device', body: C.ValidateAccessRequest, response: C.ValidateAccessResponse });
  path('post', '/sync/push', 'Sync', 'ارسال batch رویدادهای محلی (idempotent روی eventId)', { auth: 'device', body: C.SyncPushRequest, response: C.SyncPushResponse });
  path('get', '/sync/pull', 'Sync', 'دریافت تغییرات کاتالوگ و کش اشتراک‌ها', { auth: 'device', query: z.object({ since: z.string(), subSince: z.string() }), response: C.SyncPullResponse });
  path('post', '/devices/heartbeat', 'Devices', 'وضعیت کیوسک و دریافت فرمان‌ها', { auth: 'device', body: C.HeartbeatRequest, response: C.HeartbeatResponse });
  path('post', '/devices/commands/{id}/result', 'Devices', 'نتیجه اجرای فرمان', { auth: 'device', params: ['id'], body: z.object({ success: z.boolean(), result: z.unknown().optional() }) });
  path('get', '/health', 'System', 'سلامت سرویس', { auth: null });

  // Admin
  path('post', '/admin/auth/login', 'Admin · Auth', 'ورود (قفل موقت پس از تلاش‌های ناموفق)', { auth: null, body: C.LoginRequest, response: C.LoginResponse });
  path('get', '/admin/auth/me', 'Admin · Auth', 'کاربر جاری', { response: C.AdminUserDto });
  path('post', '/admin/auth/change-password', 'Admin · Auth', 'تغییر رمز', { body: C.ChangePasswordRequest });
  path('get', '/admin/users', 'Admin · Users', 'فهرست کاربران (ADMIN)', { response: z.array(C.AdminUserDto) });
  path('post', '/admin/users', 'Admin · Users', 'ایجاد کاربر (ADMIN)', { body: C.CreateUserRequest, response: C.AdminUserDto });
  path('patch', '/admin/users/{id}', 'Admin · Users', 'ویرایش/غیرفعال‌سازی/بازنشانی رمز (ADMIN)', { params: ['id'], body: C.UpdateUserRequest, response: C.AdminUserDto });
  path('get', '/admin/dashboard', 'Admin · Dashboard', 'KPI، روند فروش ۳۰ روزه، هشدارها');
  path('get', '/admin/categories', 'Admin · Catalog', 'حوزه‌ها و زیرگروه‌ها');
  path('post', '/admin/categories', 'Admin · Catalog', 'ایجاد حوزه (ADMIN)', { body: C.CategoryUpsert });
  path('patch', '/admin/categories/{id}', 'Admin · Catalog', 'ویرایش حوزه (ADMIN)', { params: ['id'], body: C.CategoryUpsert });
  path('post', '/admin/categories/reorder', 'Admin · Catalog', 'ترتیب نمایش حوزه‌ها (ADMIN)', { body: C.ReorderRequest });
  path('post', '/admin/subcategories', 'Admin · Catalog', 'ایجاد زیرگروه (ADMIN)', { body: C.SubcategoryUpsert });
  path('patch', '/admin/subcategories/{id}', 'Admin · Catalog', 'ویرایش زیرگروه (ADMIN)', { params: ['id'], body: C.SubcategoryUpsert });
  path('get', '/admin/services', 'Admin · Catalog', 'فهرست خدمات', { query: z.object({ q: z.string().optional(), categoryId: z.string().optional(), subcategoryId: z.string().optional(), status: z.enum(['active', 'inactive', 'noprice']).optional() }) });
  path('post', '/admin/services', 'Admin · Catalog', 'ایجاد خدمت (ADMIN)', { body: C.ServiceUpsert });
  path('patch', '/admin/services/{id}', 'Admin · Catalog', 'ویرایش خدمت و تعرفه (ADMIN، با Audit)', { params: ['id'], body: C.ServiceUpsert });
  path('delete', '/admin/services/{id}', 'Admin · Catalog', 'حذف نرم خدمت (ADMIN)', { params: ['id'] });
  path('get', '/admin/plans', 'Admin · Catalog', 'پلن‌های اشتراک');
  path('post', '/admin/plans', 'Admin · Catalog', 'ایجاد پلن (ADMIN)', { body: C.PlanUpsert });
  path('patch', '/admin/plans/{id}', 'Admin · Catalog', 'ویرایش پلن (ADMIN)', { params: ['id'], body: C.PlanUpsert });
  path('get', '/admin/discounts', 'Admin · Discounts', 'فهرست تخفیف‌ها');
  path('post', '/admin/discounts', 'Admin · Discounts', 'ایجاد تخفیف (ADMIN)', { body: C.DiscountUpsert });
  path('patch', '/admin/discounts/{id}', 'Admin · Discounts', 'ویرایش تخفیف (ADMIN)', { params: ['id'], body: C.DiscountUpsert });
  path('delete', '/admin/discounts/{id}', 'Admin · Discounts', 'حذف تخفیف (ADMIN)', { params: ['id'] });
  path('post', '/admin/discounts/preview', 'Admin · Discounts', 'پیش‌نمایش مبلغ نهایی قبل از انتشار', { body: C.DiscountUpsert });
  path('get', '/admin/media', 'Admin · Media', 'کتابخانه رسانه');
  path('post', '/admin/media', 'Admin · Media', 'بارگذاری تصویر (multipart: file) (ADMIN)');
  path('delete', '/admin/media/{id}', 'Admin · Media', 'حذف تصویر بدون استفاده (ADMIN)', { params: ['id'] });
  path('get', '/admin/settings', 'Admin · Settings', 'تنظیمات کیوسک', { response: C.KioskSettings });
  path('put', '/admin/settings', 'Admin · Settings', 'ویرایش تنظیمات (ADMIN)', { body: C.SettingsUpdate, response: C.KioskSettings });
  path('get', '/admin/content', 'Admin · Settings', 'محتوای صفحه شروع و متن‌ها', { response: C.KioskContent });
  path('put', '/admin/content', 'Admin · Settings', 'ویرایش محتوا (ADMIN)', { body: C.ContentUpdate, response: C.KioskContent });
  path('get', '/admin/orders', 'Admin · Orders', 'جست‌وجو و فیلتر سفارش‌ها', { query: C.OrdersQuery });
  path('get', '/admin/orders/{id}', 'Admin · Orders', 'جزئیات سفارش با snapshot قیمت', { params: ['id'] });
  path('get', '/admin/orders/{id}/receipt', 'Admin · Orders', 'داده رسید برای چاپ مجدد', { params: ['id'], response: C.ReceiptData });
  path('post', '/admin/orders/{id}/print', 'Admin · Orders', 'چاپ مجدد روی چاپگر کیوسک', { params: ['id'], body: C.PrintReceiptCommandRequest });
  path('post', '/admin/orders/{id}/resolve-conflict', 'Admin · Orders', 'ثبت بررسی مغایرت (ADMIN)', { params: ['id'], body: C.ReasonRequest });
  path('get', '/admin/payments', 'Admin · Payments', 'تراکنش‌ها', { query: C.PaymentsQuery });
  path('post', '/admin/payments/{id}/reconcile', 'Admin · Payments', 'تطبیق دستی پرداخت نامشخص (ADMIN، با دلیل و Audit)', { params: ['id'], body: C.ReconcileRequest });
  path('post', '/admin/payments/{id}/inquire', 'Admin · Payments', 'ارسال فرمان استعلام به کیوسک', { params: ['id'] });
  path('get', '/admin/subscriptions', 'Admin · Subscriptions', 'جست‌وجوی اشتراک‌ها', { query: C.SubscriptionsQuery });
  path('get', '/admin/subscriptions/{id}', 'Admin · Subscriptions', 'جزئیات عضو و سوابق QR', { params: ['id'] });
  path('post', '/admin/subscriptions/{id}/cancel', 'Admin · Subscriptions', 'ابطال (ADMIN)', { params: ['id'], body: C.ReasonRequest });
  path('post', '/admin/subscriptions/{id}/extend', 'Admin · Subscriptions', 'تمدید دستی (ADMIN)', { params: ['id'], body: C.ExtendSubscriptionRequest });
  path('post', '/admin/subscriptions/{id}/reissue-qr', 'Admin · Subscriptions', 'صدور مجدد QR (ADMIN)', { params: ['id'], body: C.ReasonRequest });
  path('get', '/admin/devices', 'Admin · Devices', 'وضعیت کیوسک‌ها و تجهیزات');
  path('post', '/admin/devices', 'Admin · Devices', 'ثبت دستگاه جدید (ADMIN)', { body: C.CreateDeviceRequest });
  path('post', '/admin/devices/{id}/rotate-key', 'Admin · Devices', 'کلید جدید دستگاه (ADMIN)', { params: ['id'] });
  path('post', '/admin/devices/{id}/sync-now', 'Admin · Devices', 'فرمان همگام‌سازی فوری (ADMIN)', { params: ['id'] });
  path('get', '/admin/devices/{id}/commands', 'Admin · Devices', 'سوابق فرمان‌ها', { params: ['id'] });
  path('get', '/admin/sync', 'Admin · Sync', 'صف و خطاهای همگام‌سازی');
  path('post', '/admin/sync/events/{id}/retry', 'Admin · Sync', 'اعمال مجدد رویداد ردشده (ADMIN)', { params: ['id'] });
  path('get', '/admin/reports/sales', 'Admin · Reports', 'گزارش فروش قطعی و نامشخص', { query: C.ReportQuery });
  path('get', '/admin/reports/sales/export', 'Admin · Reports', 'خروجی CSV/XLSX', { query: C.ReportQuery.extend({ format: z.enum(['csv', 'xlsx']) }) });
  path('get', '/admin/audit', 'Admin · Audit', 'سوابق تغییرات حساس (ADMIN)', { query: C.AuditQuery });

  const generator = new OpenApiGeneratorV3(r.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Andishkadeh Koshti Iran — Kiosk & Admin API',
      version: '1.0.0',
      description:
        'API کیوسک سلف‌سرویس و پنل مدیریت اندیشکده کشتی ایران. خطاها: { error: { code, message, details }, requestId }. ' +
        'مبالغ عدد صحیح تومان هستند. هیچ endpoint رزرو یا نوبت‌دهی وجود ندارد.',
    },
    servers: [{ url: '/' }],
  }) as unknown as OpenAPIObject;
}

export function setupOpenApi(app: INestApplication) {
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(), { jsonDocumentUrl: 'api/docs/openapi.json' });
}
