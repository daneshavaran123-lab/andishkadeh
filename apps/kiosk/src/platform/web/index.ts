/**
 * In-page host of the kiosk core for the web app (PWA) and the Android app (Capacitor WebView).
 * The same core as Electron runs here on sql.js + IndexedDB; the UI talks to it through the
 * same IPC channel contract, only without a process boundary.
 */
import initSqlJs from 'sql.js';
import type { KioskConfig } from '../../core/config';
import { MockPrinterAdapter } from '../../core/hardware/printer';
import type { PrinterAdapter } from '../../core/hardware/types';
import { KioskCore } from '../../core/kiosk-core';
import type { IpcChannel, IpcEvent } from '../../core/types';
import { openSqlJsDatabase } from '../sqljs';
import { WEB_DATA_NAME } from './config';
import { Idb } from './idb';
import { IdbMediaStore } from './media';
import { AndroidPrintAdapter, BrowserPrintAdapter } from './printer';

export * from './config';
export { deleteIdb } from './idb';

export interface WebHostOptions {
  /** URL of sql-wasm.wasm (bundled with the app, works offline). */
  wasmUrl: string;
  /** Receipt font (bundled woff2). */
  fontUrl?: string;
  platform: 'web' | 'android';
}

export interface WebHost {
  platform: 'web' | 'android';
  core: KioskCore;
  invoke(channel: IpcChannel, req: unknown): Promise<unknown>;
  on(event: IpcEvent, cb: (data: unknown) => void): () => void;
  mediaUrl(checksum: string): string | null;
}

export class KioskAlreadyOpenError extends Error {
  constructor() {
    super('kiosk is already running in another tab or window');
  }
}

/**
 * Only one tab may run the core: two would race on the same local database and outbox.
 * Waits briefly so a reload can take over the lock the previous page is releasing.
 * Resolves with the function that releases the lock, or null if another tab holds it.
 */
function singleInstanceLock(waitMs = 3000): Promise<(() => void) | null> {
  if (!navigator.locks) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    navigator.locks
      .request(`${WEB_DATA_NAME}-core`, { signal: AbortSignal.timeout(waitMs) }, () => {
        // Held until released: for the lifetime of the page once start-up succeeds.
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch(() => resolve(null));
  });
}

/** Keeps the screen on while the kiosk page is visible (Screen Wake Lock API, where supported). */
function keepScreenOn() {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };
  if (!nav.wakeLock) return;
  const request = () => void nav.wakeLock!.request('screen').catch(() => undefined);
  request();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && request());
}

export async function startWebHost(cfg: KioskConfig, opts: WebHostOptions): Promise<WebHost> {
  const release = await singleInstanceLock();
  if (!release) throw new KioskAlreadyOpenError();
  try {
    return await openHost(cfg, opts);
  } catch (e) {
    // A failed start must not keep other tabs (or the retry after a reload) locked out.
    release();
    throw e;
  }
}

async function openHost(cfg: KioskConfig, opts: WebHostOptions): Promise<WebHost> {
  // Ask the browser not to evict the local database under storage pressure.
  await navigator.storage?.persist?.().catch(() => false);

  const idb = await Idb.open(WEB_DATA_NAME);
  const SQL = await initSqlJs({ locateFile: () => opts.wasmUrl });
  const db = await openSqlJsDatabase(SQL, {
    load: async () => (await idb.get<Uint8Array>('sqlite', 'main')) ?? null,
    save: (bytes) => idb.put('sqlite', 'main', bytes, true),
  });
  let media: IdbMediaStore;
  try {
    media = await IdbMediaStore.open(idb);
  } catch (e) {
    db.close();
    throw e;
  }

  let printer: PrinterAdapter;
  if (cfg.adapters.printer === 'mock') printer = new MockPrinterAdapter();
  else if (opts.platform === 'android') printer = new AndroidPrintAdapter(opts.fontUrl);
  else printer = new BrowserPrintAdapter(opts.fontUrl);

  const core = new KioskCore(cfg, { mediaBase: '', db, media, printer });
  core.start();

  // Store pending writes whenever the page may be going away (tab hidden, app backgrounded, reload).
  const flush = () => void core.flush().catch(() => undefined);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  window.addEventListener('pagehide', flush);
  keepScreenOn();

  return {
    platform: opts.platform,
    core,
    // Results are cloned so the UI never shares objects with the core (same as Electron IPC).
    invoke: async (channel, req) => structuredClone(await core.handle(channel, req as never)),
    on: (event, cb) => core.on(event, (data) => cb(structuredClone(data))),
    mediaUrl: (checksum) => media.url(checksum),
  };
}
