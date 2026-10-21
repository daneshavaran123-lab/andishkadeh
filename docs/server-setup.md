# راه‌اندازی سرور مرکزی و پنل مدیریت

سرور یک فرایند Node.js است (NestJS). پایگاه داده PostgreSQL است و تصاویر در یک پوشه روی دیسک نگهداری می‌شوند. پنل مدیریت فایل استاتیک است و خود سرور می‌تواند آن را روی `/admin` ارائه کند. در این حالت پنل و API روی یک دامنه هستند و به CORS نیازی نیست.

> **لیارا یا هر میزبان Docker:** برای استقرار با `Dockerfile` مخزن (سرور و پنل در یک image) ر.ک. [استقرار روی لیارا](liara-deploy.md). این صفحه نصب مستقیم روی سرور ویندوز یا لینوکس است.

## ۱. پیش‌نیازها

| مورد | نسخه / توضیح |
| --- | --- |
| سیستم‌عامل | Windows Server 2019+ یا Ubuntu 22.04+ |
| Node.js | 22 LTS |
| pnpm | 10 (`corepack enable`) |
| PostgreSQL | 14 یا بالاتر، با encoding `UTF8` |
| گواهی TLS | برای دامنه API؛ کیوسک و پنل باید با HTTPS به سرور وصل شوند |

## ۲. پایگاه داده

```sql
CREATE ROLE andishkadeh LOGIN PASSWORD 'رمز-قوی';
CREATE DATABASE andishkadeh OWNER andishkadeh ENCODING 'UTF8';
```

**امنیت سطر (RLS):** migrationها RLS را روی همه جدول‌ها روشن می‌کنند.
- کاربر سرور (`andishkadeh`) مالک جدول‌هاست و محدود نمی‌شود. سرور، migrationها و پشتیبان‌گیری با همین کاربر مثل قبل کار می‌کنند.
- برای هیچ نقش دیگری policy تعریف نشده است. اگر کاربر دیگری در پایگاه داده ساخته شود (مثلاً برای گزارش‌گیری)، حتی با مجوز SELECT هیچ سطری نمی‌بیند تا برایش policy جداگانه تعریف شود.
- جدول‌ها باید با همان کاربر سرور ساخته شوند (همان `prisma migrate deploy` سرور)، نه با کاربر دیگر.
- جدولی که migration بعدی اضافه کند باید خودش `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` داشته باشد؛ تست `row-level-security` در غیر این صورت شکست می‌خورد.

## ۳. نصب و پیکربندی

```bash
git clone <repo> andishkadeh && cd andishkadeh
pnpm install --frozen-lockfile
cp apps/server/.env.example apps/server/.env
```

مقادیر `apps/server/.env`:

