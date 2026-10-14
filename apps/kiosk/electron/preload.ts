/**
 * The only bridge between the sandboxed UI and the main process.
 * Exposes a fixed allowlist of channels; nothing from Node or Electron leaks into the page.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type IpcEvent } from '../src/core/types';

contextBridge.exposeInMainWorld('kiosk', {
  platform: 'electron',
  invoke(channel: IpcChannel, req: unknown) {
    if (!IPC_CHANNELS.includes(channel)) return Promise.reject(new Error(`channel not allowed: ${channel}`));
    return ipcRenderer.invoke(`kiosk:${channel}`, req);
  },
  on(event: IpcEvent, cb: (data: unknown) => void) {
    if (!IPC_EVENTS.includes(event)) return () => undefined;
    const handler = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on(`kiosk:event:${event}`, handler);
    return () => ipcRenderer.removeListener(`kiosk:event:${event}`, handler);
  },
});
