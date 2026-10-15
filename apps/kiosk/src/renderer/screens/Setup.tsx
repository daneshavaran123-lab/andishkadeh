/**
 * Technician setup of the web app / Android app: server address, kiosk id and device key
 * (issued once in the admin panel, A15) plus the hardware adapters. Not shown to customers.
 */
import { useState, type FormEvent } from 'react';
import { verifySetup, type WebSetup } from '../../platform/web/config';

interface Props {
  initial: Partial<WebSetup>;
  /** Settings opened from a running kiosk (shows reset, needs a restart to apply). */
  running?: { pending: number; unresolved: number };
  onSave(setup: WebSetup): void | Promise<void>;
  onCancel?(): void;
  onReset?(): void | Promise<void>;
}

export function Setup({ initial, running, onSave, onCancel, onReset }: Props) {
  const [f, setF] = useState<WebSetup>({
    serverUrl: initial.serverUrl ?? '',
    deviceId: initial.deviceId ?? 'KIOSK-01',
    deviceKey: initial.deviceKey ?? '',
    payment: initial.payment ?? 'mock',
    printer: initial.printer ?? 'browser',
    scanner: initial.scanner ?? 'keyboard',
    devControls: initial.devControls ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; canForce: boolean } | null>(null);
  const set = <K extends keyof WebSetup>(k: K, v: WebSetup[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent, force = false) => {
    e.preventDefault();
    setError(null);
    let url: URL;
    try {
      url = new URL(f.serverUrl.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      setError({ message: 'آدرس سرور معتبر نیست (مثال: http://192.168.1.10:3000)', canForce: false });
      return;
    }
    if (f.deviceKey.length < 8) {
      setError({ message: 'کلید دستگاه دست‌کم ۸ نویسه است', canForce: false });
      return;
    }
    const next = { ...f, serverUrl: url.origin + url.pathname.replace(/\/+$/, ''), deviceId: f.deviceId.trim() };
    setBusy(true);
    try {
      if (!force) {
        const check = await verifySetup(next);
        if (!check.ok) {
          setError({ message: check.message, canForce: check.reason === 'network' });
          return;
        }
      }
      await onSave(next);
    } finally {
      setBusy(false);
    }
  };

  const blocked = running && (running.pending > 0 || running.unresolved > 0);

  return (
    <div className="setup" data-testid="setup">
      <form className="setup-card" onSubmit={(e) => void submit(e)}>
        <h1>{running ? 'تنظیمات دستگاه' : 'راه‌اندازی کیوسک'}</h1>
        <p className="setup-hint">
          شناسه و کلید دستگاه را از پنل مدیریت (کیوسک‌ها ← ثبت کیوسک یا کلید جدید) بگیرید. کلید فقط روی همین دستگاه نگهداری می‌شود.
        </p>
        <label>
          آدرس سرور
          <input dir="ltr" inputMode="url" autoComplete="off" required value={f.serverUrl} onChange={(e) => set('serverUrl', e.target.value)} placeholder="http://192.168.1.10:3000" data-testid="setup-server" />
        </label>
        <label>
          شناسه کیوسک
          <input dir="ltr" autoComplete="off" required value={f.deviceId} onChange={(e) => set('deviceId', e.target.value)} data-testid="setup-device" />
        </label>
        <label>
          کلید دستگاه
          <input dir="ltr" type="password" autoComplete="off" required value={f.deviceKey} onChange={(e) => set('deviceKey', e.target.value)} data-testid="setup-key" />
        </label>
        <div className="setup-row">
          <label>
            کارتخوان
            <select value={f.payment} onChange={(e) => set('payment', e.target.value as WebSetup['payment'])} data-testid="setup-payment">
              <option value="mock">شبیه‌ساز (فقط آزمایشی)</option>
              <option value="none">متصل نشده (فروش متوقف)</option>
            </select>
          </label>
          <label>
            چاپگر
            <select value={f.printer} onChange={(e) => set('printer', e.target.value as WebSetup['printer'])} data-testid="setup-printer">
              <option value="browser">چاپگر دستگاه</option>
              <option value="mock">شبیه‌ساز (بدون چاپ)</option>
            </select>
          </label>
          <label>
            اسکنر QR
            <select value={f.scanner} onChange={(e) => set('scanner', e.target.value as WebSetup['scanner'])} data-testid="setup-scanner">
              <option value="keyboard">اسکنر USB (حالت صفحه‌کلید)</option>
              <option value="mock">شبیه‌ساز</option>
            </select>
          </label>
        </div>
        <label className="setup-check">
          <input type="checkbox" checked={f.devControls} onChange={(e) => set('devControls', e.target.checked)} />
          کنترل‌های آزمایشی (فقط برای آزمون؛ در بهره‌برداری خاموش باشد)
        </label>
        {error && (
          <div className="setup-error" role="alert" data-testid="setup-error">
            {error.message}
            {error.canForce && (
              <button type="button" className="setup-link" onClick={(e) => void submit(e, true)}>
                ذخیره بدون بررسی
              </button>
            )}
          </div>
        )}
        <div className="setup-actions">
          <button type="submit" className="setup-primary" disabled={busy} data-testid="setup-save">
            {busy ? 'در حال بررسی…' : running ? 'ذخیره و راه‌اندازی مجدد' : 'بررسی اتصال و شروع'}
          </button>
          {onCancel && (
            <button type="button" className="setup-secondary" onClick={onCancel}>
              انصراف
            </button>
          )}
        </div>
        {running && onReset && (
          <div className="setup-danger">
            <button type="button" className="setup-link" disabled={blocked} onClick={() => void onReset()}>
              پاک کردن داده‌های این دستگاه
            </button>
            <span>
              {blocked
                ? `ابتدا باید ${running.pending} رویداد ارسال‌نشده و ${running.unresolved} پرداخت نامشخص تعیین تکلیف شوند.`
                : 'سفارش‌ها، کاتالوگ و تصاویر ذخیره‌شده روی این دستگاه پاک می‌شوند.'}
            </span>
          </div>
        )}
      </form>
    </div>
  );
}

/** Device key prompt before opening settings on a running kiosk. */
export function TechGate({ deviceKey, onPass, onCancel }: { deviceKey: string; onPass(): void; onCancel(): void }) {
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState(false);
  return (
    <div className="setup setup-overlay" data-testid="tech-gate">
      <form
        className="setup-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (value === deviceKey) onPass();
          else setWrong(true);
        }}
      >
        <h1>تنظیمات دستگاه</h1>
        <p className="setup-hint">برای ادامه، کلید دستگاه را وارد کنید.</p>
        <input dir="ltr" type="password" autoFocus autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
        {wrong && <div className="setup-error">کلید نادرست است</div>}
        <div className="setup-actions">
          <button type="submit" className="setup-primary">
            ادامه
          </button>
          <button type="button" className="setup-secondary" onClick={onCancel}>
            انصراف
          </button>
        </div>
      </form>
    </div>
  );
}