| متغیر | توضیح |
| --- | --- |
| `DATABASE_URL` | رشته اتصال PostgreSQL |
| `PORT` | پورت داخلی سرور (پیش‌فرض 3001؛ 3000 در ویندوز اغلب در اختیار EonVPN و سرویس‌های دیگر است) |
| `JWT_SECRET` | رشته تصادفی بلند (حداقل ۳۲ نویسه). تعویض آن همه مدیران را خارج می‌کند |
| `ADMIN_SESSION_HOURS` | طول نشست مدیر (ساعت) |
| `KIOSK_ADMIN_SESSION_MINUTES` | طول نشست مدیری که از چرخ‌دنده کیوسک وارد شده (دقیقه، پیش‌فرض ۳۰) |
| `LOGIN_MAX_ATTEMPTS`، `LOGIN_LOCK_MINUTES` | قفل موقت پس از ورود ناموفق |
| `MEDIA_DIR` | پوشه تصاویر؛ باید در پشتیبان‌گیری باشد |
| `PUBLIC_BASE_URL` | آدرس عمومی سرور که کیوسک تصاویر را از آن دانلود می‌کند (مثلاً `https://kiosk-api.example.ir`) |
| `TRUST_PROXY` | پشت IIS/nginx مقدار `1` بگذارید تا IP واقعی ثبت شود |
| `CORS_ORIGINS` | مبدأهای مجاز، با ویرگول. فقط اگر پنل روی دامنه دیگری میزبانی می‌شود. برای برنامه اندروید کیوسک `https://localhost` را اضافه کنید. اگر خالی باشد: در production هیچ مبدأ دیگری مجاز نیست؛ در توسعه پورت‌های 5173، 5174 و 5176 روی `localhost` و `127.0.0.1` مجازند |
| `ADMIN_DIST_DIR` | مسیر بیلد پنل (`apps/admin/dist`) برای ارائه روی `/admin` |
| `WEB_APP_DIST_DIR` | مسیر بیلد وب‌اپ مشتری (`apps/kiosk/dist-web`) برای ارائه روی نشانی اصلی `/` (ر.ک. [سه نسخه کیوسک](kiosk-platforms.md)). نام قبلی `KIOSK_WEB_DIST_DIR` هم پذیرفته می‌شود |
| `SEED_*` | فقط برای نصب اول: نام کاربری و رمز مدیر و اپراتور، شناسه و کلید دستگاه کیوسک |

تولید رشته‌های تصادفی:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## ۴. ساخت، migration و داده اولیه

```bash
pnpm --filter @andishkadeh/shared build
pnpm --filter @andishkadeh/server build
pnpm --filter @andishkadeh/admin build          # خروجی: apps/admin/dist
pnpm db:migrate                                  # prisma migrate deploy — غیرمخرب
pnpm db:seed                                     # فقط نصب اول؛ اجرای دوباره چیزی را بازنویسی نمی‌کند
```

داده اولیه این موارد را می‌سازد:

- ۴ حوزه (عملکرد، تغذیه، روان‌شناسی، مانیتورینگ) با زیرگروه‌ها، و یک تصویر برای هر زیرگروه که با عنوان آن جور است (فقط جایی که هنوز تصویری انتخاب نشده)
- خدمات دارای تعرفه معلوم، فعال؛ خدمات بدون تعرفه، غیرفعال و با قیمت خالی
- ۴ پلن اشتراک
- تنظیمات پیش‌فرض سیاست‌ها، تصاویر اولیه، کاربران مدیر و اپراتور، و دستگاه `KIOSK-01`

خدمات بدون تعرفه تا وقتی مدیر قیمت تأییدشده وارد نکند در کیوسک نمایش داده نمی‌شوند.

> پس از اولین ورود، رمز کاربران seed را از پنل («تغییر رمز» و «کاربران و نقش‌ها») عوض کنید و مقادیر `SEED_*_PASSWORD` را از `.env` پاک کنید.

## ۵. اجرا به‌عنوان سرویس

**ویندوز (NSSM):**

```powershell
nssm install AndishkadehApi "C:\Program Files\nodejs\node.exe" "dist\main.js"
nssm set AndishkadehApi AppDirectory C:\andishkadeh\apps\server
nssm set AndishkadehApi Start SERVICE_AUTO_START
nssm set AndishkadehApi AppStdout C:\andishkadeh\logs\api.log
nssm set AndishkadehApi AppStderr C:\andishkadeh\logs\api.err.log
nssm start AndishkadehApi
```

**لینوکس (systemd):** `/etc/systemd/system/andishkadeh-api.service`

