# معماری سامانه

## نمای کلی

```mermaid
flowchart LR
  subgraph Kiosk["کیوسک: ویندوز (Electron) · وب‌اپ (PWA) · اندروید (Capacitor)"]
    UI["رابط React مشترک"]
    Core["هسته مشترک کیوسک<br/>ژورنال پرداخت · صف رویداد · کش رسانه · QR آفلاین"]
    Store[("SQLite<br/>better-sqlite3 (ویندوز)<br/>sql.js + IndexedDB (وب، اندروید)")]
    HW["آداپترها: کارتخوان · چاپگر · اسکنر"]
    UI -- "کانال‌های IPC (فهرست مجاز)" --> Core
    Core --> Store
    Core --> HW
  end
  subgraph Server["سرور مرکزی"]
    API["NestJS API /api/v1"]
    DB[("PostgreSQL")]
    Media[("پوشه رسانه<br/>آدرس‌دهی با sha256")]
    API --> DB
    API --> Media
  end
  Admin["پنل مدیریت (React SPA)"] -- "JWT + RBAC" --> API
  Core -- "Device key (HTTPS)" --> API
```

- **قراردادها در یک جا**: همه درخواست‌ها و پاسخ‌ها در `packages/shared/src/contracts` با zod تعریف شده‌اند. سرور ورودی را با همین schemaها اعتبارسنجی می‌کند، کلاینت‌ها نوع‌ها را از همان‌جا می‌گیرند و OpenAPI هم از همین تعریف‌ها تولید می‌شود.
- **پول**: همه مبالغ عدد صحیح تومان هستند. قیمت و تخفیف هر قلم در لحظه قفل سفارش در `OrderItem` به‌صورت snapshot ذخیره می‌شود. تغییر بعدی تعرفه یا تخفیف، سفارش‌های قبلی را تغییر نمی‌دهد.
- **موتور قیمت**: `packages/shared/src/pricing.ts` هم در سرور و هم در کیوسک اجرا می‌شود:
  - تخفیف به ازای هر واحد اعمال می‌شود و هدف آن می‌تواند خدمت، زیرگروه، حوزه یا پلن باشد.
  - سیاست انتخاب تخفیف `BEST` (پیش‌فرض) یا `PRIORITY` است و تساوی‌ها به‌صورت قطعی شکسته می‌شوند.
  - مرجع نهایی همیشه سرور است: اگر مبلغ پیش‌نمایش با مبلغ سرور فرق کند، مشتری پیش از پرداخت مطلع می‌شود.
- **تقویم**: نمایش تاریخ‌ها جلالی است و مرز روز با منطقه زمانی `Asia/Tehran` محاسبه می‌شود (`dates.ts`).

## سرور (`apps/server`)

| ماژول | مسئولیت |
| --- | --- |
| `auth` | ورود مدیر (JWT HS256 با `tokenVersion`)، قفل موقت پس از ۵ تلاش ناموفق به مدت ۱۵ دقیقه، محدودیت نرخ ورود برای هر IP، تغییر رمز و کاربران |
| `catalog` | حوزه، زیرگروه، خدمت، پلن، تخفیف، رسانه، محتوا و تنظیمات. هر تغییر `catalogRevision` را افزایش می‌دهد |
| `sales` | سفارش، پرداخت، فعال‌سازی اشتراک، بررسی اعتبار QR، دستگاه‌ها و فرمان‌ها، همگام‌سازی push/pull |
| `admin` | داشبورد، گزارش‌ها و خروجی CSV/XLSX، عملیات پشتیبانی (تطبیق، چاپ مجدد، ابطال، تمدید، صدور مجدد QR)، سوابق تغییرات |

