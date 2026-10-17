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
| `PORT` | پورت داخلی سرور (پیش‌فرض 3000) |
| `JWT_SECRET` | رشته تصادفی بلند (حداقل ۳۲ نویسه). تعویض آن همه مدیران را خارج می‌کند |
| `ADMIN_SESSION_HOURS` | طول نشست مدیر (ساعت) |
| `LOGIN_MAX_ATTEMPTS`، `LOGIN_LOCK_MINUTES` | قفل موقت پس از ورود ناموفق |
| `MEDIA_DIR` | پوشه تصاویر؛ باید در پشتیبان‌گیری باشد |
| `PUBLIC_BASE_URL` | آدرس عمومی سرور که کیوسک تصاویر را از آن دانلود می‌کند (مثلاً `https://kiosk-api.example.ir`) |
| `TRUST_PROXY` | پشت IIS/nginx مقدار `1` بگذارید تا IP واقعی ثبت شود |
| `CORS_ORIGINS` | فقط اگر پنل روی دامنه دیگری میزبانی می‌شود. برای برنامه اندروید کیوسک `https://localhost` را اضافه کنید |
| `ADMIN_DIST_DIR` | مسیر بیلد پنل (`apps/admin/dist`) برای ارائه روی `/admin` |
| `KIOSK_WEB_DIST_DIR` | مسیر بیلد وب‌اپ کیوسک (`apps/kiosk/dist-web`) برای ارائه روی `/kiosk/` (ر.ک. [سه نسخه کیوسک](kiosk-platforms.md)) |
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

- ۴ حوزه (عملکرد، تغذیه، روان‌شناسی، مانیتورینگ) با زیرگروه‌ها
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
    proxy_pass http://127.0.0.1:3000;
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
| `GET /api/v1/health` | `{"status":"ok","db":"ok","version":"1.3.0",...}`؛ اگر پایگاه داده در دسترس نباشد، `degraded` برمی‌گردد |
| `/api/docs` | مستند تعاملی API (OpenAPI) |
| `/admin/` | صفحه ورود پنل مدیریت (اگر `ADMIN_DIST_DIR` تنظیم شده باشد) |
| `/kiosk/` | وب‌اپ کیوسک، صفحه راه‌اندازی در اجرای اول (اگر `KIOSK_WEB_DIST_DIR` تنظیم شده باشد) |

## ۸. ثبت کیوسک جدید

1. در پنل به «کیوسک و تجهیزات» بروید و «ثبت کیوسک جدید» را بزنید. شناسه را مثلاً `KIOSK-02` بگذارید.
2. کلید دستگاه فقط یک بار نمایش داده می‌شود. آن را در `kiosk.config.json` همان کیوسک قرار دهید (ر.ک. [نصب کیوسک](windows-kiosk-install.md)).
3. اگر کلید لو رفت یا دستگاه تعویض شد، از دکمه «کلید جدید» در ردیف همان دستگاه استفاده کنید. کلید قبلی بلافاصله باطل می‌شود.

## ۹. به‌روزرسانی نسخه

نسخه‌ها با برچسب `v<نسخه>` منتشر می‌شوند (ر.ک. [انتشار نسخه](release.md)). روی سرور عملیاتی همان برچسب را بگیرید، نه آخرین commit:

```bash
git fetch --tags && git checkout v1.3.0
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate          # فقط migrationهای جدید را اعمال می‌کند
# راه‌اندازی مجدد سرویس
```

پیش از هر به‌روزرسانی از پایگاه داده پشتیبان بگیرید (ر.ک. [پشتیبان‌گیری](backup-restore.md)). پس از راه‌اندازی، `version` در `GET /api/v1/health` باید نسخه تازه باشد.
