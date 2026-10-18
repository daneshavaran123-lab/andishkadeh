/**
 * Web app / Android app configuration. The web app served by the server opens as the public web
 * app (no configuration, browsing only) until staff activate the browser as a kiosk from the kiosk
 * management page (/kiosk, same origin), which writes the configuration here; the Android app and
 * a development build enter it once on the setup screen. Kept in this browser profile only (never
 * in the build). Changing it requires the device key.
 */
import { z } from 'zod';
import { WEB_APP_DEVICE_ID, WEB_KIOSK_SETUP_STORAGE_KEY as STORAGE_KEY } from '@andishkadeh/shared';
import { KioskConfigSchema, type KioskConfig } from '../../core/config';
import type { SetupValues } from '../../core/setup-check';

export const WEB_DATA_NAME = 'andishkadeh-kiosk';
/** The public web app keeps its catalogue copy apart, so it never touches a kiosk's sales and queue. */
export const PUBLIC_DATA_NAME = 'andishkadeh-web';

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

export function writeWebSetup(s: SetupValues) {
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

/** Public web app (WEB_APP_DEVICE_ID): the server asks this device for no key and lets it browse only. */
export function publicKioskConfig(serverUrl: string, appVersion: string): KioskConfig {
  return KioskConfigSchema.parse({
    serverUrl: serverUrl.replace(/\/+$/, ''),
    deviceId: WEB_APP_DEVICE_ID,
    deviceKey: 'public-web-app', // not a secret: ignored by the server for this device
    dataDir: `indexeddb:${PUBLIC_DATA_NAME}`,
    appVersion,
    adapters: { payment: 'none', printer: 'browser', scanner: 'keyboard' },
    kioskMode: false,
    browseOnly: true,
    devControls: false,
  });
}
