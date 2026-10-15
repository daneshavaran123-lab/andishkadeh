import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KioskConfigSchema, type KioskConfig } from '../../core/config';

/** Electron / Node: defaults → <dataDir>/kiosk.config.json → environment variables (KIOSK_*). */
export function loadConfig(dataDir: string, overrides: Partial<KioskConfig> = {}): KioskConfig {
  const file = join(dataDir, 'kiosk.config.json');
  const fromFile = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<KioskConfig>) : {};
  const env = process.env;
  const fromEnv: Partial<KioskConfig> = {
    ...(env.KIOSK_SERVER_URL ? { serverUrl: env.KIOSK_SERVER_URL } : {}),
    ...(env.KIOSK_DEVICE_ID ? { deviceId: env.KIOSK_DEVICE_ID } : {}),
    ...(env.KIOSK_DEVICE_KEY ? { deviceKey: env.KIOSK_DEVICE_KEY } : {}),
    ...(env.KIOSK_DEV_CONTROLS ? { devControls: env.KIOSK_DEV_CONTROLS === '1' } : {}),
    ...(env.KIOSK_KIOSK_MODE ? { kioskMode: env.KIOSK_KIOSK_MODE === '1' } : {}),
  };
  const adapters = {
    ...(fromFile.adapters ?? {}),
    ...(overrides.adapters ?? {}),
    ...(env.KIOSK_PAYMENT_ADAPTER ? { payment: env.KIOSK_PAYMENT_ADAPTER } : {}),
    ...(env.KIOSK_PRINTER_ADAPTER ? { printer: env.KIOSK_PRINTER_ADAPTER } : {}),
    ...(env.KIOSK_PRINTER_NAME ? { printerName: env.KIOSK_PRINTER_NAME } : {}),
    ...(env.KIOSK_SCANNER_ADAPTER ? { scanner: env.KIOSK_SCANNER_ADAPTER } : {}),
  };
  return KioskConfigSchema.parse({
    serverUrl: 'http://localhost:3000',
    deviceId: 'KIOSK-01',
    ...fromFile,
    ...overrides,
    ...fromEnv,
    adapters,
    dataDir,
  });
}
