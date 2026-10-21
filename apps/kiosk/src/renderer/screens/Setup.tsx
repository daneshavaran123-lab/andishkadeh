/**
 * Technician setup of the web app / Android app, and of the Windows app on first run. The easy way:
 * the one-time activation code from the panel (8 digits on the on-screen pad, or its link pasted or
 * read from the QR code with the kiosk's scanner); the server address is filled in already. The
 * kiosk id and device key can still be entered by hand. Not shown to customers.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { normalizeDigits, parseActivationInput } from '@andishkadeh/shared';
import { activateDevice, verifySetup, type ActivationResult, type SetupCheck, type SetupValues } from '../../core/setup-check';
import { NumPad } from '../components/ui';

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
  /** Where the activation code is exchanged; Windows from the main process (default: from this page). */
  activate?(serverUrl: string, code: string): Promise<ActivationResult>;
}

/** Digits typed so far, or '' when the field holds something else (a link). */
const typedDigits = (v: string) => (/^[\d۰-۹٠-٩\s-]*$/.test(v) ? normalizeDigits(v).replace(/\D/g, '') : '');

export function Setup({
  initial,
  running,
  onSave,
  onCancel,
  onReset,
  identityLocked,
  printerOptions = WEB_PRINTERS,
  printerNames,
  verify = verifySetup,
  activate = activateDevice,
}: Props) {
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
  // A kiosk being set up starts with the activation code; settings of a running one keep its id and key.
  const [mode, setMode] = useState<'code' | 'manual'>(running ? 'manual' : 'code');
  const [code, setCode] = useState('');
  const [connected, setConnected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; canForce: boolean } | null>(null);
  const set = <K extends keyof SetupValues>(k: K, v: SetupValues[K]) => setF((x) => ({ ...x, [k]: v }));

  // Windows: the one real receipt printer is picked already (not "Print to PDF", XPS, OneNote, fax)
  useEffect(() => {
    if (f.printer !== 'windows' || f.printerName || !printerNames) return;
    const real = printerNames.filter((n) => !/pdf|xps|onenote|fax/i.test(n));
    if (real.length === 1) set('printerName', real[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the installed printers arrive
  }, [printerNames]);

  const blocked = running && (running.pending > 0 || running.unresolved > 0);
  const lockReason =
    identityLocked ??
    (blocked ? `تا ${running.pending} رویداد ارسال‌نشده و ${running.unresolved} پرداخت نامشخص تعیین تکلیف نشوند، شناسه کیوسک تغییر نمی‌کند.` : undefined);

  const onCode = (value: string) => {
    setCode(value);
    // a link (pasted, or read from the QR code) brings its server along
    const linked = parseActivationInput(value)?.serverUrl;
    if (linked) set('serverUrl', linked);
  };

  /** The server address as entered, or an error shown on the screen. */
  const serverOrError = (raw: string): string | null => {
    try {
      const url = new URL(raw.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch {
      setError({ message: 'آدرس سرور معتبر نیست (مثال: https://andishkadeh.liara.run)', canForce: false });
      return null;
    }
  };

  const save = async (next: SetupValues, force: boolean) => {
    if (!force) {
      const check = await verify(next);
      if (!check.ok) {
        setError({ message: check.message, canForce: check.reason === 'network' });
        return;
      }
    }
    await onSave(next);
  };

  const submit = async (e: FormEvent, force = false) => {
    e.preventDefault();
    setError(null);
    if (printerNames?.length && f.printer === 'windows' && !f.printerName) {
      setError({ message: 'چاپگر رسید را انتخاب کنید', canForce: false });
      return;
    }
    // after a used code, a retry only checks again (the code worked once)
    if (mode === 'code' && !connected) {
      const parsed = parseActivationInput(code);
      if (!parsed) {
        setError({ message: 'کد ۸ رقمی فعال‌سازی را وارد کنید (یا لینک آن را)', canForce: false });
        return;
      }
      const serverUrl = serverOrError(parsed.serverUrl ?? f.serverUrl);
      if (!serverUrl) return;
      setBusy(true);
      try {
        const got = await activate(serverUrl, parsed.code);
        if (!got.ok) {
          setError({ message: got.message, canForce: false });
          return;
        }
        const next = { ...f, serverUrl, deviceId: got.deviceId, deviceKey: got.deviceKey };
        setF(next);
        setConnected(got.deviceName);
        await save(next, force);
      } finally {
        setBusy(false);
      }
      return;
    }
    const serverUrl = serverOrError(f.serverUrl);
    if (!serverUrl) return;
    if (f.deviceKey.length < 8) {
      setError({ message: 'کلید دستگاه دست‌کم ۸ نویسه است', canForce: false });
      return;
    }
    const next = { ...f, serverUrl, deviceId: f.deviceId.trim() };
    if (lockReason && next.deviceId !== (initial.deviceId ?? '').trim()) {
      setError({ message: lockReason, canForce: false });
      return;
    }
    setBusy(true);
    try {
      await save(next, force);
    } finally {
      setBusy(false);
    }
  };

  const digits = typedDigits(code);
  return (
    <div className="setup" data-testid="setup">
      <form className="setup-card" onSubmit={(e) => void submit(e)}>
        <h1>{running ? 'تنظیمات دستگاه' : 'راه‌اندازی کیوسک'}</h1>
        {mode === 'code' ? (
          <>
            <p className="setup-hint">
              در پنل مدیریت، صفحه «کیوسک‌ها»، «ثبت کیوسک جدید» یا «کد فعال‌سازی» را بزنید و کد ۸ رقمی را اینجا وارد کنید. QR همان پنجره را هم می‌توانید
              با اسکنر کیوسک بخوانید.
            </p>
            {connected ? (
              <div className="setup-ok" data-testid="setup-connected">
                کیوسک «{connected}» ({f.deviceId}) متصل شد.
              </div>
            ) : (
              <>
                <label>
                  کد فعال‌سازی
                  <input
                    className="setup-code"
                    dir="ltr"
                    inputMode="numeric"
                    autoFocus
                    autoComplete="off"
                    value={code}
                    onChange={(e) => onCode(e.target.value)}
                    placeholder="1234 5678"
                    data-testid="setup-code"
                  />
                </label>
                <div className="setup-numpad">
                  <NumPad
                    onDigit={(d) => digits.length < 8 && setCode(digits + d)}
                    onBackspace={() => setCode(digits.slice(0, -1))}
                    onClear={() => setCode('')}
                  />
                </div>
              </>
            )}
            <label>
              آدرس سرور
              <input
                dir="ltr"
                inputMode="url"
                autoComplete="off"
                required
                readOnly={!!connected}
                value={f.serverUrl}
                onChange={(e) => set('serverUrl', e.target.value)}
                placeholder="https://andishkadeh.liara.run"
                data-testid="setup-server"
              />
            </label>
          </>
        ) : (
          <>
            <p className="setup-hint">
              شناسه و کلید دستگاه را از پنل مدیریت (کیوسک‌ها ← ثبت کیوسک یا کلید جدید) بگیرید. کلید فقط روی همین دستگاه نگهداری می‌شود.
            </p>
            <label>
              آدرس سرور
              <input
                dir="ltr"
                inputMode="url"
                autoComplete="off"
                required
                value={f.serverUrl}
                onChange={(e) => set('serverUrl', e.target.value)}
                placeholder="http://192.168.1.10:3001"
                data-testid="setup-server"
              />
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
          </>
        )}
        <div className="setup-row">
          <label>
            کارتخوان
            <select value={f.payment} onChange={(e) => set('payment', e.target.value as SetupValues['payment'])} data-testid="setup-payment">
              <option value="mock">شبیه‌ساز (آزمایشی، بدون پرداخت واقعی)</option>
              <option value="none">متصل نشده (فروش متوقف)</option>
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
            {busy ? 'در حال بررسی…' : running ? 'ذخیره و راه‌اندازی مجدد' : mode === 'code' && !connected ? 'اتصال و شروع' : 'بررسی اتصال و شروع'}
          </button>
          {onCancel && (
            <button type="button" className="setup-secondary" onClick={onCancel}>
              انصراف
            </button>
          )}
        </div>
        {!running && !connected && (
          <button
            type="button"
            className="setup-link"
            onClick={() => {
              setError(null);
              setMode(mode === 'code' ? 'manual' : 'code');
            }}
            data-testid="setup-mode"
          >
            {mode === 'code' ? 'اتصال با شناسه و کلید دستگاه (روش دستی)' : 'اتصال با کد فعال‌سازی'}
          </button>
        )}
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
