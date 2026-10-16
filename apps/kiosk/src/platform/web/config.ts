/**
 * Web app / Android app configuration. Entered once by the technician on the setup screen and
 * kept in this browser profile only (never in the build). Changing it requires the device key.
 */
import { z } from 'zod';
import { KioskConfigSchema, type KioskConfig } from '../../core/config';

const STORAGE_KEY = 'andishkadeh.kiosk.setup.v1';
export const WEB_DATA_NAME = 'andishkadeh-kiosk';

export const WebSetupSchema = z.object({
  serverUrl: z.string().url(),
  deviceId: z.string().trim().min(1).max(64),
  deviceKey: z.string().min(8),
  payment: z.enum(['mock', 'none']).default('mock'),
  printer: z.enum(['browser', 'mock']).default('browser'),
  scanner: z.enum(['keyboard', 'mock']).default('keyboard'),
  devControls: z.boolean().default(false),
});
export type WebSetup = z.infer<typeof WebSetupSchema>;

export function readWebSetup(): WebSetup | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? WebSetupSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeWebSetup(s: WebSetup) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(WebSetupSchema.parse(s)));
}

export function clearWebSetup() {
  localStorage.removeItem(STORAGE_KEY);
}

export function toKioskConfig(s: WebSetup, appVersion: string): KioskConfig {
  return KioskConfigSchema.parse({
    serverUrl: s.serverUrl.replace(/\/+$/, ''),
    deviceId: s.deviceId,
    deviceKey: s.deviceKey,
    dataDir: `indexeddb:${WEB_DATA_NAME}`,
    appVersion,
    adapters: { payment: s.payment, printer: s.printer, scanner: s.scanner },
    kioskMode: true,
    devControls: s.devControls,
  });
}

/** Checks address and credentials against the server before saving. */
export async function verifySetup(s: Pick<WebSetup, 'serverUrl' | 'deviceId' | 'deviceKey'>): Promise<{ ok: true } | { ok: false; reason: 'auth' | 'network' | 'server'; message: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${s.serverUrl.replace(/\/+$/, '')}/api/v1/kiosk/bootstrap`, {
      headers: { Authorization: `Device ${s.deviceId}:${s.deviceKey}` },
      signal: ctrl.signal,
    });
    if (res.ok) {
      // A captive portal or proxy page also answers 200: only our server returns the bootstrap JSON.
      const body = (await res.json().catch(() => null)) as { catalogRevision?: unknown } | null;
      if (body && typeof body.catalogRevision === 'number') return { ok: true };
      return { ok: false, reason: 'server', message: 'این آدرس به سرور اندیشکده نمی‌رسد' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth', message: 'شناسه یا کلید دستگاه پذیرفته نشد' };
    return { ok: false, reason: 'server', message: `پاسخ نامعتبر از سرور (${res.status})` };
  } catch {
    return { ok: false, reason: 'network', message: 'سرور در دسترس نیست؛ آدرس و اتصال شبکه را بررسی کنید' };
  } finally {
    clearTimeout(timer);
  }
}