```ini
[Unit]
Description=Andishkadeh kiosk API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/andishkadeh/apps/server
ExecStart=/usr/bin/node dist/main.js
Restart=always
User=andishkadeh
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## ۶. پراکسی معکوس و TLS

نمونه nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name kiosk-api.example.ir;
  ssl_certificate     /etc/ssl/kiosk-api.crt;
  ssl_certificate_key /etc/ssl/kiosk-api.key;
  client_max_body_size 10m;            # بارگذاری تصویر (MEDIA_MAX_MB)
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

در IIS از ماژول‌های URL Rewrite و ARR با همین الگو استفاده کنید.

## ۷. بررسی سلامت

| آدرس | انتظار |
| --- | --- |
| `GET /api/v1/health` | `{"status":"ok","db":"ok","version":"1.15.0",...}`؛ اگر پایگاه داده در دسترس نباشد، `degraded` برمی‌گردد |
| `/api/docs` | مستند تعاملی API (OpenAPI) |
| `/` | وب‌اپ عمومی مشتری با صفحه شروع، بدون فعال‌سازی (اگر `WEB_APP_DIST_DIR` تنظیم شده باشد) |
| `/admin/` | صفحه ورود پنل مدیریت (اگر `ADMIN_DIST_DIR` تنظیم شده باشد) |
| `/kiosk` | صفحه ورود مدیریت کیوسک‌ها (همان بیلد پنل) |

## ۸. ثبت کیوسک جدید

1. به `/kiosk` (یا پنل ← «کیوسک و تجهیزات») بروید، با حساب مدیر اصلی وارد شوید و «ثبت کیوسک جدید» را بزنید. فقط نام لازم است؛ شناسه خالی بماند تا `KIOSK-NN` آزاد بعدی انتخاب شود.
2. پنجره «اتصال کیوسک» یک **کد فعال‌سازی ۸ رقمی** (۳۰ دقیقه، یک‌بارمصرف)، لینک و QR آن را نشان می‌دهد:
   - کیوسک ویندوز یا اندروید: کد را در صفحه «راه‌اندازی کیوسک» برنامه وارد کنید یا QR را با اسکنر کیوسک بخوانید. آدرس سرور از پیش پر است (ر.ک. [نصب کیوسک](windows-kiosk-install.md)).
   - کیوسک مرورگری یا تبلت: QR را با دوربین بخوانید یا لینک را روی همان دستگاه باز کنید و «فعال‌سازی این دستگاه» را بزنید. اگر همین مرورگر کیوسک است، «فعال‌سازی همین مرورگر» را بزنید.
   - روش دستی: بخش «روش دستی» همان پنجره آدرس سرور، شناسه و کلید را نشان می‌دهد.
3. برای وصل کردن دوباره یا تعویض دستگاه، روی کارت همان کیوسک «کد فعال‌سازی» را بزنید. استفاده از کد کلید را عوض می‌کند و دستگاه قبلی قطع می‌شود. اگر کلید لو رفت، «کلید جدید» کلید قبلی را بلافاصله باطل می‌کند.

کیوسک با کد، شناسه و کلید تازه را از `POST /api/v1/kiosk/activate` می‌گیرد. سرور فقط هش sha256 کد را نگه می‌دارد. تلاش‌های نادرست برای هر نشانی IP محدود است (۲۰ بار در ۱۰ دقیقه). پشت reverse proxy، `TRUST_PROXY` را تنظیم کنید تا نشانی واقعی دیده شود.

دستگاه `WEB-APP` (وب‌اپ عمومی روی `/`) را migration خودش می‌سازد. کلید ندارد و فقط کاتالوگ را می‌خواند. شناسه `WEB-APP` را برای کیوسک دیگری به کار نبرید.

## ۹. به‌روزرسانی نسخه

نسخه‌ها با برچسب `v<نسخه>` منتشر می‌شوند (ر.ک. [انتشار نسخه](release.md)). روی سرور عملیاتی همان برچسب را بگیرید، نه آخرین commit:

```bash
git fetch --tags && git checkout v1.15.0
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate          # فقط migrationهای جدید را اعمال می‌کند
# راه‌اندازی مجدد سرویس
```

پیش از هر به‌روزرسانی از پایگاه داده پشتیبان بگیرید (ر.ک. [پشتیبان‌گیری](backup-restore.md)). پس از راه‌اندازی، `version` در `GET /api/v1/health` باید نسخه تازه باشد.