- **احراز هویت دستگاه**: هدر `Authorization: Device <id>:<key>`. سرور فقط sha256 کلید را نگه می‌دارد و کلید از پنل قابل تعویض است.
- **RBAC در سرور**: دسترسی با `@Roles(ADMIN)` کنترل می‌شود. اپراتور فقط مشاهده، استعلام پرداخت و چاپ مجدد دارد. پنهان کردن دکمه در رابط، تنها لایه حفاظت نیست (تست T10).
- **خطاها**: قالب یکسان `{ error: { code, message, details }, requestId }` با هدر `X-Request-Id` در همه پاسخ‌ها.
- **سوابق تغییرات**: تغییر قیمت، تخفیف، تنظیمات، تطبیق پرداخت، ابطال و تمدید اشتراک، صدور مجدد QR و کاربران با مقادیر قبل و بعد و دلیل در `AuditLog` ثبت می‌شود و قابل ویرایش نیست.
- **تراکنش‌ها**: عملیات مالی در تراکنش `Serializable` با تکرار خودکار هنگام تداخل انجام می‌شوند.

## کیوسک (`apps/kiosk`)

یک رابط و یک هسته برای سه نسخه. جزئیات نصب و تفاوت‌ها: [کیوسک روی ویندوز، وب و اندروید](kiosk-platforms.md).

| میزبان هسته | کجا اجرا می‌شود | پایگاه محلی | تصاویر | چاپ |
| --- | --- | --- | --- | --- |
| Electron (`electron/main.ts`) | فرایند اصلی، جدا از رابط | `better-sqlite3` (فایل) | پوشه `media` | درایور ویندوز |
| وب‌اپ و اندروید (`src/platform/web`) | داخل صفحه | `sql.js` (WebAssembly) با ذخیره در IndexedDB | IndexedDB | مرورگر / سرویس چاپ اندروید |
| bridge توسعه (`src/dev-bridge`) | Node، با HTTP و SSE برای رابط | `better-sqlite3` | پوشه `media` | شبیه‌ساز |

- **هسته مستقل از سکو** (`src/core`): هیچ وابستگی به Node یا مرورگر ندارد. پایگاه داده (`SqlDatabase` در `sql.ts`)، محل تصاویر (`MediaStore`) و چاپگر را میزبان تزریق می‌کند. هش sha256، توکن QR و شناسه‌ها از `packages/shared/src/token.ts` می‌آیند که در Node، مرورگر و WebView یکسان اجرا می‌شود. تست‌های یکپارچه هسته روی هر دو درایور SQLite اجرا می‌شوند.
- **هسته** شامل موارد زیر است:
  - کاتالوگ و کش رسانه با بررسی sha256 و جایگزین برای هر موجودیت
  - سفارش و پرداخت با ژورنال پیش از استفاده از کارتخوان
  - صف رویداد (outbox) و همگام‌سازی
  - بررسی اعتبار QR آنلاین و آفلاین
  - اجرای فرمان‌های پنل

  در ویندوز، پایگاه محلی SQLite با `journal_mode=WAL` و `synchronous=FULL` کار می‌کند. در وب و اندروید، پایگاه در حافظه است و پس از هر تغییر یک نسخه کامل و یکپارچه در IndexedDB ذخیره می‌شود. ثبت ژورنال پیش از کارتخوان و ثبت نتیجه پس از آن تا ذخیره قطعی صبر می‌کنند (`flush`).
- **رابط (renderer)**: در Electron، React با `contextIsolation` و `sandbox` و بدون دسترسی به Node اجرا می‌شود و فقط از طریق کانال‌های مجاز IPC (`src/core/types.ts`) با هسته حرف می‌زند. کلید دستگاه هرگز به رابط نمی‌رسد. در وب و اندروید همان کانال‌ها بدون مرز فرایند به هسته داخل صفحه وصل می‌شوند (`bridge.ts`). کلید دستگاه را تکنسین روی همان دستگاه وارد می‌کند و در هیچ فایل برنامه‌ای نیست.
- **آداپترهای سخت‌افزار** (`src/core/hardware`):

  | تجهیز | آداپتر |
  | --- | --- |
  | کارتخوان | `mock` (شبیه‌ساز با سناریو) یا `none` (SDK پیکربندی نشده؛ فروش متوقف می‌شود). SDK واقعی بانک هنوز در دست نیست؛ ر.ک. [موارد باز](open-items.md) |
  | چاپگر | `mock` (شبیه‌ساز)، `windows` (چاپ بی‌صدا با درایور ویندوز) یا `browser` (چاپ مرورگر در وب‌اپ، سرویس چاپ اندروید در اندروید) |
  | اسکنر | `keyboard` (USB HID در حالت keyboard-wedge) یا `mock` |

  هر آداپتر شبیه‌سازی‌شده نوار «حالت آزمایشی» را روی صفحه نشان می‌دهد.
