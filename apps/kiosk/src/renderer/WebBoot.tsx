/**
 * Start-up of the web app (PWA) and the Android app. The web app served by the server opens at
 * once as the public web app (start screen, services, prices, plans; browsing only); a browser
 * activated as a kiosk (activation link from /kiosk, `/?activate=<code>`), the Android app and a
 * development build run as a kiosk device (setup on first run). The kiosk core is started in this
 * page and handed to the regular kiosk UI.
 * On a kiosk device a technician re-opens the settings with 7 quick taps in the top-left corner
 * followed by the device key.
 */
import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState } from 'react';
import { ACTIVATION_PARAM, normalizeActivationCode } from '@andishkadeh/shared';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { clearWebSetup, publicKioskConfig, readWebSetup, toKioskConfig, writeWebSetup, type WebSetup } from '../platform/web/config';
import type { WebHost } from '../platform/web';
import { App } from './App';
import fontUrl from './assets/fonts/Vazirmatn-wght.woff2?url';
import { activateDevice } from '../core/setup-check';
import { attachApi } from './bridge';
import { Setup, TechGate } from './screens/Setup';
import { setMediaResolver } from './store';

const PLATFORM: 'web' | 'android' = Capacitor.isNativePlatform() ? 'android' : 'web';

/** The web app served by the server itself (https://server/): opens for anyone without setup. */
const PUBLIC_WEB_APP = PLATFORM === 'web' && !import.meta.env.DEV && /^https?:$/.test(location.protocol);

/** Activation link opened in this browser (the web app at the server's own address only). */
const ACTIVATION_CODE = PLATFORM === 'web' && /^https?:$/.test(location.protocol) ? normalizeActivationCode(new URLSearchParams(location.search).get(ACTIVATION_PARAM) ?? '') : null;

type Phase =
  | { kind: 'activate'; code: string }
  | { kind: 'setup' }
  | { kind: 'starting' }
  /** setup null: the public web app. */
  | { kind: 'running'; host: WebHost; setup: WebSetup | null }
  | { kind: 'error'; message: string };

/** Default server for the setup screen: the server the page comes from, or the one the build suggests (Android). */
function defaultServerUrl(): string {
  return PLATFORM === 'web' && /^https?:$/.test(location.protocol) ? location.origin : __KIOSK_DEFAULT_SERVER__;
}

