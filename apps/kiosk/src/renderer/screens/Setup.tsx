/**
 * Technician setup of the web app / Android app, and of the Windows app on first run: server
 * address, kiosk id and device key (issued once in the admin panel, A15) plus the hardware
 * adapters. Not shown to customers.
 */
import { useState, type FormEvent } from 'react';
import { verifySetup, type SetupCheck, type SetupValues } from '../../core/setup-check';

const WEB_PRINTERS = [
  { value: 'browser', label: 'چاپگر دستگاه' },
  { value: 'mock', label: 'شبیه‌ساز' },
];

interface Props {
  initial: Partial<SetupValues>;
  /** Settings opened from a running kiosk (shows reset, needs a restart to apply). */
  running?: { pending: number; unresolved: number };
  onSave(setup: SetupValues): void | Promise<void>;
  onCancel?(): void;
  onReset?(): void | Promise<void>;
  /** Why the kiosk id may not change (local orders and events belong to the current id). */
  identityLocked?: string;
  /** Printer adapters of this platform (default: the web app's). */
  printerOptions?: Array<{ value: string; label: string }>;
  /** Windows: installed printers; one must be chosen when any is installed. */
  printerNames?: string[];
  /** Where the check runs; Windows checks from the main process (default: from this page). */
  verify?(s: Pick<SetupValues, 'serverUrl' | 'deviceId' | 'deviceKey'>): Promise<SetupCheck>;
}

export function Setup({ initial, running, onSave, onCancel, onReset, identityLocked, printerOptions = WEB_PRINTERS, printerNames, verify = verifySetup }: Props) {
  const [f, setF] = useState<SetupValues>({
    serverUrl: initial.serverUrl ?? '',
    deviceId: initial.deviceId ?? 'KIOSK-01',
    deviceKey: initial.deviceKey ?? '',
    payment: initial.payment ?? 'mock',
    printer: initial.printer ?? printerOptions[0].value,
    printerName: initial.printerName ?? '',
    scanner: initial.scanner ?? 'keyboard',
    devControls: initial.devControls ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; canForce: boolean } | null>(null);
  const set = <K extends keyof SetupValues>(k: K, v: SetupValues[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent, force = false) => {
    e.preventDefault();
    setError(null);
    let url: URL;
    try {
      url = new URL(f.serverUrl.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      setError({ message: 'آدرس سرور معتبر نیست (مثال: http://192.168.1.10:3001)', canForce: false });
      return;
    }
    if (f.deviceKey.length < 8) {
      setError({ message: 'کلید دستگاه دست‌کم ۸ نویسه است', canForce: false });
      return;
    }
    if (printerNames?.length && f.printer === 'windows' && !f.printerName) {
      setError({ message: 'چاپگر رسید را انتخاب کنید', canForce: false });
      return;
    }
    const next = { ...f, serverUrl: url.origin + url.pathname.replace(/\/+$/, ''), deviceId: f.deviceId.trim() };
    if (lockReason && next.deviceId !== (initial.deviceId ?? '').trim()) {
      setError({ message: lockReason, canForce: false });
      return;
    }
    setBusy(true);
    try {
      if (!force) {
        const check = await verify(next);
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
  const lockReason =
    identityLocked ??
    (blocked ? `تا ${running.pending} رویداد ارسال‌نشده و ${running.unresolved} پرداخت نامشخص تعیین تکلیف نشوند، شناسه کیوسک تغییر نمی‌کند.` : undefined);

  return (
    <div className="setup" data-testid="setup">
      <form className="setup-card" onSubmit={(e) => void submit(e)}>
        <h1>{running ? 'تنظیمات دستگاه' : 'راه‌اندازی کیوسک'}</h1>
        <p className="setup-hint">
          شناسه و کلید دستگاه را از پنل مدیریت (کیوسک‌ها ← ثبت کیوسک یا کلید جدید) بگیرید. کلید فقط روی همین دستگاه نگهداری می‌شود.
        </p>
        <label>
          آدرس سرور
          <input dir="ltr" inputMode="url" autoComplete="off" required value={f.serverUrl} onChange={(e) => set('serverUrl', e.target.value)} placeholder="http://192.168.1.10:3001" data-testid="setup-server" />
        </label>
        <label>
          شناسه کیوسک
          <input
            dir="ltr"
            autoComplete="off"
            required
            readOnly={!!lockReason}
            value={f.deviceId}
            onChange={(e) => set('deviceId', e.target.value)}
            data-testid="setup-device"
          />
          {lockReason && <small className="setup-hint">{lockReason}</small>}
        </label>
        <label>
          کلید دستگاه
          <input dir="ltr" type="password" autoComplete="off" required value={f.deviceKey} onChange={(e) => set('deviceKey', e.target.value)} data-testid="setup-key" />
        </label>
        <div className="setup-row">
          <label>
            کارتخوان
            <select value={f.payment} onChange={(e) => set('payment', e.target.value as SetupValues['payment'])} data-testid="setup-payment">
              <option value="mock">شبیه‌ساز (آزمایشی)</option>
              <option value="none">متصل نشده</option>
            </select>
          </label>
          <label>
            چاپگر
            <select value={f.printer} onChange={(e) => set('printer', e.target.value)} data-testid="setup-printer">
              {printerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            اسکنر QR
            <select value={f.scanner} onChange={(e) => set('scanner', e.target.value as SetupValues['scanner'])} data-testid="setup-scanner">
              <option value="keyboard">اسکنر USB</option>
              <option value="mock">شبیه‌ساز</option>
            </select>
          </label>
        </div>
        {printerNames && f.printer === 'windows' && (
          <label>
            چاپگر رسید
            <select value={f.printerName} onChange={(e) => set('printerName', e.target.value)} data-testid="setup-printer-name">
              <option value="">{printerNames.length ? '— انتخاب کنید —' : 'چاپگری در ویندوز نصب نیست'}</option>
              {printerNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
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

/**
 * Device key prompt before opening settings. Accepts the key stored on this device, or, after a
 * key rotation in the panel (A15), the new key once the server confirms it for this kiosk id.
 */
export function TechGate({ setup, onPass, onCancel }: { setup: Pick<SetupValues, 'serverUrl' | 'deviceId' | 'deviceKey'>; onPass(): void; onCancel(): void }) {
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    if (value === setup.deviceKey) return onPass();
    if (value.length < 8) return setWrong('کلید نادرست است');
    setBusy(true);
    try {
      const r = await verifySetup({ ...setup, deviceKey: value });
      if (r.ok) onPass();
      else setWrong(r.reason === 'auth' ? 'کلید نادرست است' : `کلید نادرست است، یا بررسی آن با سرور ممکن نشد (${r.message})`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="setup setup-overlay" data-testid="tech-gate">
      <form
        className="setup-card"
        onSubmit={(e) => {
          e.preventDefault();
          setWrong(null);
          void check();
        }}
      >
        <h1>تنظیمات دستگاه</h1>
        <p className="setup-hint">برای ادامه، کلید دستگاه را وارد کنید.</p>
        <input dir="ltr" type="password" autoFocus autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} data-testid="tech-key" />
        {wrong && <div className="setup-error">{wrong}</div>}
        <div className="setup-actions">
          <button type="submit" className="setup-primary" disabled={busy}>
            {busy ? 'در حال بررسی…' : 'ادامه'}
          </button>
          <button type="button" className="setup-secondary" onClick={onCancel}>
            انصراف
          </button>
        </div>
      </form>
    </div>
  );
}
