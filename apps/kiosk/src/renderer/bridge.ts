/**
 * UI side of the IPC contract. Three hosts implement the same channels:
 *  - Electron: the preload exposes `window.kiosk` (core in the main process).
 *  - Web app / Android app (build target "web"): the core runs in this page and is attached
 *    with attachApi() once the device has been set up.
 *  - Browser development / E2E: the dev bridge over HTTP + SSE.
 */
import type { SetupCheck, SetupValues } from '../core/setup-check';
import type { IpcChannel, IpcChannels, IpcEvent, IpcEvents } from '../core/types';

export interface KioskApi {
  platform: string;
  invoke(channel: IpcChannel, req: unknown): Promise<unknown>;
  on(event: IpcEvent, cb: (data: unknown) => void): () => void;
  /** Windows app, first run only (see electron/main.ts). */
  setup?: {
    printers(): Promise<string[]>;
    verify(s: Pick<SetupValues, 'serverUrl' | 'deviceId' | 'deviceKey'>): Promise<SetupCheck>;
    save(values: SetupValues): Promise<{ ok: true }>;
  };
}

declare global {
  interface Window {
    kiosk?: KioskApi;
  }
}

/** "web" for the PWA and Android builds (vite --mode web); otherwise Electron / dev bridge. */
export const BUILD_TARGET: 'web' | 'electron' = __KIOSK_WEB__ ? 'web' : 'electron';

const BRIDGE_URL = (import.meta.env.VITE_KIOSK_BRIDGE as string | undefined) ?? 'http://localhost:5175';

function httpBridge(): KioskApi {
  let source: EventSource | null = null;
  const listeners = new Map<IpcEvent, Set<(d: unknown) => void>>();
  const ensure = () => {
    if (source) return;
    source = new EventSource(`${BRIDGE_URL}/events`);
    for (const ev of ['status', 'catalog', 'scanner:scan'] as IpcEvent[]) {
      source.addEventListener(ev, (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        listeners.get(ev)?.forEach((cb) => cb(data));
      });
    }
  };
  return {
    platform: 'web-dev',
    async invoke(channel, req) {
      const res = await fetch(`${BRIDGE_URL}/ipc/${encodeURIComponent(channel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: req === undefined ? undefined : JSON.stringify(req),
      });
      if (!res.ok) throw new Error(`bridge error ${res.status}`);
      return res.json();
    },
    on(event, cb) {
      ensure();
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return () => listeners.get(event)?.delete(cb);
    },
  };
}

let api: KioskApi | null = window.kiosk ?? (BUILD_TARGET === 'web' ? null : httpBridge());
let attach: ((a: KioskApi) => void) | null = null;
const ready: Promise<KioskApi> = api ? Promise.resolve(api) : new Promise((resolve) => (attach = resolve));

export let platform = api?.platform ?? 'web';

/** Web/Android target: hands the in-page core to the UI (before <App> is rendered). */
export function attachApi(a: KioskApi) {
  api = a;
  platform = a.platform;
  attach?.(a);
}

export async function invoke<C extends IpcChannel>(channel: C, ...req: IpcChannels[C]['req'] extends void ? [] : [IpcChannels[C]['req']]): Promise<IpcChannels[C]['res']> {
  const a = api ?? (await ready);
  return a.invoke(channel, req[0]) as Promise<IpcChannels[C]['res']>;
}

export function onEvent<E extends IpcEvent>(event: E, cb: (data: IpcEvents[E]) => void): () => void {
  if (api) return api.on(event, cb as (d: unknown) => void);
  let off: (() => void) | null = null;
  let cancelled = false;
  void ready.then((a) => {
    if (!cancelled) off = a.on(event, cb as (d: unknown) => void);
  });
  return () => {
    cancelled = true;
    off?.();
  };
}
