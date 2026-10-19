import { useEffect, useRef, useState } from 'react';
import { AccessResult, OrderKind, formatJalaliLong, toPersianDigits } from '@andishkadeh/shared';
import { invoke, onEvent } from '../bridge';
import { Icon } from '../components/Icon';
import { Notice, Screen, Spinner } from '../components/ui';
import { sessionGuard, useApp, useSession } from '../store';

/**
 * K19 — scan the membership QR. USB HID scanners type the code + Enter (keyboard wedge);
 * serial / simulated scanners arrive as 'scanner:scan' events from the core.
 */
export function Scan() {
  const { set, replace } = useSession();
  const status = useApp((s) => s.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buffer = useRef('');
  const lastKey = useRef(0);
  const busyRef = useRef(false);

  const submit = async (payload: string) => {
    if (busyRef.current || !payload.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const session = sessionGuard();
    const r = await invoke('access:validate', { token: payload });
    busyRef.current = false;
    if (!session.alive()) return; // the member walked away; never show their result to the next person
    setBusy(false);
    if (r.ok) {
      set({ access: r.result });
      replace('accessResult');
    } else {
      setError(r.message);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const now = Date.now();
      // Scanners type very fast; a long pause means a new code (or a human), so restart.
      if (now - lastKey.current > 300) buffer.current = '';
      lastKey.current = now;
      if (e.key === 'Enter') {
        const code = buffer.current;
        buffer.current = '';
        if (code.length >= 5) void submit(code);
        return;
      }
      if (e.key.length === 1) buffer.current += e.key;
    };
    window.addEventListener('keydown', onKey);
    const off = onEvent('scanner:scan', ({ payload }) => void submit(payload));
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
    // Registered once: `submit` only touches refs, state setters and store actions, which never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scannerDown = status?.hardware.scanner.state === 'ERROR';
  return (
    <Screen title="ورود اعضا با QR" subtitle="بررسی اعتبار اشتراک" theme="cyan">
      <div className="result" style={{ paddingTop: 16 }}>
        <div className="scan-frame" aria-hidden>
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
          <Icon name="qr" className="qr-icon" />
          {!busy && <span className="line" />}
        </div>
        {busy ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }} data-testid="validating">
            <Spinner />
            <h2 style={{ fontSize: 40 }}>در حال بررسی اعتبار…</h2>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: 44 }}>کد QR کارت عضویت را مقابل اسکنر بگیرید</h2>
            <p>کد را چند سانتی‌متر جلوی اسکنر نگه دارید تا خوانده شود.</p>
          </>
        )}
        {scannerDown && <Notice tone="red">اسکنر در دسترس نیست. لطفاً برای بررسی اعتبار به پذیرش مراجعه کنید.</Notice>}
        {error && <Notice tone="amber" icon="wifiOff">{error}</Notice>}
      </div>
    </Screen>
  );
}

/** K20 — validation result. Shows validity only; no personal data beyond the last 4 digits. */
export function AccessResultScreen() {
  const { access, replace, reset, go } = useSession();
  const tz = useApp((s) => s.bootstrap?.settings.timezone);
  const status = useApp((s) => s.status);

  useEffect(() => {
    if (access?.result !== AccessResult.ACTIVE) return;
    const t = setTimeout(reset, 12000);
    return () => clearTimeout(t);
  }, [access, reset]);

  if (!access) return null;
  const date = (d: string | null) => (d ? formatJalaliLong(d, tz) : '');

  const views: Record<AccessResult, { tone: string; icon: 'check' | 'clock' | 'x' | 'alert'; title: string; text: string }> = {
    ACTIVE: { tone: 'c-green', icon: 'check', title: 'اشتراک شما فعال است', text: `اعتبار تا ${date(access.expiresAt)}` },
    EXPIRED: { tone: 'c-amber', icon: 'clock', title: 'اشتراک منقضی شده است', text: `اعتبار این اشتراک در ${date(access.expiresAt)} به پایان رسیده است.` },
    NOT_STARTED: { tone: 'c-blue', icon: 'clock', title: 'اشتراک هنوز شروع نشده است', text: `اعتبار این اشتراک از ${date(access.startsAt)} آغاز می‌شود.` },
    REVOKED: { tone: 'c-red', icon: 'x', title: 'این کارت عضویت معتبر نیست', text: 'برای پیگیری به پذیرش مراجعه کنید.' },
    INVALID: { tone: 'c-red', icon: 'alert', title: 'کد QR نامعتبر است', text: 'این کد به عنوان کارت عضویت شناخته نشد. دوباره اسکن کنید.' },
  };
  const v = views[access.result];

  return (
    <Screen
      title="نتیجه بررسی اعتبار"
      onBack={null}
      theme="cyan"
      calm
      center
      footer={
        <div className="footer-row">
          {access.result === AccessResult.INVALID && (
            <button className="btn btn-ghost" onClick={() => replace('scan')} data-testid="rescan">
              <Icon name="refresh" />
              اسکن مجدد
            </button>
          )}
          {access.result === AccessResult.EXPIRED && status?.subscriptionSalesAvailable && (
            <button
              className="btn btn-accent"
              onClick={() => {
                go('plans', undefined, { flow: OrderKind.SUBSCRIPTION, access: null });
              }}
              data-testid="buy-new"
            >
              <Icon name="crown" />
              خرید اشتراک جدید
            </button>
          )}
          <button className="btn btn-primary" onClick={reset} data-testid="access-done">
            پایان
          </button>
        </div>
      }
    >
      <div className="result" data-testid={`access-${access.result}`}>
        <span className={`result-icon ${v.tone}`}>
          <Icon name={v.icon} />
        </span>
        <h2>{v.title}</h2>
        <p>{v.text}</p>
        {access.result === AccessResult.ACTIVE && (
          <div className="panel" style={{ width: '100%' }}>
            {access.planTitle && (
              <div className="kv">
                <span className="k">پلن</span>
                <span className="v">{access.planTitle}</span>
              </div>
            )}
            {access.memberTail && (
              <div className="kv">
                <span className="k">عضو</span>
                <span className="v ltr">{toPersianDigits(`••• ${access.memberTail}`)}</span>
              </div>
            )}
          </div>
        )}
        {access.offline && <Notice tone="amber" icon="wifiOff">بررسی بر اساس آخرین اطلاعات ذخیره‌شده روی کیوسک انجام شد (بدون اتصال به مرکز).</Notice>}
      </div>
    </Screen>
  );
}