- **بازیابی**:
  - پس از قطع برق یا بسته شدن برنامه، ژورنال پرداخت بررسی می‌شود. تلاش‌های `IN_FLIGHT` یا `UNKNOWN` از کارتخوان استعلام می‌شوند و نتیجه گزارش می‌شود.
  - اگر renderer از کار بیفتد، دوباره بارگذاری می‌شود.
  - برنامه تک‌نمونه است و از خواب رفتن سیستم جلوگیری می‌کند.

## مدل داده (ERD خلاصه)

```mermaid
erDiagram
  Category ||--o{ Subcategory : contains
  Subcategory ||--o{ Service : contains
  Media |o--o{ Category : image
  Media |o--o{ Service : image
  Customer ||--o{ Order : places
  Device ||--o{ Order : sells
  Order ||--|{ OrderItem : "price snapshot"
  Order ||--o{ PaymentAttempt : "attempts"
  Order ||--o| Subscription : activates
  SubscriptionPlan ||--o{ Subscription : plan
  Customer ||--o{ Subscription : owns
  Subscription ||--o{ AccessLog : "QR checks"
  Device ||--o{ AccessLog : logs
  Device ||--o{ DeviceCommand : receives
  Device ||--o{ SyncEvent : pushes
  Discount ||--|{ DiscountTarget : targets
  AdminUser ||--o{ AuditLog : acts

  Order {
    string orderNumber UK "AK-000123 / OFF-KIOSK-01-00001"
    string deviceId_localId UK "idempotent offline sync"
    enum status "LOCKED PAYMENT_PENDING PAID FAILED UNKNOWN CANCELLED"
    int subtotal
    int discountTotal
    int total
    bool offline
    bool conflictFlag
    enum printStatus
  }
  OrderItem {
    int unitPrice
    int unitDiscount
    string discountTitle
    int lineTotal
  }
  PaymentAttempt {
    string idempotencyKey UK
    enum status "INITIATED PAID FAILED CANCELLED UNKNOWN"
    enum source "TERMINAL INQUIRY RECONCILE RECOVERY"
    string terminalRef
    string rrn
  }
  Subscription {
    string qrTokenHash UK "sha256 only"
    datetime startsAt
    datetime expiresAt
    enum status "ACTIVE CANCELLED"
    int rev "kiosk cache delta"
  }
```

جدول‌های تکمیلی:

| جدول | کاربرد |
| --- | --- |
| `Setting` | سیاست‌ها و تنظیمات قابل تغییر در پنل |
| `Counter` | شماره سفارش، `catalogRevision` و `subscriptionRev` |
| `SyncEvent` | ثبت یکتای رویدادهای دستگاه با `eventId` |

## نمودارهای وضعیت

### سفارش و پرداخت

```mermaid
stateDiagram-v2
  [*] --> LOCKED: ثبت سفارش و قفل مبلغ (K14)
  LOCKED --> PAYMENT_PENDING: شروع پرداخت (یک تلاش فعال)
  PAYMENT_PENDING --> PAID: کارتخوان تأیید کرد
  PAYMENT_PENDING --> FAILED: رد / لغو روی کارتخوان
  PAYMENT_PENDING --> UNKNOWN: قطع ارتباط / پایان مهلت
  FAILED --> PAYMENT_PENDING: تلاش مجدد (همان سفارش)
  UNKNOWN --> PAID: استعلام یا تطبیق دستی مستند
  UNKNOWN --> FAILED: استعلام یا تطبیق دستی مستند
  LOCKED --> CANCELLED: ویرایش / انصراف / پایان نشست
  FAILED --> CANCELLED: انصراف مشتری
  PAID --> [*]
```

