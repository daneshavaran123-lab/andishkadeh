/**
 * Web app / Android app configuration. Entered once on the setup screen, or written by the kiosk
 * management page (/kiosk, same origin) when staff activate this browser. Kept in this browser
 * profile only (never in the build). Changing it requires the device key.
 */
import { z } from 'zod';
import { WEB_KIOSK_SETUP_STORAGE_KEY as STORAGE_KEY } from '@andishkadeh/shared';
import { KioskConfigSchema, type KioskConfig } from '../../core/config';
import type { SetupValues } from '../../core/setup-check';

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
