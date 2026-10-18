/**
 * Start-up of the web app (PWA) and the Android app: device setup on first run, then the kiosk
 * core is started in this page and handed to the regular kiosk UI. A technician re-opens the
 * settings with 7 quick taps in the top-left corner followed by the device key.
 */
import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState } from 'react';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { clearWebSetup, readWebSetup, toKioskConfig, writeWebSetup, type WebSetup } from '../platform/web/config';
import type { WebHost } from '../platform/web';
import { App } from './App';
import fontUrl from './assets/fonts/Vazirmatn-wght.woff2?url';
import { attachApi } from './bridge';
import { Setup, TechGate } from './screens/Setup';
import { setMediaResolver } from './store';

const PLATFORM: 'web' | 'android' = Capacitor.isNativePlatform() ? 'android' : 'web';

type Phase =
  | { kind: 'setup' }
  | { kind: 'starting' }
  | { kind: 'running'; host: WebHost; setup: WebSetup }
  | { kind: 'error'; message: string };

/** Default server for the web app opened from the server itself (https://server/). */
function defaultServerUrl(): string {
  return PLATFORM === 'web' && /^https?:$/.test(location.protocol) ? location.origin : '';
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

/** Web app on the server: staff activate this browser from the kiosk management page (same origin). */
function ActivationNotice() {
  return (
    <div className="setup-notice" data-testid="activation-notice">
      این دستگاه هنوز فعال نشده است. کارکنان می‌توانند در همین مرورگر به{' '}
      <a href="/kiosk" dir="ltr">
        /kiosk
      </a>{' '}
      بروند، وارد شوند و «فعال‌سازی همین مرورگر» را بزنند؛ یا شناسه و کلید دستگاه را این‌جا وارد کنند.
    </div>
  );
}

export function WebBoot() {
  const [phase, setPhase] = useState<Phase>(() => (readWebSetup() ? { kind: 'starting' } : { kind: 'setup' }));
  const [settings, setSettings] = useState<'closed' | 'gate' | 'open'>('closed');
  const started = useRef(false);

  const start = async () => {
    const setup = readWebSetup();
    if (!setup) return setPhase({ kind: 'setup' });
    if (started.current) return;
    started.current = true;
    setPhase({ kind: 'starting' });
    try {
      const { startWebHost } = await import('../platform/web');
      const host = await startWebHost(toKioskConfig(setup, __KIOSK_VERSION__), { wasmUrl, fontUrl, platform: PLATFORM });
      attachApi(host);
      setMediaResolver(host.mediaUrl);
      setPhase({ kind: 'running', host, setup });
    } catch (e) {
      started.current = false;
      const message =
        (e as Error).name === 'KioskAlreadyOpenError' || /another tab/.test((e as Error).message)
          ? 'کیوسک در زبانه یا پنجره دیگری از همین مرورگر باز است. آن را ببندید و دوباره تلاش کنید.'
          : `راه‌اندازی کیوسک ممکن نشد: ${(e as Error).message}`;
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

  useCornerTaps(phase.kind === 'running' && settings === 'closed', () => setSettings('gate'));

  if (phase.kind === 'setup') {
    return (
      <Setup
        initial={{ serverUrl: defaultServerUrl() }}
        notice={PLATFORM === 'web' && defaultServerUrl() ? <ActivationNotice /> : undefined}
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
            <h1>کیوسک آماده نیست</h1>
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
