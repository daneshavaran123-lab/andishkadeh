/**
 * UI side of the IPC contract. In Electron the preload exposes `window.kiosk`;
 * in browser development / E2E the same channels are reached over HTTP + SSE (dev bridge).
 */
import type { IpcChannel, IpcChannels, IpcEvent, IpcEvents } from '../core/types';

interface KioskApi {
  platform: string;
  invoke(channel: IpcChannel, req: unknown): Promise<unknown>;
  on(event: IpcEvent, cb: (data: unknown) => void): () => void;
}

declare global {
  interface Window {
    kiosk?: KioskApi;
  }
}

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

const api: KioskApi = window.kiosk ?? httpBridge();

export function invoke<C extends IpcChannel>(channel: C, ...req: IpcChannels[C]['req'] extends void ? [] : [IpcChannels[C]['req']]): Promise<IpcChannels[C]['res']> {
  return api.invoke(channel, req[0]) as Promise<IpcChannels[C]['res']>;
}

export function onEvent<E extends IpcEvent>(event: E, cb: (data: IpcEvents[E]) => void): () => void {
  return api.on(event, cb as (d: unknown) => void);
}

export const platform = api.platform;
