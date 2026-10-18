/**
 * Preload of the admin panel window (admin-window.ts): writes the session hand-over (token and
 * kiosk-mode settings) into the panel's sessionStorage before its scripts run. Exposes nothing.
 */
import { ipcRenderer } from 'electron';

const entries = ipcRenderer.sendSync('kiosk-admin:handoff') as Array<[string, string]> | null;
for (const [key, value] of entries ?? []) sessionStorage.setItem(key, value);