/** The activation link stays out of the address bar (and of a later reload). */
function dropActivationParam() {
  const url = new URL(location.href);
  url.searchParams.delete(ACTIVATION_PARAM);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** Activation link opened on this device: one tap makes this browser that kiosk. */
function ActivateHere({ code, onDone, onCancel }: { code: string; onDone(): void; onCancel(): void }) {
  const current = readWebSetup();
  const [payment, setPayment] = useState<'mock' | 'none'>('mock');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const got = await activateDevice(location.origin, code);
      if (!got.ok) return setError(got.message);
      writeWebSetup({ serverUrl: location.origin, deviceId: got.deviceId, deviceKey: got.deviceKey, payment, printer: 'browser', scanner: 'keyboard', devControls: false });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="setup" data-testid="activate-here">
      <div className="setup-card">
        <h1>فعال‌سازی کیوسک</h1>
        <p className="setup-hint">
          این مرورگر به کیوسک فروش تبدیل می‌شود و از این پس نشانی اصلی سایت در آن، کیوسک کامل با خرید و پرداخت را باز می‌کند. این کار را روی همان دستگاهی
          انجام دهید که کیوسک است.
        </p>
        {current && (
          <div className="setup-error">
            این مرورگر هم‌اکنون کیوسک {current.deviceId} است. فروش‌ها و رویدادهای ارسال‌نشده آن باید پیش از جایگزینی ارسال شده باشند (صف همگام‌سازی آن در صفحه
            کیوسک‌ها صفر باشد).
          </div>
        )}
        <label>
          کارتخوان
          <select value={payment} onChange={(e) => setPayment(e.target.value as 'mock' | 'none')} data-testid="activate-payment">
            <option value="mock">شبیه‌ساز (نمایش و آموزش، با نوار «حالت آزمایشی»)</option>
            <option value="none">متصل نشده (فروش متوقف)</option>
          </select>
        </label>
        {error && (
          <div className="setup-error" role="alert" data-testid="activate-error">
            {error}
          </div>
        )}
        <div className="setup-actions">
          <button type="button" className="setup-primary" disabled={busy} onClick={() => void go()} data-testid="activate-confirm">
            {busy ? 'در حال فعال‌سازی…' : 'فعال‌سازی این دستگاه'}
          </button>
          <button type="button" className="setup-secondary" onClick={onCancel}>
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

function useCornerTaps(enabled: boolean, onTrigger: () => void) {
  const taps = useRef<number[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      if (e.clientX > 90 || e.clientY > 90) return;
      const now = Date.now();
      taps.current = [...taps.current.filter((t) => now - t < 4000), now];
      if (taps.current.length >= 7) {
        taps.current = [];
        onTrigger();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [enabled, onTrigger]);
}

export function WebBoot() {
  const [phase, setPhase] = useState<Phase>(() =>
    ACTIVATION_CODE ? { kind: 'activate', code: ACTIVATION_CODE } : readWebSetup() || PUBLIC_WEB_APP ? { kind: 'starting' } : { kind: 'setup' },
  );
  const [settings, setSettings] = useState<'closed' | 'gate' | 'open'>('closed');
  const started = useRef(false);

  const start = async () => {
    const setup = readWebSetup();
    if (!setup && !PUBLIC_WEB_APP) return setPhase({ kind: 'setup' });
    if (started.current) return;
    started.current = true;
    setPhase({ kind: 'starting' });
    try {
      const { startWebHost } = await import('../platform/web');
      const cfg = setup ? toKioskConfig(setup, __KIOSK_VERSION__) : publicKioskConfig(location.origin, __KIOSK_VERSION__);
      const host = await startWebHost(cfg, { wasmUrl, fontUrl, platform: PLATFORM, publicWebApp: !setup });
      attachApi(host);
      setMediaResolver(host.mediaUrl);
      setPhase({ kind: 'running', host, setup });
    } catch (e) {
      started.current = false;
      const message =
        (e as Error).name === 'KioskAlreadyOpenError' || /another tab/.test((e as Error).message)
          ? 'کیوسک در زبانه یا پنجره دیگری از همین مرورگر باز است. آن را ببندید و دوباره تلاش کنید.'
          : `${setup ? 'راه‌اندازی کیوسک' : 'باز کردن برنامه'} ممکن نشد: ${(e as Error).message}`;
      setPhase({ kind: 'error', message });
    }
  };

  useEffect(() => {
    if (phase.kind === 'starting') void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (PLATFORM === 'android') document.body.classList.add('touch-only');
  }, []);

  useCornerTaps(phase.kind === 'running' && !!phase.setup && settings === 'closed', () => setSettings('gate'));

  if (phase.kind === 'activate') {
    const leave = () => {
      dropActivationParam();
      void start();
    };
    return <ActivateHere code={phase.code} onDone={leave} onCancel={leave} />;
  }
  if (phase.kind === 'setup') {
    return (
      <Setup
        initial={{ serverUrl: defaultServerUrl() }}
        onSave={(s) => {
          writeWebSetup(s);
          void start();
        }}
      />
    );
  }
  if (phase.kind === 'error') {
    const stored = readWebSetup();
    return (
      <>
        <div className="setup" data-testid="boot-error">
          <div className="setup-card">
            <h1>{stored || !PUBLIC_WEB_APP ? 'کیوسک آماده نیست' : 'برنامه آماده نیست'}</h1>
            <p className="setup-hint">{phase.message}</p>
            <div className="setup-actions">
              <button type="button" className="setup-primary" onClick={() => void start()}>
                تلاش دوباره
              </button>
              {stored && (
                <button type="button" className="setup-secondary" onClick={() => setSettings('gate')} data-testid="boot-settings">
                  تنظیمات دستگاه
                </button>
              )}
            </div>
          </div>
        </div>
        {stored && settings === 'gate' && <TechGate setup={stored} onPass={() => setSettings('open')} onCancel={() => setSettings('closed')} />}
        {stored && settings === 'open' && (
          <div className="setup-overlay">
            <Setup
              initial={stored}
              // The local database could not be opened, so its pending events cannot be counted.
              identityLocked="تا وقتی داده‌های این دستگاه باز نشود، شناسه کیوسک تغییر نمی‌کند."
              onCancel={() => setSettings('closed')}
              onSave={(s) => {
                writeWebSetup(s);
                location.reload();
              }}
            />
          </div>
        )}
      </>
    );
  }
  if (phase.kind === 'starting') {
    return (
      <div className="setup">
        <div className="spinner" />
      </div>
    );
  }

  const { host, setup } = phase;
  if (!setup) return <App />;
  const status = host.core.statusSync();
  return (
    <>
      <App />
      {settings === 'gate' && <TechGate setup={setup} onPass={() => setSettings('open')} onCancel={() => setSettings('closed')} />}
      {settings === 'open' && (
        <div className="setup-overlay">
          <Setup
            initial={setup}
            running={{ pending: status.outbox.pending + status.outbox.failed, unresolved: status.unresolvedPayments }}
            onCancel={() => setSettings('closed')}
            onSave={async (s) => {
              writeWebSetup(s);
              await host.core.flush();
              location.reload();
            }}
            onReset={async () => {
              const { deleteIdb, WEB_DATA_NAME } = await import('../platform/web');
              host.core.stop();
              clearWebSetup();
              await deleteIdb(WEB_DATA_NAME);
              location.reload();
            }}
          />
        </div>
      )}
    </>
  );
}
