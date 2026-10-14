import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Kiosk configuration. Read from (lowest → highest priority):
 *   defaults → <dataDir>/kiosk.config.json → environment variables (KIOSK_*).
 * The device key is a secret: it lives only in the main process / config file, never in the UI bundle.
 */
export const KioskConfigSchema = z.object({
  serverUrl: z.string().url(),
  deviceId: z.string().min(1),
  deviceKey: z.string().min(8),
  dataDir: z.string(),
  appVersion: z.string().default('1.0.0'),
  adapters: z.object({
    /** mock = simulated card reader. none = no SDK configured (status UNKNOWN, sales blocked). */
    payment: z.enum(['mock', 'none']).default('mock'),
    /** mock = writes receipts to <dataDir>/receipts; windows = silent print through the Windows driver. */
    printer: z.enum(['mock', 'windows']).default('mock'),
    printerName: z.string().optional(),
    /** keyboard = USB HID scanner in keyboard-wedge mode (captured by the UI); mock = dev controls only. */
    scanner: z.enum(['keyboard', 'mock']).default('keyboard'),
  }),
  intervals: z
    .object({
      heartbeatSec: z.number().int().min(5).default(30),
      pullSec: z.number().int().min(5).default(60),
      pushSec: z.number().int().min(2).default(10),
      recoverySec: z.number().int().min(10).default(60),
    })
    .default({}),
  requestTimeoutMs: z.number().int().min(1000).default(8000),
  /** Electron only: fullscreen kiosk window without frame, menu or devtools. */
  kioskMode: z.boolean().default(true),
  /** Exposes dev controls (scenario switching) — must stay false in production builds. */
  devControls: z.boolean().default(false),
});

export type KioskConfig = z.infer<typeof KioskConfigSchema>;

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