- تا وقتی وضعیت `UNKNOWN` است، تلاش جدید ممنوع است و این وضعیت هرگز موفق یا ناموفق نمایش داده نمی‌شود. فروش قطعی هم فقط شامل `PAID` است.
- `PAID` هرگز بازنویسی نمی‌شود. گزارش متناقض بعدی فقط `conflictFlag` را فعال می‌کند تا در پنل بررسی شود.
- چاپ نشدن رسید سفارش را لغو نمی‌کند. وضعیت چاپ (`printStatus`) جدا نگه داشته می‌شود و چاپ مجدد از کیوسک یا پنل ممکن است.

### اشتراک و QR

```mermaid
stateDiagram-v2
  [*] --> Pending: سفارش اشتراک
  Pending --> Active: فقط پس از PAID — صدور QR
  Active --> NotStarted: تمدید از پایان اشتراک فعلی (EXTEND_FROM_END)
  NotStarted --> Active: رسیدن تاریخ شروع
  Active --> Expired: گذشت expiresAt
  Active --> Revoked: ابطال در پنل (با دلیل)
  Active --> Active: صدور مجدد QR (توکن قبلی باطل)
```

- توکن QR (`AKQ1.` و ۳۲ نویسه تصادفی) روی کیوسک ساخته می‌شود. سرور فقط sha256 آن را نگه می‌دارد. در QR نه شماره موبایل هست و نه اطلاعات کارت.
- نتیجه بررسی یکی از `ACTIVE`، `EXPIRED`، `NOT_STARTED`، `REVOKED` یا `INVALID` است. نمایش عضو فقط به ۴ رقم آخر موبایل محدود است.
- بررسی آفلاین از کش محلی کیوسک انجام می‌شود (سیاست `offlineQrValidation`). کش با دلتای `rev` به‌روز می‌شود.

### همگام‌سازی کیوسک

```mermaid
sequenceDiagram
  participant K as کیوسک (outbox)
  participant S as سرور
  loop هر pushSec
    K->>S: POST /sync/push {events[eventId]}
    S-->>K: accepted / duplicate / rejected(retryable?)
  end
  loop هر pullSec
    K->>S: GET /sync/pull?since=rev&subSince=rev
    S-->>K: catalog (فقط اگر revision تغییر کرده) + دلتای اشتراک‌ها
  end
  loop هر heartbeatSec
    K->>S: POST /devices/heartbeat {hardware, outbox}
    S-->>K: فرمان‌ها (PAYMENT_INQUIRY · PRINT_RECEIPT · SYNC_NOW)
    K->>S: نتیجه فرمان
  end
```

- **انواع رویداد**: `ORDER_OFFLINE`، `PAYMENT_RESULT`، `ACCESS_LOG`، `RECEIPT_PRINT` و `COMMAND_RESULT`.
- **یکتایی**: هر رویداد با `eventId` یکتا ثبت می‌شود و سفارش آفلاین با `(deviceId, localId)`. ارسال دوباره هرگز سفارش تکراری نمی‌سازد (تست T11).
- **خطاهای قابل تکرار** (مثلاً سفارشی که هنوز همگام نشده) با تأخیر دوباره ارسال می‌شوند. خطاهای غیرقابل تکرار در پنل «همگام‌سازی» برای بررسی و اعمال مجدد نمایش داده می‌شوند.

## امنیت (خلاصه)

- **کیوسک**:
  - IPC محدود به فهرست مجاز، و مسدود بودن ناوبری و پنجره جدید
  - CSP در بیلد تولید (هر سه نسخه)
  - کلید دستگاه در ویندوز فقط در main process. در وب و اندروید فقط در حافظه همان دستگاه، بدون پشتیبان ابری در اندروید. ورود دوباره به تنظیمات به کلید دستگاه نیاز دارد
  - پاک شدن QR خام و ماسک شدن موبایل در پایان نشست
- **سرور**:
  - هش رمز با bcrypt و قفل موقت حساب
  - اعتبارسنجی همه ورودی‌ها با zod
  - هدرهای امنیتی و CORS محدود
  - رسانه با آدرس محتوایی (sha256) و نوع فایل بررسی‌شده
- **پنل**: توکن در `sessionStorage` که با بستن مرورگر حذف می‌شود. تغییر رمز همه نشست‌های قبلی را باطل می‌کند.
