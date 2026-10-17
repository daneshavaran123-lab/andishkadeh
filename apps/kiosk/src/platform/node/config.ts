import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
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

/** True when this device has a configuration (file or KIOSK_DEVICE_KEY); otherwise Windows shows the setup screen. */
export function isConfigured(dataDir: string): boolean {
  return existsSync(join(dataDir, 'kiosk.config.json')) || !!process.env.KIOSK_DEVICE_KEY;
}

/** Values from the Windows setup screen (first run). */
export const NodeSetupSchema = z.object({
  serverUrl: z.string().url(),
  deviceId: z.string().trim().min(1).max(64),
  deviceKey: z.string().min(8),
  payment: z.enum(['mock', 'none']),
  printer: z.enum(['windows', 'mock']),
  printerName: z.string().optional(),
  scanner: z.enum(['keyboard', 'mock']),
  devControls: z.boolean().default(false),
});

/** Writes <dataDir>/kiosk.config.json from the setup screen; other settings keep their defaults. */
export function writeSetupConfig(dataDir: string, values: unknown): void {
  const s = NodeSetupSchema.parse(values);
  const file = {
    serverUrl: s.serverUrl.replace(/\/+$/, ''),
    deviceId: s.deviceId,
    deviceKey: s.deviceKey,
    adapters: { payment: s.payment, printer: s.printer, ...(s.printerName ? { printerName: s.printerName } : {}), scanner: s.scanner },
    devControls: s.devControls,
  };
  mkdirSync(dataDir, { recursive: true });
  const target = join(dataDir, 'kiosk.config.json');
  writeFileSync(`${target}.part`, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${target}.part`, target);
}
