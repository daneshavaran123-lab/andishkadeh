/**
 * Kiosk management at /kiosk: the panel build served under its own path for the staff who set up
 * kiosks. Windows installer, the server address a kiosk connects to, device registration, keys,
 * activation and status. The API enforces the roles (operators see the status only).
 */
import { toPersianDigits } from '@andishkadeh/shared';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { Alert, Card } from '../components/ui';
import { CopyButton, Devices, InstallerButton, useInstallerInfo, useServerUrl } from './Devices';

export function KioskManagement() {
  const { user, isAdmin, logout } = useAuth();
  const serverUrl = useServerUrl();
  const installer = useInstallerInfo();

  return (
    <div className="main">
      <header className="topbar">
        <Icon name="monitor" style={{ width: 22, height: 22 }} />
        <span className="center">مدیریت کیوسک‌های اندیشکده کشتی ایران</span>
        <span className="spacer" />
        {user && (
          <div className="user-chip">
            <span className="avatar">{user.displayName.slice(0, 1)}</span>
            <b className="user-name">{user.displayName}</b>
            <a className="btn btn-sm btn-ghost" href="/admin/">
              پنل مدیریت
            </a>
            <button className="btn btn-sm" onClick={() => logout()} data-testid="logout">
              <Icon name="logout" />
              خروج
            </button>
          </div>
        )}
      </header>
      <main className="content" data-testid="kiosk-management">
        <div className="grid grid-2" style={{ marginBottom: 24 }}>
          <Card title="اتصال کیوسک به سرور" sub="کیوسک ویندوز و وب‌اپ به همین سرور و همین پایگاه داده وصل می‌شوند">
            <dl className="kv-list">
              <dt>آدرس سرور</dt>
              <dd>
                <code className="ltr" data-testid="server-url">
                  {serverUrl}
                </code>{' '}
                <CopyButton value={serverUrl} />
              </dd>
            </dl>
            <ol style={{ lineHeight: 2, margin: '12px 0 0', paddingInlineStart: 20 }}>
              <li>{isAdmin ? 'پایین همین صفحه «ثبت کیوسک جدید» (یا «کلید جدید» برای کیوسک موجود) را بزنید.' : 'ثبت کیوسک و کلید جدید با مدیر اصلی است.'}</li>
              <li>کیوسک ویندوز: در اجرای اول برنامه، آدرس سرور، شناسه و کلید دستگاه را وارد کنید.</li>
              <li>وب‌اپ: در پنجره کلید، «فعال‌سازی همین مرورگر» را بزنید؛ سپس نشانی اصلی سایت در همین مرورگر کیوسک را باز می‌کند.</li>
              <li>پس از اتصال، کیوسک در فهرست پایین «آنلاین» می‌شود.</li>
            </ol>
          </Card>
          <Card title="برنامه کیوسک ویندوز" sub={installer ? `نسخه ${toPersianDigits(installer.version)}، هم‌نسخه با این سرور` : undefined}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
              <InstallerButton info={installer} />
              {installer?.available === false && (
                <Alert tone="info">
                  نصب‌کننده این نسخه هنوز منتشر نشده است. پس از انتشار نسخه در GitHub (یا تعریف KIOSK_INSTALLER_URL روی سرور) دکمه دانلود همین‌جا فعال می‌شود.
                </Alert>
              )}
              {installer?.available === null && <span className="muted">در دسترس بودن فایل از روی سرور بررسی نشد؛ اگر دانلود نشد، نصب‌کننده هنوز منتشر نشده است.</span>}
              <span className="muted" style={{ lineHeight: 1.9 }}>
                ویندوز ۱۰/۱۱، ۶۴ بیتی. پس از نصب، صفحه «راه‌اندازی کیوسک» آدرس سرور، شناسه و کلید را می‌خواهد.
              </span>
            </div>
          </Card>
        </div>
        <Devices embedded />
      </main>
    </div>
  );
}
