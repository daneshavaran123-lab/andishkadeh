// Started by docker-start.sh when the API could not start. Answers every request on $PORT with 503
// and the reason, instead of the platform's bare 502, then exits after 10 minutes so the platform
// starts the container again (the database may have come up meanwhile). The page only names
// settings and gives fixed hints; the full output is in the container log.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [step = 'start', logFile = ''] = process.argv.slice(2);
let log = '';
try {
  log = readFileSync(logFile, 'utf8');
} catch {
  // no log: generic reason
}

const STEPS = {
  config: 'بررسی تنظیمات (متغیرهای برنامه)',
  migrate: 'آماده‌سازی پایگاه داده (migration)',
  seed: 'داده اولیه',
};

function reason() {
  // Variable names and what is wrong with them; the config never prints their values.
  const env = /^(?:Error: )?(?:Invalid environment|Refusing to start in production): (.+)$/m.exec(log);
  if (env) return env[1].trim();
  if (/P1001|P1017/.test(log)) return 'پایگاه داده در دسترس نیست. DATABASE_URL باید آدرس «شبکه خصوصی» دیتابیس باشد و برنامه و دیتابیس در یک شبکه خصوصی باشند.';
  if (/P1000/.test(log)) return 'نام کاربری یا رمز عبور در DATABASE_URL نادرست است.';
  if (/P1003/.test(log)) return 'پایگاه داده‌ای با نامی که در DATABASE_URL آمده وجود ندارد.';
  if (/P1012|P1013/.test(log)) return 'DATABASE_URL قالب درستی ندارد؛ شکل درست: postgresql://user:password@host:5432/postgres';
  const seed = /(Missing env [A-Z_]+|SEED_[A-Z_]+: set a real value[^\n]*)/.exec(log);
  if (seed) return seed[1];
  return 'جزئیات خطا در لاگ برنامه است.';
}

const text = reason();
const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>سرور اجرا نشد</title><style>body{font-family:Vazirmatn,Tahoma,sans-serif;background:#f4f6fb;color:#1b2a41;margin:0;padding:24px}
main{max-width:640px;margin:8vh auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 12px}code,.r{direction:ltr;unicode-bidi:plaintext}.r{background:#fff4e5;border:1px solid #f0c27b;border-radius:10px;padding:12px;margin:16px 0;word-break:break-word}
p{line-height:1.9}</style></head><body><main><h1>سرور اندیشکده اجرا نشد</h1>
<p>مرحله: <b>${escape(STEPS[step] ?? step)}</b></p><div class="r">${escape(text)}</div>
<p>متغیرهای برنامه را در کنسول لیارا اصلاح کنید؛ برنامه پس از ذخیره دوباره اجرا می‌شود. جزئیات کامل در «لاگ‌ها»ی برنامه است.
راهنما: docs/liara-deploy.md ← عیب‌یابی.</p></main></body></html>`;

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'error', step, reason: text }));
    return;
  }
  res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '60' });
  res.end(html);
}).listen(Number(process.env.PORT) || 3001, '0.0.0.0', () => {
  console.error(`Startup failed (${step}): ${text}. Showing it on port ${Number(process.env.PORT) || 3001}.`);
});

setTimeout(() => process.exit(1), 10 * 60_000).unref();
process.on('SIGTERM', () => process.exit(0));
